import { NextRequest, NextResponse } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { 
  getDb,
  getChatMessages,
  addChatMessage,
  updateSessionTimestamp,
  trackConversationContext,
  createSessionSummary,
  trackGlobalMemory,
  getSessionContexts
} from '@/lib/db';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext, detectFollowUpWithAI } from '@/lib/smartRetrieval';
import { createClient } from '@supabase/supabase-js';
import { 
  isComplexQuery, 
  performMultiHopReasoning, 
  formatMultiHopResponse 
} from '@/lib/multiHopReasoning';
import {
  analyzeConversationContext,
  generateSessionSummary as generateContextSummary,
  extractTopicsFromMessage
} from '@/lib/contextAnalyzer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ✅ In-memory cache for retrieval context
interface RetrievalCache {
  query: string;
  keywords: string[];
  chunks: any[];
  timestamp: number;
  strategy: string;
  confidence: number;
}

const sessionRetrievalCache = new Map<string, RetrievalCache>();

// ✅ Clean old cache entries (older than 10 minutes)
function cleanOldCache() {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  
  for (const [sessionId, cache] of sessionRetrievalCache.entries()) {
    if (now - cache.timestamp > tenMinutes) {
      sessionRetrievalCache.delete(sessionId);
      console.log(`🧹 Cleaned old cache for session: ${sessionId}`);
    }
  }
}

/**
 * ✅ Exhaustive keyword search with page filter
 */
async function exhaustiveKeywordSearchWithFilter(
  keywords: string[],
  documentIds: string[],
  pageFilter: number
): Promise<any[]> {
  console.log(`🔍 EXHAUSTIVE KEYWORD SEARCH WITH PAGE FILTER`);
  console.log(`   Keywords: ${keywords.join(', ')}`);
  console.log(`   Page filter: >= ${pageFilter}`);
  console.log(`   Documents: ${documentIds.length}`);

  const allResults = new Map<string, any>();

  for (const keyword of keywords) {
    console.log(`   📍 Searching for: "${keyword}"`);

    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .gte('page_number', pageFilter)
      .order('page_number', { ascending: true })
      .limit(300);

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      continue;
    }

    if (data && data.length > 0) {
      console.log(`   ✅ Found ${data.length} matches (page >= ${pageFilter})`);

      data.forEach((chunk) => {
        const key = `${chunk.id}-${chunk.page_number}`;
        if (!allResults.has(key)) {
          allResults.set(key, {
            ...chunk,
            matched_keyword: keyword,
            source: 'keyword_filtered',
            similarity: 0.8,
          });
        }
      });
    } else {
      console.log(`   ⚠️ No matches for "${keyword}"`);
    }
  }

  const results = Array.from(allResults.values());
  console.log(`\n📊 TOTAL FILTERED CHUNKS: ${results.length}`);

  return results.sort((a, b) => a.page_number - b.page_number).slice(0, 150);
}

/**
 * ✅ Detect document language from Supabase embeddings
 */
