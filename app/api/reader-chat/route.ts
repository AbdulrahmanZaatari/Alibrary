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
  getSessionContexts,
  getUserSettings
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
import { performMultiPassGeneration, formatMultiPassResult } from '@/lib/multiPassGeneration';
import { expandQuery, buildKeywordList } from '@/lib/queryExpansion';
import { detectQueryContext, detectContextConflicts } from '@/lib/literaryPrompts';
import { detectPageRange } from '@/lib/wordScanDetection';
import { handleSpecialQuery } from '@/lib/specialQueryHandlers';

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
        enableMultiPass = false,
        preferredModel, 
        useReranking = true,
        useKeywordSearch = false,
        cachedChunks,
        reuseCachedContext = false,
        // ✅ NEW: Research mode settings
        researchDepth = 2,
        verificationMode = false,
        listOutput = false,
      } = body;

      const userMessage = message || query;

      console.log('📚 Reader Chat:', {
        sessionId,
        hasMessage: !!userMessage,
        hasCorpus: documentIds?.length > 0,
        corpusCount: documentIds?.length || 0,
        enableMultiHop,
        enableMultiPass,
        preferredModel,
        useKeywordSearch,
        hasCachedChunks: !!cachedChunks,
        reuseCachedContext,
        researchDepth,
        verificationMode,
        listOutput
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
          enableMultiPass,
          sessionId,
          history,
          bookTitle,
          bookPage,
          preferredModel,
          useKeywordSearch ? false : useReranking,
          useKeywordSearch,
          followUpDetection,
          cachedChunks,
          reuseCachedContext,
          // ✅ NEW: Pass research mode settings
          verificationMode,
          listOutput
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
  enableMultiPass: boolean = false,
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
  reuseCachedContext: boolean = false,
  // ✅ NEW: Research mode settings
  verificationMode: boolean = false,
  listOutput: boolean = false
): Promise<string> {
  // ==================== SPECIAL QUERY HANDLING ====================
  // Check for word analysis, de-jargon, glossary queries FIRST
  try {
    const specialQuery = await handleSpecialQuery(query, documentIds);
    
    if (specialQuery.detected) {
      if (specialQuery.type === 'glossary') {
        await writer.write(encoder.encode(
          `🔖 **طلب قائمة مصطلحات**\n\n` +
          `لقد طلبت إنشاء قائمة مصطلحات للصفحات ${specialQuery.params.pageStart} إلى ${specialQuery.params.pageEnd}.\n\n` +
          `استخدم زر "إنشاء قائمة مصطلحات" في الإعدادات.`
        ));
        await writer.close();
        return 'special-glossary';
      }
      
      // word-list: Show stats only, frontend shows CSV
      if (specialQuery.type === 'word-list') {
        console.log(`📋 Word list query - returning indicator for CSV display`);
        const word = specialQuery.params.word;
        const totalOccurrences = specialQuery.totalOccurrences || 0;
        const pagesFound = specialQuery.pagesFound || [];
        
        await writer.write(encoder.encode(
          `🔍 **بحث كلمة: "${word}"**\n\n` +
          `---\n\n` +
          `📊 **إحصائيات الورود:**\n` +
          `- عدد مرات الورود: **${totalOccurrences}** مرة\n` +
          `- الصفحات: ${pagesFound.slice(0, 30).join(', ')}${pagesFound.length > 30 ? '...' : ''}\n\n` +
          `---\n\n` +
          `✅ تم تحميل جميع المواضع في جدول البيانات أعلاه.\n\n` +
          `💡 **للحصول على تحليل معمّق:** اسأل "حلّل استخدام كلمة ${word} في الكتاب"`
        ));
        await writer.close();
        return 'special-word-list';
      }
      
      // word-analysis and de-jargon: Generate AI response with context
      if (specialQuery.context && (specialQuery.type === 'word-analysis' || specialQuery.type === 'de-jargon')) {
        console.log(`🎯 Processing ${specialQuery.type} with ${specialQuery.chunks?.length || 0} chunks`);
        
        const prompt = `${query}\n\n${specialQuery.context}`;
        const { stream: specialStream, modelUsed } = await generateResponse(
          prompt,
          preferredModel
        );
        
        for await (const chunk of specialStream) {
          const text = chunk.text();
          if (text) {
            await writer.write(encoder.encode(text));
          }
        }
        await writer.close();
        return modelUsed || 'gemini-special';
      }
    }
  } catch (error) {
    console.error('⚠️ Special query handling error, continuing with normal flow:', error);
  }
  // ==================== END SPECIAL QUERY HANDLING ====================

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

  // ✅ Detect page range in query
  const pageRangeDetection = detectPageRange(query);
  let pageRange: { startPage: number; endPage: number } | undefined;
  
  if (pageRangeDetection.hasPageRange && pageRangeDetection.startPage && pageRangeDetection.endPage) {
    pageRange = {
      startPage: pageRangeDetection.startPage,
      endPage: pageRangeDetection.endPage
    };
    console.log(`📄 Page range detected: ${pageRange.startPage} - ${pageRange.endPage} (confidence: ${pageRangeDetection.confidence})`);
  }

  const requiresMultiHop = enableMultiHop && isComplexQuery(query);
  
  if (requiresMultiHop) {
    console.log('🧠 Complex query detected - activating multi-hop reasoning');
    
    try {
      const multiHopResult = await performMultiHopReasoning(
        query,
        documentIds,
        docLanguages,
        4,
        responseLanguage,
        false, // correctSpelling
        false, // aggressiveCorrection
        pageRange // Pass page range filter
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

  // ==================== MULTI-PASS GENERATION PATH ====================
  if (enableMultiPass) {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║ 🔄 MULTI-PASS GENERATION MODE (Reader Chat)                   ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║ 📝 Query: "${query.substring(0, 45)}${query.length > 45 ? '...' : ''}"`);
    console.log(`║ 🔢 Planned passes: 2`);
    console.log(`║ 📚 Documents: ${documentIds.length}`);
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    
    try {
      const startTime = Date.now();
      
      const multiPassResult = await performMultiPassGeneration(
        query,
        documentIds,
        queryLanguage,
        2, // 2 passes for reader mode
        useReranking,
        useKeywordSearch,
        preferredModel
      );

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      
      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│ ✅ MULTI-PASS GENERATION COMPLETE (Reader)                  │');
      console.log('└─────────────────────────────────────────────────────────────┘');
      console.log(`\n📊 MULTI-PASS IMPACT SUMMARY:`);
      console.log(`   ⏱️  Total time: ${elapsedTime}s`);
      console.log(`   🔄 Passes completed: ${multiPassResult.passDetails.length}`);
      console.log(`   📄 Total chunks retrieved: ${multiPassResult.totalChunksUsed}`);
      console.log(`   🔧 Refinements made: ${multiPassResult.refinementCount}`);
      console.log(`   🎯 Final confidence: ${multiPassResult.confidence}%`);
      
      console.log(`\n📋 PASS-BY-PASS BREAKDOWN:`);
      multiPassResult.passDetails.forEach((pass) => {
        console.log(`   Pass ${pass.passNumber}: ${pass.action}`);
        console.log(`      └─ Chunks: ${pass.chunksRetrieved}`);
        if (pass.gapsIdentified && pass.gapsIdentified.length > 0) {
          console.log(`      └─ Gaps found: ${pass.gapsIdentified.length}`);
          pass.gapsIdentified.forEach(gap => console.log(`         • ${gap.substring(0, 50)}...`));
        }
        if (pass.refinements && pass.refinements.length > 0) {
          console.log(`      └─ Refinement queries: ${pass.refinements.length}`);
        }
      });
      console.log('─────────────────────────────────────────────────────────────\n');

      const formattedResponse = formatMultiPassResult(multiPassResult, queryLanguage, true);
      await writer.write(encoder.encode(formattedResponse));
      
      return preferredModel || 'gemini-multi-pass';

    } catch (error) {
      console.error('❌ Multi-pass generation failed, falling back to standard:', error);
    }
  }

  console.log(enableMultiHop ? '📖 Using standard retrieval (fallback)' : '📖 Using standard retrieval strategy');
  
  // ==================== ARABIC QUERY EXPANSION (Automatic - respects user setting) ====================
  let expandedKeywords: string[] = [];
  const settings = getUserSettings();
  const queryExpansionEnabled = settings?.query_expansion_enabled === 1;
  
  if (queryLanguage === 'ar' && queryExpansionEnabled) {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 🔤 ARABIC QUERY EXPANSION (Reader Chat - Automatic)         │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    console.log(`📝 Original Query: "${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"`);
    
    const expansion = await expandQuery(query, queryLanguage, true);
    expandedKeywords = buildKeywordList(expansion);
    
    console.log(`\n✨ EXPANSION IMPACT:`);
    console.log(`   📊 Synonyms found: ${expansion.synonyms.length}`);
    if (expansion.synonyms.length > 0) {
      console.log(`      → ${expansion.synonyms.slice(0, 5).join('، ')}`);
    }
    console.log(`   📊 Related terms: ${expansion.relatedTerms.length}`);
    if (expansion.relatedTerms.length > 0) {
      console.log(`      → ${expansion.relatedTerms.slice(0, 5).join('، ')}`);
    }
    console.log(`   📊 Spelling variants: ${expansion.variants.length}`);
    if (expansion.variants.length > 0) {
      console.log(`      → ${expansion.variants.slice(0, 5).join('، ')}`);
    }
    console.log(`   📊 Total keywords for search: ${expandedKeywords.length}`);
    console.log(`   🎯 Confidence: ${Math.round(expansion.confidence * 100)}%`);
    console.log('─────────────────────────────────────────────────────────────');
  } else if (queryLanguage === 'ar' && !queryExpansionEnabled) {
    console.log('⏭️ Query expansion disabled by user setting');
  }

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
  
  // ✅ Add expanded keywords to query analysis (from Arabic query expansion)
  if (expandedKeywords.length > 0) {
    const originalKeywordCount = queryAnalysis.keywords.length;
    queryAnalysis.keywords = [...new Set([
      ...queryAnalysis.keywords,
      ...expandedKeywords
    ])];
    console.log(`📊 Keywords enriched: ${originalKeywordCount} → ${queryAnalysis.keywords.length}`);
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

  // ✅ Apply page range filter if detected (for standard retrieval path)
  if (pageRange && processedChunks.length > 0) {
    const originalCount = processedChunks.length;
    processedChunks = processedChunks.filter(chunk => {
      const pageNum = chunk.page_number || chunk.metadata?.page_number;
      return pageNum >= pageRange.startPage && pageNum <= pageRange.endPage;
    });
    console.log(`📄 Page range filter applied: ${originalCount} → ${processedChunks.length} chunks (pages ${pageRange.startPage}-${pageRange.endPage})`);
    
    // If filtering removed all chunks, fetch specifically from those pages
    if (processedChunks.length === 0) {
      console.log(`⚠️ No chunks in page range, fetching directly from pages ${pageRange.startPage}-${pageRange.endPage}`);
      
      const { data: pageChunks, error } = await supabaseAdmin
        .from('embeddings')
        .select('*')
        .in('document_id', documentIds)
        .gte('page_number', pageRange.startPage)
        .lte('page_number', pageRange.endPage)
        .order('page_number', { ascending: true });
      
      if (!error && pageChunks && pageChunks.length > 0) {
        processedChunks = pageChunks.map(chunk => ({
          ...chunk,
          chunk_text: chunk.chunk_text,
          content: chunk.chunk_text,
          similarity: 1.0
        }));
        console.log(`✅ Direct fetch: ${processedChunks.length} chunks from pages ${pageRange.startPage}-${pageRange.endPage}`);
      }
    }
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
  
  // ✅ Literary context detection for chapter/story awareness
  const queryContext = detectQueryContext(query);
  if (queryContext.chapterNumber || queryContext.storyNumber) {
    console.log(`📖 User specified context:`, queryContext);
  }
  
  // ✅ Check for context conflicts (same character in different stories)
  const conflictCheck = detectContextConflicts(processedChunks.map(c => ({
    metadata: c.metadata
  })));
  
  if (conflictCheck.hasConflict) {
    console.log(`⚠️ Context conflicts detected for characters: ${conflictCheck.conflictingCharacters.join(', ')}`);
  }
  
  // ✅ Build conflict warning if needed
  let conflictWarning = '';
  if (conflictCheck.hasConflict && !queryContext.chapterNumber && !queryContext.storyNumber) {
    conflictWarning = isArabic
      ? `\n⚠️ **تنبيه:** وجدت شخصيات بنفس الاسم (${conflictCheck.conflictingCharacters.join('، ')}) في فصول/قصص مختلفة. إذا أردت سياقاً محدداً، اطلب من المستخدم تحديد رقم الفصل أو القصة.\n`
      : `\n⚠️ **Note:** Found characters with the same name (${conflictCheck.conflictingCharacters.join(', ')}) in different chapters/stories. If specific context is needed, ask user to specify chapter or story number.\n`;
  }
  
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
  
  // ✅ NEW: Verification Mode Instructions
  let verificationInstructions = '';
  if (verificationMode) {
    verificationInstructions = isArabic
      ? `\n\n⚖️ **وضع التحقق (البحث عن أدلة مؤيدة ومعارضة):**

**تنسيق الإخراج المطلوب:**

## ✅ أدلة مؤيدة
لكل دليل:
📄 **صفحة X** - [اسم المستند]
> "الاقتباس المباشر..."
🏷️ السياق: [ملاحظة مختصرة]

---

## ⚠️ أدلة معارضة أو مخففة
[نفس التنسيق]

---

## ⚖️ التقييم
- قوة الأدلة المؤيدة: [قوية/متوسطة/ضعيفة]
- قوة الأدلة المعارضة: [قوية/متوسطة/ضعيفة]
- الخلاصة: [جملة واحدة]

**مهم: ابحث بنشاط عن الأدلة المعارضة، لا تكتفِ بالمؤيدة فقط**\n`
      : `\n\n⚖️ **VERIFICATION MODE (Search for supporting AND opposing evidence):**

**Required Output Format:**

## ✅ Supporting Evidence
For each piece of evidence:
📄 **Page X** - [Document Name]
> "Direct quote..."
🏷️ Context: [Brief 1-line note]

---

## ⚠️ Opposing or Nuancing Evidence
[Same format]

---

## ⚖️ Assessment
- Strength of supporting evidence: [Strong/Moderate/Weak]
- Strength of opposing evidence: [Strong/Moderate/Weak]
- Conclusion: [One sentence]

**Important: Actively search for opposing evidence, don't just confirm**\n`;
  }
  
  // ✅ NEW: List Output Mode Instructions
  let listOutputInstructions = '';
  if (listOutput && !verificationMode) {
    listOutputInstructions = isArabic
      ? `\n\n�🚨🚨 **تحذير: وضع القائمة الصارم - ممنوع التحليل** 🚨🚨🚨

**أنت الآن في وضع جمع الأدلة فقط. مهمتك الوحيدة هي سرد النتائج.**

⛔ **ممنوع منعاً باتاً:**
- ❌ لا تكتب أي تحليل أدبي أو رمزي
- ❌ لا تكتب أي تعليقات أو تفسيرات
- ❌ لا تكتب أي استنتاجات أو ملخصات
- ❌ لا تكتب أي مقدمة أو خاتمة تحليلية
- ❌ لا تضف أي قيمة تحليلية - فقط اسرد ما وجدته

✅ **المطلوب فقط:**
اسرد كل حالة بهذا الشكل الدقيق:

📄 **ص. X**
> "الاقتباس الحرفي من النص"

📄 **ص. Y**
> "الاقتباس التالي"

(وهكذا لكل حالة...)

---
**المجموع:** X حالات

⚠️ **تذكير أخير: لا تحلل - فقط اسرد. أي تحليل يعتبر خطأ.**\n`
      : `\n\n🚨🚨🚨 **WARNING: STRICT LIST MODE - NO ANALYSIS ALLOWED** 🚨🚨🚨

**You are now in evidence collection mode. Your ONLY task is to list findings.**

⛔ **ABSOLUTELY FORBIDDEN:**
- ❌ NO literary or symbolic analysis
- ❌ NO commentary or interpretations  
- ❌ NO conclusions or summaries
- ❌ NO introductions or analytical endings
- ❌ NO added value analysis - just list what you found

✅ **REQUIRED OUTPUT ONLY:**
List each occurrence in this exact format:

📄 **p. X**
> "Exact quote from text"

📄 **p. Y**
> "Next quote"

(continue for each occurrence...)

---
**Total:** X occurrences

⚠️ **FINAL REMINDER: Do NOT analyze - just LIST. Any analysis is an error.**\n`;
  }
  
  const systemPrompt = isArabic
    ? `أنت مساعد بحثي دقيق ومتخصص يتذكر السياق. استخدم تنسيق Markdown في إجاباتك.

⚠️ **مهم جداً: أجب دائماً باللغة العربية فقط.**

📋 **القواعد الأساسية:**

1. **الوعي بالمحادثة:** تذكر ما تمت مناقشته سابقاً في هذه الجلسة
2. **أولوية السياق المقدم:** استخدم المقتطفات المقدمة أدناه بشكل أساسي
3. **دمج المعرفة العامة بثقة:** أضف معرفتك العامة بحرية لإثراء الإجابة
4. **التحليل الأدبي:** لا تكتف بالنقل - حلل وفسّر واربط الأفكار وأضف قيمة تحليلية
5. **الرمزية والاستعارة:** افهم وفسّر الرموز والاستعارات في النصوص الأدبية
6. **التفريق بين السياقات:** إذا ذكر المستخدم فصلاً أو قصة محددة، ركز عليها فقط

📖 **الإسناد والتوثيق (مهم جداً):**
- **عند الاقتباس أو الإشارة لنص معين، اذكر دائماً رقم الصفحة** مثل: (صفحة 15) أو [ص. 15]
- **استخدم أرقام الصفحات من المقتطفات المقدمة**
- **لا تقتبس بدون ذكر المصدر (رقم الصفحة)**
${conflictWarning}
${keywordSearchInstructions}${verificationInstructions}${listOutputInstructions}${contextualPromptAddition}${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
    : `You are an accurate and specialized research assistant with conversational memory. Use Markdown formatting.

📋 **Core Guidelines:**

1. **Conversation Awareness:** Remember what was discussed previously
2. **Prioritize Provided Context:** Use passages below as your primary source
3. **Integrate General Knowledge Confidently:** Use your knowledge freely to enrich responses
4. **Literary Analysis:** Don't just quote - analyze, interpret, and connect ideas
5. **Symbolism & Metaphor:** Understand and interpret symbols and metaphors in literary texts
6. **Context Separation:** If user specifies a chapter or story, focus only on that context

📖 **Citation & Attribution (Very Important):**
- **Always cite page numbers when quoting or referencing specific text**, e.g., (page 15) or [p. 15]
- **Use page numbers from the provided excerpts**
- **Never quote without citing the source (page number)**
${conflictWarning}
${keywordSearchInstructions}${verificationInstructions}${listOutputInstructions}${contextualPromptAddition}${customPrompt ? `\n**Additional Instructions:**\n${customPrompt}\n` : ''}`;

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