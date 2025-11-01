import { NextRequest } from 'next/server';
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
import { retrieveSmartContext } from '@/lib/smartRetrieval';
import { correctChunksBatch } from '@/lib/spellingCorrection';
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

  (async () => {
    try {
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
        preferredModel
      } = await req.json();

      const userMessage = message || query;

      console.log('📚 Reader Chat:', {
        sessionId,
        hasMessage: !!userMessage,
        hasCorpus: documentIds?.length > 0,
        corpusCount: documentIds?.length || 0,
        correctSpelling,
        aggressiveCorrection,
        enableMultiHop,
        preferredModel
      });

      if (!userMessage) {
        await writer.write(encoder.encode('Error: Missing message or query'));
        await writer.close();
        return;
      }

      // ✅ STEP 1: Load conversation history (if session exists)
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
        
        history.reverse(); // Chronological order
        console.log(`📜 Loaded ${history.length} previous messages`);
      }

      // ✅ STEP 2: Analyze conversation context (every 3 messages)
      if (sessionId && history.length > 0 && history.length % 3 === 0) {
        console.log('🧠 Analyzing reader chat context...');
        
        const queryLanguage = detectQueryLanguage(userMessage);
        const conversationHistory = history.map(msg => ({
          role: msg.role,
          content: msg.content
        }));

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
          const conversationHistory = history.map(msg => ({
            role: msg.role,
            content: msg.content
          }));

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

      // ✅ Route to appropriate handler
      if (documentIds && documentIds.length > 0) {
        console.log('🔄 Using corpus retrieval for Reader Chat');
        await handleCorpusQuery(
          writer, 
          encoder, 
          userMessage, 
          documentIds, 
          extractedText, 
          correctSpelling, 
          aggressiveCorrection,
          customPrompt,
          enableMultiHop,
          sessionId,
          history,
          bookTitle,
          bookPage,
          preferredModel
        );
      } 
      else if (sessionId) {
        console.log('💬 Using general chat with history for Reader Chat');
        await handleGeneralChat(writer, encoder, userMessage, sessionId, extractedText, bookPage, history);
      }
      else {
        console.log('📝 Using simple query response');
        await handleSimpleQuery(writer, encoder, userMessage, extractedText);
      }

      // ✅ STEP 4: Save user message
      if (sessionId) {
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        addChatMessage({
          id: messageId,
          sessionId,
          role: 'user',
          content: userMessage,
          mode: 'reader',
          bookId,
          bookTitle,
          bookPage,
          extractedText
        });

        updateSessionTimestamp(sessionId);

        // Extract topics
        const topics = extractTopicsFromMessage(userMessage);
        if (topics.length > 0) {
          console.log('📌 Extracted topics:', topics);
        }
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

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ==================== CORPUS QUERY HANDLER (WITH OPTIONAL MULTI-HOP) ====================
async function handleCorpusQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  documentIds: string[],
  extractedText?: string,
  correctSpelling?: boolean,
  aggressiveCorrection?: boolean,
  customPrompt?: string,
  enableMultiHop: boolean = false,
  sessionId?: string,
  history?: Array<{ role: string; content: string }>,
  bookTitle?: string,
  bookPage?: number,
  preferredModel?: string
) {
  // ✅ Build conversation context string
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

    // Build recent conversation history (last 4 messages)
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

  // ✅ Step 1: Detect languages for all documents
  const { primary: documentLanguage, languages: docLanguages, isMultilingual } = 
    await detectMultipleDocumentLanguages(documentIds);

  // ✅ Step 2: Detect user's query language
  const queryLanguage = detectQueryLanguage(query);
  console.log(`🗣️ Query language: ${queryLanguage}`);

  // ✅ Step 3: Determine response language
  const responseLanguage = queryLanguage;
  console.log(`💬 Response will be in: ${responseLanguage}`);

  // ✅ Step 4: Check if query requires multi-hop reasoning (only if enabled)
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
        correctSpelling || false,
        aggressiveCorrection || false
      );
      
      // Add conversation context prefix
      let conversationPrefix = '';
      if (conversationContextString) {
        conversationPrefix = responseLanguage === 'ar'
          ? `💭 **استكمالاً لمحادثتنا:**\n\n${conversationContextString}\n\n---\n\n`
          : `💭 **Continuing our conversation:**\n\n${conversationContextString}\n\n---\n\n`;
      }
      
      const formattedResponse = conversationPrefix + formatMultiHopResponse(multiHopResult, responseLanguage);
      await writer.write(encoder.encode(formattedResponse));
      
      console.log('✅ Multi-hop response complete');
      return;
      
    } catch (error) {
      console.error('❌ Multi-hop reasoning failed, falling back to standard retrieval:', error);
    }
  }

  // ==================== STANDARD RETRIEVAL (DEFAULT OR FALLBACK) ====================
  console.log(enableMultiHop ? '📖 Using standard retrieval (fallback)' : '📖 Using standard retrieval strategy');
  
  const contextParts: string[] = [];

  // ✅ Step 5: Analyze and translate query
  const queryAnalysis = await analyzeQuery(query, documentLanguage);
  console.log('🔍 Query Analysis:', {
    original: queryAnalysis.originalQuery,
    translated: queryAnalysis.translatedQuery,
    type: queryAnalysis.queryType,
    keywords: queryAnalysis.keywords,
    isMultiDoc: queryAnalysis.isMultiDocumentQuery
  });

  // ✅ Step 6: Add extracted text if provided
  if (extractedText) {
    const extractLabel = responseLanguage === 'ar' 
      ? '**📄 نص الصفحة الحالية:**'
      : '**📄 Current Page Text:**';
    contextParts.push(`${extractLabel}\n${extractedText}`);
  }

  // ✅ Step 7: Smart corpus retrieval
  console.log('🔄 Starting smart retrieval...');
  const { chunks, strategy, confidence } = await retrieveSmartContext(queryAnalysis, documentIds);
  
  console.log(`📊 Retrieval Results:
   - Strategy: ${strategy}
   - Chunks found: ${chunks.length}
   - Confidence: ${(confidence * 100).toFixed(1)}%`);

  // ✅ Step 8: Process chunks with optional spelling correction
  let processedChunks = chunks;
  if (correctSpelling && chunks.length > 0) {
    console.log('🔧 Applying spelling correction...');
    
    const chunksByDoc = new Map<string, any[]>();
    chunks.forEach(chunk => {
      const docId = chunk.document_id;
      if (!chunksByDoc.has(docId)) {
        chunksByDoc.set(docId, []);
      }
      chunksByDoc.get(docId)!.push(chunk);
    });

    processedChunks = [];
    for (const [docId, docChunks] of chunksByDoc.entries()) {
      const docLang = docLanguages.get(docId) || documentLanguage;
      const corrected = await correctChunksBatch(docChunks, docLang, aggressiveCorrection);
      processedChunks.push(...corrected);
    }
  }

  // ✅ Step 9: Group chunks by document and format context
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
    
    // ✅ Build document-separated context
    const documentContexts = Array.from(chunksByDocument.entries()).map(([docId, docChunks], docIndex) => {
      const docNumber = docIndex + 1;
      const docLang = docLanguages.get(docId);
      const langLabel = docLang === 'ar' ? 'عربي' : 'English';
      
      const docHeader = isArabic
        ? `## 📘 الوثيقة ${docNumber} (${langLabel})`
        : `## 📘 Document ${docNumber} (${langLabel})`;
      
      // Group by pages within this document
      const pageGroups = new Map<number, any[]>();
      docChunks.forEach(chunk => {
        if (!pageGroups.has(chunk.page_number)) {
          pageGroups.set(chunk.page_number, []);
        }
        pageGroups.get(chunk.page_number)!.push(chunk);
      });
      
      const pageEntries = Array.from(pageGroups.entries())
        .sort((a, b) => {
          const maxSimA = Math.max(...a[1].map(c => c.similarity || 0));
          const maxSimB = Math.max(...b[1].map(c => c.similarity || 0));
          return maxSimB - maxSimA;
        })
        .slice(0, 10);
      
      const pagesText = pageEntries
        .map(([pageNum, pageChunks]) => {
          const bestSimilarity = Math.max(...pageChunks.map(c => c.similarity || 0));
          const relevanceIcon = bestSimilarity >= 0.5 ? '🎯' : bestSimilarity >= 0.4 ? '✓' : '📄';
          const hasCorrected = pageChunks.some(c => c.corrected);
          const correctionBadge = hasCorrected ? ' ✨' : '';
          
          const pageHeader = isArabic 
            ? `**${relevanceIcon} صفحة ${pageNum}**${correctionBadge}`
            : `**${relevanceIcon} Page ${pageNum}**${correctionBadge}`;
          
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

    // ✅ Add multilingual note if applicable
    if (isMultilingual) {
      const multilingualNote = isArabic
        ? '\n\n📖 **ملاحظة:** المقاطع المعروضة من مستندات بلغات مختلفة (عربي وإنجليزي).'
        : '\n\n📖 **Note:** The displayed passages are from documents in different languages (Arabic and English).';
      contextParts.push(multilingualNote);
    }

    // ✅ Add multi-document analysis instruction
    if (documentIds.length > 1 && queryAnalysis.isMultiDocumentQuery) {
      const comparisonInstruction = isArabic
        ? '\n\n⚠️ **تعليمات مهمة:** هذا سؤال مقارن. قارن وحلل المعلومات من جميع الوثائق المقدمة. أشر بوضوح إلى أوجه التشابه والاختلاف والجوانب الفريدة لكل وثيقة.'
        : '\n\n⚠️ **Important Instructions:** This is a comparative question. Compare and analyze information from ALL provided documents. Clearly indicate similarities, differences, and unique aspects of each document.';
      contextParts.push(comparisonInstruction);
    }

    // ✅ Add page validation
    const docPageMap = new Map<string, number[]>();
    processedChunks.forEach(chunk => {
      if (!docPageMap.has(chunk.document_id)) {
        docPageMap.set(chunk.document_id, []);
      }
      if (!docPageMap.get(chunk.document_id)!.includes(chunk.page_number)) {
        docPageMap.get(chunk.document_id)!.push(chunk.page_number);
      }
    });
    
    const pageListNote = isArabic
      ? `\n\n⚠️ **ملاحظة مهمة:** أجب فقط استنادًا إلى الصفحات المتاحة في السياق أعلاه. لا تذكر أي صفحات أخرى.`
      : `\n\n⚠️ **Important Note:** Answer only based on the available pages in the context above. Do not reference any other pages.`;
    
    contextParts.push(pageListNote);
  } else {
    console.warn('⚠️ No relevant chunks found');
  }

  // ✅ Step 10: Build enhanced prompt with conversation awareness
  const isArabic = responseLanguage === 'ar';
  
  const systemPrompt = isArabic
  ? `أنت مساعد بحثي دقيق ومتخصص يتذكر السياق. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الوعي بالمحادثة:**
   - **تذكر ما نوقش سابقاً** في هذه المحادثة
   - عند سؤالك عن محادثات سابقة، ارجع إلى السياق أدناه
   - اربط الأسئلة الجديدة بالمواضيع السابقة عند الصلة

2. **الأولوية للسياق المقدم:**
   - إذا كانت الإجابة موجودة في المقاطع أدناه، استخدمها وأشر إلى رقم الصفحة والوثيقة
   - اقتبس المعلومات بدقة من السياق

3. **دمج المعرفة العامة بثقة:**
   - **استخدم معرفتك العامة بحرية** لتقديم إجابات مفيدة وشاملة
   - عند تحليل الأسلوب الأدبي أو المقارنة، استخدم ما هو متاح في النص ثم أضف من معرفتك
   - ضع علامات واضحة:
     * **[من النص - صفحة X]** للمعلومات من السياق
     * **[من المعرفة العامة]** للمعلومات الخارجية
   - **لا تقل "لا يمكنني" أو "يحتاج المزيد من المعلومات"** - قدم أفضل إجابة ممكنة

4. **أجب على جميع الأسئلة بثقة:**
   - قدم إجابات مباشرة ومفيدة
   - إذا لم يكن السياق كافياً، استخدم معرفتك لتكملة الإجابة
   - **تجنب الإجابات الاعتذارية أو المترددة**

5. **تحليل الأسلوب الأدبي - نهج عملي:**
   - حلل العناصر المتاحة في النص (السرد، اللغة، المواضيع، الأسلوب)
   - قارن بكتّاب مشهورين بناءً على هذه العناصر
   - قدم أمثلة محددة من النص المتاح
   - أضف من معرفتك عن الكتّاب المشابهين
   - **كن حاسماً في استنتاجاتك**

6. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم القوائم النقطية والمرقمة
   - استخدم > للاقتباسات من النص

${isMultilingual ? '7. **تعدد اللغات:** قد تحتوي المقاطع على نصوص بالإنجليزية، ترجمها حسب الحاجة\n' : ''}

${contextualPromptAddition}
${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
  : `You are an accurate and specialized research assistant with conversational memory. Use Markdown formatting in your responses.

📋 **Core Guidelines:**

1. **Conversation Awareness:**
   - **Remember what was discussed previously** in this conversation
   - When asked about previous exchanges, refer to the context below
   - Connect new questions to prior topics when relevant

2. **Prioritize Provided Context:**
   - Use passages below and cite page numbers when available
   - Quote information accurately from context

3. **Integrate General Knowledge Confidently:**
   - **Use your general knowledge freely** to provide helpful, comprehensive answers
   - When analyzing literary style or making comparisons, use available text then add from your knowledge
   - Use clear markers:
     * **[From Text - Page X]** for context information
     * **[From General Knowledge]** for external information
   - **Never say "I cannot" or "I need more information"** - provide the best answer possible

4. **Answer ALL Questions Confidently:**
   - Provide direct, helpful answers
   - If context is insufficient, use your knowledge to complete the answer
   - **Avoid apologetic or hesitant responses**

5. **Literary Style Analysis - Practical Approach:**
   - Analyze available elements in text (narrative, language, themes, style)
   - Compare to famous writers based on these elements
   - Provide specific examples from available text
   - Add from your knowledge about similar writers
   - **Be decisive in your conclusions**

6. **Markdown Formatting:**
   - Use **bold** for emphasis
   - Use bullet and numbered lists
   - Use > for quotes from text

${isMultilingual ? '7. **Multilingual:** Passages may contain Arabic text, translate as needed\n' : ''}

${contextualPromptAddition}
${customPrompt ? `\n**Additional Instructions:**\n${customPrompt}\n` : ''}`;

  const userQuery = queryAnalysis?.originalQuery || query;

  const fullPrompt = contextParts.length > 0
    ? `${systemPrompt}${conversationContextString}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${contextParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n')}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**`
    : `${systemPrompt}${conversationContextString}\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**`;

  console.log('🤖 Querying Gemini with conversation awareness...');
  console.log(`🎯 Using model: ${preferredModel || 'default fallback'}`);

  const geminiResult = await generateResponse(fullPrompt, preferredModel);
  const geminiStream = geminiResult.stream;
  const modelUsed = geminiResult.modelUsed;
  
  console.log(`✅ Response generated using: ${modelUsed}`);
  
  let assistantResponse = '';
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      assistantResponse += text;
      await writer.write(encoder.encode(text));
    }
  }
  
  // ✅ Save assistant response
  if (sessionId) {
    const messageId = `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`;
    addChatMessage({
      id: messageId,
      sessionId,
      role: 'assistant',
      content: assistantResponse,
      mode: 'reader',
      bookId: undefined,
      bookTitle,
      bookPage
    });
  }
  
  console.log('✅ Response complete');
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
) {
  // Build conversation context
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

  const geminiResult = await generateResponse(prompt, preferredModel); // ✅ ADD preferredModel
  const geminiStream = geminiResult.stream;
  
  let assistantResponse = '';
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      assistantResponse += text;
      await writer.write(encoder.encode(text));
    }
  }
  
  // Save assistant response
  const messageId = `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`;
  addChatMessage({
    id: messageId,
    sessionId,
    role: 'assistant',
    content: assistantResponse,
    mode: 'reader',
    bookPage
  });
}

// ==================== SIMPLE QUERY HANDLER ====================
async function handleSimpleQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  extractedText?: string,
  preferredModel?: string
) {
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

  const geminiResult = await generateResponse(prompt, preferredModel); // ✅ ADD preferredModel
  const geminiStream = geminiResult.stream;
  
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
}