async function detectDocumentLanguage(documentId: string): Promise<'ar' | 'en'> {
  try {
    console.log(`🔍 Detecting language for document: ${documentId}`);

    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('chunk_text')
      .eq('document_id', documentId)
      .limit(20);

    if (error) {
      console.error('⚠️ Error fetching embeddings:', error);
      return 'ar';
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No embeddings found for document, defaulting to Arabic');
      return 'ar';
    }

    const contentChunks = data.filter(row => {
      const text = row.chunk_text.toLowerCase();
      return !(
        text.includes('table of contents') ||
        text.includes('chapter') && text.length < 100 ||
        /^page \d+/i.test(text) ||
        text === 'في رحاب أمريكا'
      );
    });

    const chunksToAnalyze = contentChunks.length > 0 ? contentChunks : data;
    const combinedText = chunksToAnalyze.map(row => row.chunk_text).join(' ');
    
    const arabicChars = (combinedText.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = combinedText.replace(/\s/g, '').length;

    const arabicRatio = arabicChars / totalChars;
    const detectedLang = arabicRatio > 0.3 ? 'ar' : 'en';

    console.log(`   ✅ Language detected: ${detectedLang} (${(arabicRatio * 100).toFixed(1)}% Arabic, analyzed ${chunksToAnalyze.length} chunks)`);

    return detectedLang;

  } catch (error) {
    console.error('❌ Error in detectDocumentLanguage:', error);
    return 'ar';
  }
}

/**
 * ✅ Detect user's query language
 */
function detectQueryLanguage(query: string): 'ar' | 'en' {
  const arabicChars = (query.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = query.replace(/\s/g, '').length;
  const arabicRatio = arabicChars / totalChars;
  
  return arabicRatio > 0.3 ? 'ar' : 'en';
}

/**
 * ✅ Detect languages for multiple documents
 */
async function detectMultipleDocumentLanguages(documentIds: string[]): Promise<{
  primary: 'ar' | 'en';
  languages: Map<string, 'ar' | 'en'>;
  isMultilingual: boolean;
}> {
  const languages = new Map<string, 'ar' | 'en'>();
  
  for (const docId of documentIds) {
    const lang = await detectDocumentLanguage(docId);
    languages.set(docId, lang);
  }
  
  const arabicCount = Array.from(languages.values()).filter(l => l === 'ar').length;
  const englishCount = languages.size - arabicCount;
  
  const primary = arabicCount >= englishCount ? 'ar' : 'en';
  const isMultilingual = arabicCount > 0 && englishCount > 0;
  
  console.log(`🌍 Multi-document language analysis:
   - Total documents: ${documentIds.length}
   - Arabic: ${arabicCount}
   - English: ${englishCount}
   - Primary: ${primary}
   - Multilingual: ${isMultilingual}`);
  
  return { primary, languages, isMultilingual };
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Clean old cache entries periodically
  cleanOldCache();

  let modelUsed: string | undefined;

  (async () => {
    try {
      const body = await req.json();
      
      const { 
        message, 
        query,
        sessionId, 
        bookId, 
        bookTitle, 
        bookPage,
        extractedText,
        documentIds,
        correctSpelling = false,
        aggressiveCorrection = false,
        customPrompt,
        enableMultiHop = false,
        preferredModel, 
        useReranking = true,
        useKeywordSearch = false,
        cachedChunks,
        reuseCachedContext = false
      } = body;

      const userMessage = message || query;

      console.log('📚 Reader Chat:', {
        sessionId,
        hasMessage: !!userMessage,
        hasCorpus: documentIds?.length > 0,
        corpusCount: documentIds?.length || 0,
        enableMultiHop,
        preferredModel,
        useKeywordSearch,
        hasCachedChunks: !!cachedChunks,
        reuseCachedContext
      });

      if (!userMessage) {
        await writer.write(encoder.encode('Error: Missing message or query'));
        await writer.close();
        return;
      }

      // ✅ STEP 1: Load conversation history
      let history: Array<{ role: string; content: string; created_at: string }> = [];
      if (sessionId) {
        const db = getDb();
        history = db.prepare(`
          SELECT role, content, created_at
          FROM chat_messages 
          WHERE session_id = ? 
          ORDER BY created_at DESC
          LIMIT 10
        `).all(sessionId) as Array<{ role: string; content: string; created_at: string }>;
        
        history.reverse();
        console.log(`📜 Loaded ${history.length} previous messages`);
      }

      // ✅ STEP 1.5: AI-POWERED FOLLOW-UP DETECTION
      const conversationHistory = history.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Get cached context for keyword extraction
      const cachedContext = sessionId ? sessionRetrievalCache.get(sessionId) : undefined;

      const followUpDetection = await detectFollowUpWithAI(
        userMessage, 
        conversationHistory,
        cachedContext ? {
          previousQuery: cachedContext.query,
          previousKeywords: cachedContext.keywords,
          previousChunksCount: cachedContext.chunks.length
        } : undefined
      );

      console.log(`🔍 Reader Mode Follow-up Analysis:`, {
        isFollowUp: followUpDetection.isFollowUp,
        confidence: followUpDetection.confidence,
        reason: followUpDetection.reason,
        needsRetrieval: followUpDetection.needsNewRetrieval,
        hasEnhancedKeywords: !!followUpDetection.enhancedKeywords,
        pageFilter: followUpDetection.pageFilter
      });

      // ✅ STEP 2: Analyze conversation context (every 3 messages)
      if (sessionId && history.length > 0 && history.length % 3 === 0) {
        console.log('🧠 Analyzing reader chat context...');
        
        const queryLanguage = detectQueryLanguage(userMessage);

        try {
          const context = await analyzeConversationContext(conversationHistory, queryLanguage);
          
          if (context.topics.length > 0) {
            for (const topic of context.topics.slice(0, 3)) {
              const contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              trackConversationContext({
                id: contextId,
                sessionId,
                topic,
                keywords: context.keywords,
                entities: context.entities,
                relevanceScore: 0.8
              });
            }
          }

          if (context.mainTheme) {
            const memoryId = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            trackGlobalMemory({
              id: memoryId,
              topic: context.mainTheme,
              context: `Book: ${bookTitle || 'Unknown'}, Page: ${bookPage || 'N/A'}, Intent: ${context.userIntent}`,
              sessionId
            });
          }

          console.log('✅ Reader context tracked');
        } catch (error) {
          console.error('⚠️ Context analysis failed:', error);
        }
      }

      // ✅ STEP 3: Generate summary (every 10 messages)
      if (sessionId && history.length > 0 && history.length % 10 === 0) {
        console.log('📝 Generating reader session summary...');
        
        try {
          const queryLanguage = detectQueryLanguage(userMessage);

          const summaryResult = await generateContextSummary(conversationHistory, queryLanguage);
          
          const summaryId = `sum-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          createSessionSummary({
            id: summaryId,
            sessionId,
            summary: summaryResult.summary,
            keyPoints: summaryResult.keyPoints,
            messageCount: history.length
          });

          console.log('✅ Reader summary created');
        } catch (error) {
          console.error('⚠️ Summary generation failed:', error);
        }
      }

      // ✅ STEP 4: Route to appropriate handler
      if (documentIds && documentIds.length > 0) {
        console.log('🔄 Using corpus retrieval for Reader Chat');
        
        const usedModel = await handleCorpusQuery(
          writer, 
          encoder, 
          userMessage, 
          documentIds, 
          extractedText, 
          customPrompt,
          enableMultiHop,
          sessionId,
          history,
          bookTitle,
          bookPage,
          preferredModel,
          useKeywordSearch ? false : useReranking,
          useKeywordSearch,
          followUpDetection,
          cachedChunks,
          reuseCachedContext
        );
        
        modelUsed = usedModel;
      } 
      else if (sessionId) {
        console.log('💬 Using general chat with history for Reader Chat');
        const usedModel = await handleGeneralChat(writer, encoder, userMessage, sessionId, extractedText, bookPage, history, preferredModel);
        modelUsed = usedModel;
      }
      else {
        console.log('📝 Using simple query response');
        const usedModel = await handleSimpleQuery(writer, encoder, userMessage, extractedText, preferredModel);
        modelUsed = usedModel;
      }

      await writer.close();

    } catch (error) {
      console.error('❌ Reader chat error:', error);
      try {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await writer.write(encoder.encode(`Error: ${errorMsg}`));
        await writer.close();
      } catch {}
    }
  })();

  const response = new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });

  if (modelUsed) {
    response.headers.set('X-Model-Used', modelUsed);
  }

  return response;
}

// ==================== CORPUS QUERY HANDLER (SMART FOLLOW-UP AWARE) ====================
async function handleCorpusQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  documentIds: string[],
  extractedText?: string,
  customPrompt?: string,
  enableMultiHop: boolean = false,
  sessionId?: string,
  history?: Array<{ role: string; content: string }>,
  bookTitle?: string,
  bookPage?: number,
  preferredModel?: string,
  useReranking: boolean = true,
  useKeywordSearch: boolean = false,
  followUpDetection?: { 
    isFollowUp: boolean; 
    confidence: number; 
    reason: string; 
    needsNewRetrieval: boolean;
    enhancedKeywords?: string[];
    pageFilter?: number;
  },
  cachedChunks?: any[],
  reuseCachedContext: boolean = false
): Promise<string> {
  let conversationContextString = '';
  let contextualPromptAddition = '';
  
  if (sessionId && history && history.length > 0) {
    const db = getDb();
    const contexts = getSessionContexts(sessionId) as Array<{
      topic: string;
      keywords: string;
      mention_count: number;
    }>;

    if (contexts.length > 0) {
      const recentTopics = contexts
        .slice(0, 3)
        .map(c => c.topic)
        .join(', ');
      
      const queryLanguage = detectQueryLanguage(query);
      contextualPromptAddition = queryLanguage === 'ar'
        ? `\n\n📋 **الوعي بالسياق:**\nالمواضيع التي ناقشناها مؤخراً: ${recentTopics}\n`
        : `\n\n📋 **Context Awareness:**\nRecent topics we've discussed: ${recentTopics}\n`;
    }

    const recentHistory = history.slice(-4);
    if (recentHistory.length > 0) {
      const queryLanguage = detectQueryLanguage(query);
      conversationContextString = queryLanguage === 'ar'
        ? '\n\n📜 **محادثتنا الأخيرة:**\n'
        : '\n\n📜 **Recent conversation:**\n';
      
      recentHistory.forEach(msg => {
        const label = msg.role === 'user' 
          ? (queryLanguage === 'ar' ? 'أنت' : 'You')
          : (queryLanguage === 'ar' ? 'المساعد' : 'Assistant');
        conversationContextString += `**${label}:** ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n\n`;
      });
    }
  }

  const { primary: documentLanguage, languages: docLanguages, isMultilingual } = 
    await detectMultipleDocumentLanguages(documentIds);

  const queryLanguage = detectQueryLanguage(query);
  console.log(`🗣️ Query language: ${queryLanguage}`);

  const responseLanguage = queryLanguage;
  console.log(`💬 Response will be in: ${responseLanguage}`);

  const requiresMultiHop = enableMultiHop && isComplexQuery(query);
  
  if (requiresMultiHop) {
    console.log('🧠 Complex query detected - activating multi-hop reasoning');
    
    try {
      const multiHopResult = await performMultiHopReasoning(
        query,
        documentIds,
        docLanguages,
        4,
        responseLanguage
      );
      
      let conversationPrefix = '';
      if (conversationContextString) {
        conversationPrefix = responseLanguage === 'ar'
          ? `💭 **استكمالاً لمحادثتنا:**\n\n${conversationContextString}\n\n---\n\n`
          : `💭 **Continuing our conversation:**\n\n${conversationContextString}\n\n---\n\n`;
      }
      
      const formattedResponse = conversationPrefix + formatMultiHopResponse(multiHopResult, responseLanguage);
      await writer.write(encoder.encode(formattedResponse));
      
      console.log('✅ Multi-hop response complete');
      return 'gemini-multi-hop';
      
    } catch (error) {
      console.error('❌ Multi-hop reasoning failed, falling back to standard retrieval:', error);
    }
  }

  console.log(enableMultiHop ? '📖 Using standard retrieval (fallback)' : '📖 Using standard retrieval strategy');
  
  const contextParts: string[] = [];

  // ✅ Perform query analysis (ONLY if not a follow-up with enhanced keywords)
  let queryAnalysis: any;
  
  if (followUpDetection?.isFollowUp && followUpDetection.enhancedKeywords && followUpDetection.pageFilter) {
    // Skip full analysis for "more from page X" pattern
    console.log('⚡ Skipping query analysis - using enhanced follow-up context');
    queryAnalysis = {
      originalQuery: query,
      queryType: 'factual',
      keywords: followUpDetection.enhancedKeywords,
      isMultiDocumentQuery: false,
      expandedQuery: query
    };
  } else {
    queryAnalysis = await analyzeQuery(query, documentLanguage);
  }
  
  // ✅ ADD follow-up info to query analysis
  if (followUpDetection) {
    queryAnalysis.isFollowUp = followUpDetection.isFollowUp;
    queryAnalysis.followUpConfidence = followUpDetection.confidence;
    queryAnalysis.needsNewRetrieval = followUpDetection.needsNewRetrieval;
  }

  // ✅ Check for cached context
  const cachedContext = sessionId ? sessionRetrievalCache.get(sessionId) : undefined;
  
  if (cachedContext) {
    const ageSeconds = Math.round((Date.now() - cachedContext.timestamp) / 1000);
    console.log(`♻️ Found cached retrieval context:`, {
      originalQuery: cachedContext.query,
      chunksCount: cachedContext.chunks.length,
      keywords: cachedContext.keywords,
      age: `${ageSeconds}s ago`
    });
  }

  console.log('🔍 Query Analysis:', {
    original: queryAnalysis.originalQuery,
    translated: queryAnalysis.translatedQuery,
    type: queryAnalysis.queryType,
    keywords: queryAnalysis.keywords,
    isMultiDoc: queryAnalysis.isMultiDocumentQuery,
    isFollowUp: queryAnalysis.isFollowUp,
    needsRetrieval: queryAnalysis.needsNewRetrieval
  });

  if (extractedText) {
    const extractLabel = responseLanguage === 'ar' 
      ? '**📄 نص الصفحة الحالية:**'
      : '**📄 Current Page Text:**';
    contextParts.push(`${extractLabel}\n${extractedText}`);
  }

  // ==================== SMART RETRIEVAL LOGIC ====================
  let processedChunks: any[] = [];
  let retrievalStrategy = 'unknown';
  let retrievalConfidence = 0;
  let newChunksRetrieved = false;

  const isCacheFresh = cachedContext ? (Date.now() - cachedContext.timestamp) < 5 * 60 * 1000 : false;

  // ✅ SMART FOLLOW-UP HANDLING
  if (followUpDetection?.isFollowUp) {
    console.log('🔄 Follow-up query detected - using smart retrieval logic');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CASE 1: "More from page X" - Filter existing results
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (followUpDetection.pageFilter && followUpDetection.enhancedKeywords) {
      console.log(`📄 "More from page X" pattern detected`);
      console.log(`   🔑 Using enhanced keywords: ${followUpDetection.enhancedKeywords.join(', ')}`);
      console.log(`   📍 Page filter: >= ${followUpDetection.pageFilter}`);

      // Try to filter cached chunks first
      if (cachedContext && cachedContext.chunks.length > 0) {
        const filteredChunks = cachedContext.chunks.filter(
          chunk => chunk.page_number >= followUpDetection.pageFilter!
        );

        if (filteredChunks.length > 0) {
          console.log(`   ✅ Found ${filteredChunks.length} cached chunks matching page filter`);
          processedChunks = filteredChunks;
          retrievalStrategy = 'cached_filtered';
          retrievalConfidence = 0.9;
        } else {
          console.log(`   ⚠️ No cached chunks match page filter, performing new keyword search`);
          
          processedChunks = await exhaustiveKeywordSearchWithFilter(
            followUpDetection.enhancedKeywords,
            documentIds,
            followUpDetection.pageFilter
          );
          
          retrievalStrategy = 'keyword_exhaustive_filtered';
          retrievalConfidence = 0.95;
          newChunksRetrieved = true;
        }
      } else {
        console.log(`   ℹ️ No cache available, performing fresh keyword search`);
        
        processedChunks = await exhaustiveKeywordSearchWithFilter(
          followUpDetection.enhancedKeywords,
          documentIds,
          followUpDetection.pageFilter
        );
        
        retrievalStrategy = 'keyword_exhaustive_filtered';
        retrievalConfidence = 0.95;
        newChunksRetrieved = true;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CASE 2: Analysis/Clarification - Reuse existing context
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    else if (!followUpDetection.needsNewRetrieval && cachedContext) {
      console.log(`♻️ Follow-up asks for analysis - reusing ${cachedContext.chunks.length} cached chunks`);
      processedChunks = cachedContext.chunks;
      retrievalStrategy = 'cached_analysis';
      retrievalConfidence = cachedContext.confidence || 0.85;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CASE 3: Expansion - Combine enhanced keywords with new analysis
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    else if (followUpDetection.needsNewRetrieval && followUpDetection.enhancedKeywords) {
      console.log(`🔍 Follow-up needs expansion - using enhanced keywords as base`);
      console.log(`   Base keywords: ${followUpDetection.enhancedKeywords.join(', ')}`);

      const modifiedAnalysis = {
        ...queryAnalysis,
        keywords: followUpDetection.enhancedKeywords,
        expandedQuery: query
      };

      const { chunks, strategy, confidence } = await retrieveSmartContext(
        modifiedAnalysis,
        documentIds,
        useReranking,
        useKeywordSearch,
        followUpDetection ? {
          isFollowUp: followUpDetection.isFollowUp,
          enhancedKeywords: followUpDetection.enhancedKeywords,
          pageFilter: followUpDetection.pageFilter
        } : undefined
      );

      processedChunks = chunks;
      retrievalStrategy = strategy + '_follow_up_expanded';
      retrievalConfidence = confidence;
      newChunksRetrieved = true;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CASE 4: Fallback - Standard retrieval
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    else {
      console.log(`ℹ️ Follow-up fallback - performing standard retrieval`);
      
      const { chunks, strategy, confidence } = await retrieveSmartContext(
        queryAnalysis,
        documentIds,
        useReranking,
        useKeywordSearch,
        followUpDetection ? {
          isFollowUp: followUpDetection.isFollowUp,
          enhancedKeywords: followUpDetection.enhancedKeywords,
          pageFilter: followUpDetection.pageFilter
        } : undefined
      );

      processedChunks = chunks;
      retrievalStrategy = strategy;
      retrievalConfidence = confidence;
      newChunksRetrieved = true;
    }

  } else {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // NEW QUERY: Full analysis + fresh retrieval
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('📚 New independent query - performing fresh retrieval');
    
    const { chunks, strategy, confidence } = await retrieveSmartContext(
      queryAnalysis,
      documentIds,
      useReranking,
      useKeywordSearch
    );

    console.log(`📊 Retrieval Results:
   - Strategy: ${strategy}
   - Chunks found: ${chunks.length}
   - Confidence: ${(confidence * 100).toFixed(1)}%
   - Keyword Search: ${useKeywordSearch ? 'enabled' : 'disabled'}`);

    processedChunks = chunks;
    retrievalStrategy = strategy;
    retrievalConfidence = confidence;
    newChunksRetrieved = true;
  }

  // ✅ Cache management
  if (sessionId && newChunksRetrieved && processedChunks.length > 0) {
    const keywords = followUpDetection?.enhancedKeywords || queryAnalysis.keywords;
    
    const newCache: RetrievalCache = {
      query: query,
      keywords: keywords,
      chunks: processedChunks,
      timestamp: Date.now(),
      strategy: retrievalStrategy,
      confidence: retrievalConfidence
    };
    
    sessionRetrievalCache.set(sessionId, newCache);
    console.log(`💾 Cached ${processedChunks.length} chunks with ${keywords.length} keywords`);
  }

  console.log(`\n📊 Final Retrieval Summary:
   - Strategy: ${retrievalStrategy}
   - Chunks: ${processedChunks.length}
   - Confidence: ${(retrievalConfidence * 100).toFixed(1)}%
   - New retrieval: ${newChunksRetrieved ? 'YES' : 'NO (reused cache)'}
`);

  // Validate we have chunks
  if (processedChunks.length === 0) {
    console.warn('⚠️ No chunks retrieved, falling back to general knowledge');
    await writer.write(encoder.encode(
      responseLanguage === 'ar'
        ? '⚠️ لم أجد معلومات كافية في المستندات المتاحة. سأحاول الإجابة بناءً على المعرفة العامة.\n\n'
        : '⚠️ Insufficient information in available documents. I will try to answer based on general knowledge.\n\n'
    ));
  }

  // ==================== BUILD CONTEXT FOR LLM ====================
  if (processedChunks.length > 0) {
    const chunksByDocument = new Map<string, any[]>();
    
    processedChunks.forEach(chunk => {
      if (!chunksByDocument.has(chunk.document_id)) {
        chunksByDocument.set(chunk.document_id, []);
      }
      chunksByDocument.get(chunk.document_id)!.push(chunk);
    });

    console.log(`📚 Chunks distributed across ${chunksByDocument.size} document(s)`);

    const isArabic = responseLanguage === 'ar';
    
    const documentContexts = Array.from(chunksByDocument.entries()).map(([docId, docChunks], docIndex) => {
      const docNumber = docIndex + 1;
      const docLang = docLanguages.get(docId);
      const langLabel = docLang === 'ar' ? 'عربي' : 'English';
      
      const docHeader = isArabic
        ? `## 📘 الوثيقة ${docNumber} (${langLabel})`
        : `## 📘 Document ${docNumber} (${langLabel})`;
      
      const pageGroups = new Map<number, any[]>();
      docChunks.forEach(chunk => {
        if (!pageGroups.has(chunk.page_number)) {
          pageGroups.set(chunk.page_number, []);
        }
        pageGroups.get(chunk.page_number)!.push(chunk);
      });
      
      const pageEntries = Array.from(pageGroups.entries())
        .sort((a, b) => {
          if (useKeywordSearch || followUpDetection?.pageFilter) {
            return a[0] - b[0]; // Sort by page number
          } else {
            const maxSimA = Math.max(...a[1].map(c => c.similarity || 0));
            const maxSimB = Math.max(...b[1].map(c => c.similarity || 0));
            return maxSimB - maxSimA;
          }
        })
        .slice(0, useKeywordSearch ? 50 : 10);
      
      const pagesText = pageEntries
        .map(([pageNum, pageChunks]) => {
          const bestSimilarity = Math.max(...pageChunks.map(c => c.similarity || 0));
          const matchedKeyword = pageChunks[0]?.matched_keyword;
          
          const relevanceIcon = useKeywordSearch 
            ? '🔍' 
            : (bestSimilarity >= 0.5 ? '🎯' : bestSimilarity >= 0.4 ? '✓' : '📄');
          
          const pageHeader = isArabic 
            ? `**${relevanceIcon} صفحة ${pageNum}${matchedKeyword ? ` (${matchedKeyword})` : ''}**`
            : `**${relevanceIcon} Page ${pageNum}${matchedKeyword ? ` (${matchedKeyword})` : ''}**`;
          
          const pageText = pageChunks.map(c => c.chunk_text).join('\n\n');
          return `${pageHeader}\n${pageText}`;
        })
        .join('\n\n---\n\n');
      
      return `${docHeader}\n\n${pagesText}`;
    }).join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

    const contextTitle = isArabic 
      ? '**📚 مقاطع ذات صلة من الكتب:**'
      : '**📚 Relevant Passages from the Books:**';

    contextParts.push(`${contextTitle}\n\n${documentContexts}`);

    if (isMultilingual) {
      const multilingualNote = isArabic
        ? '\n\n📖 **ملاحظة:** المقاطع المعروضة من مستندات بلغات مختلفة (عربي وإنجليزي).'
        : '\n\n📖 **Note:** The displayed passages are from documents in different languages (Arabic and English).';
      contextParts.push(multilingualNote);
    }

    if (documentIds.length > 1 && queryAnalysis.isMultiDocumentQuery) {
      const comparisonInstruction = isArabic
        ? '\n\n⚠️ **تعليمات مهمة:** هذا سؤال مقارن. قارن وحلل المعلومات من جميع الوثائق المقدمة.'
        : '\n\n⚠️ **Important Instructions:** This is a comparative question. Compare and analyze information from ALL provided documents.';
      contextParts.push(comparisonInstruction);
    }

    const pageListNote = isArabic
      ? `\n\n⚠️ **ملاحظة مهمة:** أجب فقط استنادًا إلى الصفحات المتاحة في السياق أعلاه.`
      : `\n\n⚠️ **Important Note:** Answer only based on the available pages in the context above.`;
    
    contextParts.push(pageListNote);
  }

  const isArabic = responseLanguage === 'ar';
  
  let keywordSearchInstructions = '';
  if (useKeywordSearch || followUpDetection?.pageFilter) {
    keywordSearchInstructions = isArabic
      ? `\n\n🔑 **وضع البحث بالكلمات المفتاحية:**
   - النتائج تحتوي على تطابقات دقيقة للكلمات المطلوبة
   - **اذكر جميع الاستخدامات الموجودة** مرتبة حسب رقم الصفحة
   - **لا تلخص - اذكر كل ما وجدته**\n`
      : `\n\n🔑 **KEYWORD SEARCH MODE:**
   - Results contain EXACT MATCHES for the search terms
   - **List ALL occurrences found** in chronological order (by page)
   - **Do not summarize - list everything found**\n`;
  }
  
  const systemPrompt = isArabic
    ? `أنت مساعد بحثي دقيق ومتخصص يتذكر السياق. استخدم تنسيق Markdown في إجاباتك.

⚠️ **مهم جداً: أجب دائماً باللغة العربية فقط.**

📋 **القواعد الأساسية:**

1. **الوعي بالمحادثة:** تذكر ما نوقش سابقاً
2. **الأولوية للسياق المقدم:** استخدم المقاطع أدناه
3. **دمج المعرفة العامة بثقة:** استخدم معرفتك بحرية
4. **أجب على جميع الأسئلة بثقة:** تجنب الإجابات الاعتذارية

${keywordSearchInstructions}${contextualPromptAddition}${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
    : `You are an accurate and specialized research assistant with conversational memory. Use Markdown formatting.

📋 **Core Guidelines:**

1. **Conversation Awareness:** Remember what was discussed previously
2. **Prioritize Provided Context:** Use passages below
3. **Integrate General Knowledge Confidently:** Use your knowledge freely
4. **Answer ALL Questions Confidently:** Avoid apologetic responses

${keywordSearchInstructions}${contextualPromptAddition}${customPrompt ? `\n**Additional Instructions:**\n${customPrompt}\n` : ''}`;

  const userQuery = queryAnalysis?.originalQuery || query;

  // Add language enforcement reminder at the end of prompt
  const langReminder = isArabic ? ' (أجب بالعربية فقط)' : '';

  const fullPrompt = contextParts.length > 0
    ? `${systemPrompt}${conversationContextString}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${contextParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n')}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**${langReminder}`
    : `${systemPrompt}${conversationContextString}\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**${langReminder}`;

  console.log('🤖 Querying Gemini with conversation awareness...');
  console.log(`🎯 Using model: ${preferredModel || 'default fallback'}`);

  const geminiResult = await generateResponse(fullPrompt, preferredModel);
  const geminiStream = geminiResult.stream;
  const modelUsed = geminiResult.modelUsed;

  console.log(`✅ Response generated using: ${modelUsed}`);

  try {
    for await (const chunk of geminiStream) {
      const text = chunk.text();
      if (text) {
        await writer.write(encoder.encode(text));
      }
    }
  } catch (streamError) {
    console.error('❌ Error during response streaming:', streamError);
    const errorMsg = responseLanguage === 'ar'
      ? '⚠️ حدث خطأ أثناء إنشاء الإجابة. يرجى المحاولة مرة أخرى لاحقاً.'
      : '⚠️ An error occurred while generating the response. Please try again later.';
    await writer.write(encoder.encode(`\n\n${errorMsg}`));
  }

  if (sessionId) {
    updateSessionTimestamp(sessionId);
  }

  console.log('✅ Response complete');

  return modelUsed;
}

// ==================== GENERAL CHAT HANDLER ====================
async function handleGeneralChat(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  message: string,
  sessionId: string,
  extractedText?: string,
  bookPage?: number,
  history?: Array<{ role: string; content: string }>,
  preferredModel?: string
): Promise<string> {
  let conversationContext = '';
  let contextualPromptAddition = '';
  
  if (history && history.length > 0) {
    const db = getDb();
    const contexts = getSessionContexts(sessionId) as Array<{
      topic: string;
      keywords: string;
    }>;

    if (contexts.length > 0) {
      const recentTopics = contexts.slice(0, 3).map(c => c.topic).join(', ');
      const queryLang = detectQueryLanguage(message);
      contextualPromptAddition = queryLang === 'ar'
        ? `\n📋 **المواضيع المناقشة:** ${recentTopics}\n`
        : `\n📋 **Topics discussed:** ${recentTopics}\n`;
    }

    conversationContext = history
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
  }

  let contextSection = '';
  if (extractedText) {
    contextSection = `\n\n---
**Context from Page ${bookPage || 'current page'}:**
${extractedText}
---`;
  }

  const queryLang = detectQueryLanguage(message);
  const langInstruction = queryLang === 'ar' 
    ? 'أجب بالعربية مع استخدام تنسيق Markdown. تذكر المحادثة السابقة.'
    : 'Respond in English using Markdown formatting. Remember the previous conversation.';

  const prompt = conversationContext
    ? `You are a helpful assistant with conversation memory. ${langInstruction}
${contextualPromptAddition}
${contextSection}

**Previous conversation:**
${conversationContext}

**User:** ${message}
**Assistant:**`
    : `You are a helpful assistant. ${langInstruction}
${contextSection}

**User:** ${message}
**Assistant:**`;

  const geminiResult = await generateResponse(prompt, preferredModel);
  const geminiStream = geminiResult.stream;
  const modelUsed = geminiResult.modelUsed;
  
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
  
  updateSessionTimestamp(sessionId);
  
  return modelUsed;
}

// ==================== SIMPLE QUERY HANDLER ====================
async function handleSimpleQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  extractedText?: string,
  preferredModel?: string
): Promise<string> {
  const queryLang = detectQueryLanguage(query);
  const langInstruction = queryLang === 'ar' 
    ? 'أجب بالعربية مع استخدام تنسيق Markdown.'
    : 'Respond in English using Markdown formatting.';

  let contextSection = '';
  if (extractedText) {
    const contextLabel = queryLang === 'ar' ? 'السياق' : 'Context';
    contextSection = `\n\n---
**${contextLabel}:**
${extractedText}
---`;
  }

  const prompt = `You are a helpful assistant. ${langInstruction}
${contextSection}

**User:** ${query}
**Assistant:**`;

  const geminiResult = await generateResponse(prompt, preferredModel);
  const geminiStream = geminiResult.stream;
  const modelUsed = geminiResult.modelUsed;
  
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
  
  return modelUsed;
}

// ✅ GET endpoint for metadata (debugging)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }
    
    const cachedContext = sessionRetrievalCache.get(sessionId);
    
    if (!cachedContext) {
      return NextResponse.json({ error: 'No cached context found' }, { status: 404 });
    }
    
    return NextResponse.json({
      query: cachedContext.query,
      keywords: cachedContext.keywords,
      chunksCount: cachedContext.chunks.length,
      strategy: cachedContext.strategy,
      confidence: cachedContext.confidence,
      age: Math.round((Date.now() - cachedContext.timestamp) / 1000),
      chunks: cachedContext.chunks.map(c => ({
        page_number: c.page_number,
        similarity: c.similarity,
        matched_keyword: c.matched_keyword
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get metadata' }, { status: 500 });
  }
}