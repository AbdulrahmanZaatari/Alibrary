import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { getDb } from '@/lib/db';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext } from '@/lib/smartRetrieval';
import { correctChunksBatch } from '@/lib/spellingCorrection';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * ✅ FIXED: Detect document language from Supabase embeddings
 * Increased sample size and improved detection logic
 */
async function detectDocumentLanguage(documentId: string): Promise<'ar' | 'en'> {
  try {
    console.log(`🔍 Detecting language for document: ${documentId}`);

    // ✅ Increased sample size from 5 to 20 chunks for better accuracy
    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('chunk_text')
      .eq('document_id', documentId)
      .limit(20); // Increased sample size

    if (error) {
      console.error('⚠️ Error fetching embeddings:', error);
      return 'ar'; // Default to Arabic
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No embeddings found for document, defaulting to Arabic');
      return 'ar';
    }

    // ✅ Filter out common English-only sections (TOC, headers, page numbers)
    const contentChunks = data.filter(row => {
      const text = row.chunk_text.toLowerCase();
      // Skip common non-content sections
      return !(
        text.includes('table of contents') ||
        text.includes('chapter') && text.length < 100 ||
        /^page \d+/i.test(text) ||
        text === 'في رحاب أمريكا'
      );
    });

    // Use filtered chunks if available, otherwise use all
    const chunksToAnalyze = contentChunks.length > 0 ? contentChunks : data;
    const combinedText = chunksToAnalyze.map(row => row.chunk_text).join(' ');
    
    const arabicChars = (combinedText.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = combinedText.replace(/\s/g, '').length;

    const arabicRatio = arabicChars / totalChars;
    
    // ✅ Lowered threshold from 0.5 to 0.3 (more sensitive to Arabic)
    const detectedLang = arabicRatio > 0.3 ? 'ar' : 'en';

    console.log(`   ✅ Language detected: ${detectedLang} (${(arabicRatio * 100).toFixed(1)}% Arabic, analyzed ${chunksToAnalyze.length} chunks)`);

    return detectedLang;

  } catch (error) {
    console.error('❌ Error in detectDocumentLanguage:', error);
    return 'ar'; // Safe default
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
        query, // Support both 'message' and 'query' for compatibility
        sessionId, 
        bookId, 
        bookTitle, 
        bookPage,
        extractedText,
        documentIds,
        correctSpelling = false,
        aggressiveCorrection = false,
        customPrompt
      } = await req.json();

      const userMessage = message || query;

      console.log('📚 Reader Chat:', {
        sessionId,
        hasMessage: !!userMessage,
        hasCorpus: documentIds?.length > 0,
        corpusCount: documentIds?.length || 0,
        correctSpelling,
        aggressiveCorrection
      });

      if (!userMessage) {
        await writer.write(encoder.encode('Error: Missing message or query'));
        await writer.close();
        return;
      }

      // Route to appropriate handler
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
          customPrompt
        );
      } 
      else if (sessionId) {
        console.log('💬 Using general chat with history for Reader Chat');
        await handleGeneralChat(writer, encoder, userMessage, sessionId, extractedText, bookPage);
      }
      else {
        // Fallback: simple response without history
        console.log('📝 Using simple query response');
        await handleSimpleQuery(writer, encoder, userMessage, extractedText);
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

// ==================== CORPUS QUERY HANDLER (UPGRADED) ====================
async function handleCorpusQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  documentIds: string[],
  extractedText?: string,
  correctSpelling?: boolean,
  aggressiveCorrection?: boolean,
  customPrompt?: string
) {
  const contextParts: string[] = [];

  // ✅ Step 1: Detect languages for all documents
  const { primary: documentLanguage, languages: docLanguages, isMultilingual } = 
    await detectMultipleDocumentLanguages(documentIds);

  // ✅ Step 2: Detect user's query language
  const queryLanguage = detectQueryLanguage(query);
  console.log(`🗣️ Query language: ${queryLanguage}`);

  // ✅ Step 3: Determine response language (user's query language takes priority)
  const responseLanguage = queryLanguage;
  console.log(`💬 Response will be in: ${responseLanguage}`);

  // ✅ Step 4: Analyze and translate query
  const queryAnalysis = await analyzeQuery(query, documentLanguage);
  console.log('🔍 Query Analysis:', {
    original: queryAnalysis.originalQuery,
    translated: queryAnalysis.translatedQuery,
    type: queryAnalysis.queryType,
    keywords: queryAnalysis.keywords
  });

  // ✅ Step 5: Add extracted text if provided
  if (extractedText) {
    const extractLabel = responseLanguage === 'ar' 
      ? '**📄 نص الصفحة الحالية:**'
      : '**📄 Current Page Text:**';
    contextParts.push(`${extractLabel}\n${extractedText}`);
  }

  // ✅ Step 6: Smart corpus retrieval
  console.log('🔄 Starting smart retrieval...');
  const { chunks, strategy, confidence } = await retrieveSmartContext(queryAnalysis, documentIds);
  
  console.log(`📊 Retrieval Results:
   - Strategy: ${strategy}
   - Chunks found: ${chunks.length}
   - Confidence: ${(confidence * 100).toFixed(1)}%`);

  // ✅ Step 7: Process chunks with optional spelling correction
  let processedChunks = chunks;
  if (correctSpelling && chunks.length > 0) {
    console.log('🔧 Applying spelling correction...');
    
    // Group chunks by document for language-specific correction
    const chunksByDoc = new Map<string, any[]>();
    chunks.forEach(chunk => {
      const docId = chunk.document_id;
      if (!chunksByDoc.has(docId)) {
        chunksByDoc.set(docId, []);
      }
      chunksByDoc.get(docId)!.push(chunk);
    });

    // Correct each document's chunks in its language
    processedChunks = [];
    for (const [docId, docChunks] of chunksByDoc.entries()) {
      const docLang = docLanguages.get(docId) || documentLanguage;
      const corrected = await correctChunksBatch(docChunks, docLang, aggressiveCorrection);
      processedChunks.push(...corrected);
    }
  }

  // ✅ Step 8: Format retrieved context
  if (processedChunks.length > 0) {
    const chunksByPage = new Map<string, any[]>(); // Key: "docId:pageNum"
    
    processedChunks.slice(0, 30).forEach((chunk: any) => {
      const key = `${chunk.document_id}:${chunk.page_number}`;
      if (!chunksByPage.has(key)) {
        chunksByPage.set(key, []);
      }
      chunksByPage.get(key)!.push(chunk);
    });

    const isArabic = responseLanguage === 'ar';
    const pageEntries = Array.from(chunksByPage.entries())
      .sort((a, b) => {
        const maxSimA = Math.max(...a[1].map(c => c.similarity || 0));
        const maxSimB = Math.max(...b[1].map(c => c.similarity || 0));
        return maxSimB - maxSimA;
      })
      .slice(0, 15);

    const corpusContext = pageEntries
      .map(([key, pageChunks]) => {
        const [docId, pageNum] = key.split(':');
        const bestSimilarity = Math.max(...pageChunks.map(c => c.similarity || 0));
        const relevanceIcon = bestSimilarity >= 0.5 ? '🎯' : bestSimilarity >= 0.4 ? '✓' : '📄';
        const hasCorrected = pageChunks.some(c => c.corrected);
        const correctionBadge = hasCorrected ? ' ✨' : '';
        
        // Show document info if multiple documents
        const docInfo = documentIds.length > 1 
          ? (isArabic ? ` (وثيقة ${documentIds.indexOf(docId) + 1})` : ` (Doc ${documentIds.indexOf(docId) + 1})`)
          : '';
        
        const pageHeader = isArabic 
          ? `**${relevanceIcon} صفحة ${pageNum}**${docInfo}${correctionBadge}`
          : `**${relevanceIcon} Page ${pageNum}**${docInfo}${correctionBadge}`;
        
        const pageText = pageChunks.map(c => c.chunk_text).join('\n\n');
        return `${pageHeader}\n${pageText}`;
      })
      .join('\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n');

    const contextTitle = isArabic 
      ? '**📚 مقاطع ذات صلة من الكتب:**'
      : '**📚 Relevant Passages from the Books:**';

    contextParts.push(`${contextTitle}\n\n${corpusContext}`);

    // ✅ Add multilingual note if applicable
    if (isMultilingual) {
      const multilingualNote = isArabic
        ? '\n\n📖 **ملاحظة:** المقاطع المعروضة من مستندات بلغات مختلفة (عربي وإنجليزي).'
        : '\n\n📖 **Note:** The displayed passages are from documents in different languages (Arabic and English).';
      contextParts.push(multilingualNote);
    }

    // ✅ Add page validation
    const actualPages = Array.from(new Set(processedChunks.map((c: any) => `${c.document_id}:${c.page_number}`)))
      .map(key => key.split(':')[1])
      .sort((a, b) => Number(a) - Number(b));
    
    const pageListNote = isArabic
      ? `\n\n⚠️ **ملاحظة مهمة:** الصفحات المتاحة في السياق هي: ${actualPages.join(', ')}. لا تذكر أي صفحات أخرى.`
      : `\n\n⚠️ **Important Note:** The available pages in the context are: ${actualPages.join(', ')}. Do not reference any other pages.`;
    
    contextParts.push(pageListNote);
  } else {
    console.warn('⚠️ No relevant chunks found');
  }

  // ✅ Step 9: Build enhanced prompt with Markdown formatting
  const isArabic = responseLanguage === 'ar';
  
  const systemPrompt = isArabic
    ? `أنت مساعد بحثي دقيق ومتخصص. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الأولوية للسياق المقدم:**
   - إذا كانت الإجابة موجودة في المقاطع أدناه، استخدمها وأشر إلى رقم الصفحة (مثال: "**صفحة 15**")
   - اقتبس المعلومات بدقة من السياق

2. **دمج المعرفة العامة:**
   - إذا كان السياق ناقصًا أو محدودًا، يمكنك إضافة معلومات من معرفتك العامة
   - **وضّح بوضوح** أي معلومات ليست من السياق المقدم
   - استخدم عبارات مثل: "بناءً على المقاطع المتاحة..." و "من المعرفة العامة..."

3. **الإجابات المتكاملة:**
   - اجمع بين معلومات السياق والمعرفة العامة لإعطاء إجابة شاملة
   - رتب الإجابة بشكل منطقي ومنظم
   - إذا كان هناك تناقض، أعط الأولوية لمحتوى السياق

4. **الشفافية:**
   - اذكر بوضوح مصدر كل معلومة
   - إذا لم تجد معلومات كافية في السياق، قل ذلك ثم قدم ما تعرفه
   - استخدم أقسام واضحة مع عناوين Markdown:
     * **[من النص]** للمعلومات المأخوذة من السياق
     * **[معلومات إضافية]** للمعرفة العامة

5. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم *النص المائل* للعناوين الفرعية
   - استخدم القوائم النقطية (- أو *) للنقاط المتعددة
   - استخدم القوائم المرقمة (1. 2. 3.) للخطوات أو الترتيب
   - استخدم > للاقتباسات
   - استخدم \`\`\` لأمثلة الكود إن وجدت

6. **اللغة:**
   - أجب بالعربية كما طلب المستخدم
   ${isMultilingual ? '- قد تحتوي المقاطع على نصوص بالإنجليزية، ترجمها حسب الحاجة' : ''}

${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
    : `You are an accurate and specialized research assistant. Use Markdown formatting in your responses.

📋 **Core Guidelines:**

1. **Prioritize Provided Context:**
   - If the answer exists in the passages below, use it and cite page numbers (e.g., "**page 15**")
   - Quote information accurately from the context

2. **Integrate General Knowledge:**
   - If the context is incomplete or limited, you may add information from your general knowledge
   - **Clearly indicate** which information is NOT from the provided context
   - Use phrases like: "Based on the available passages..." and "From general knowledge..."

3. **Comprehensive Answers:**
   - Combine context information with general knowledge for complete answers
   - Organize the response logically and clearly
   - If there's a conflict, prioritize the context content

4. **Transparency:**
   - Clearly state the source of each piece of information
   - If you don't find sufficient information in the context, say so then provide what you know
   - Use clear sections with Markdown headings:
     * **[From Text]** for information from the context
     * **[Additional Information]** for general knowledge

5. **Markdown Formatting:**
   - Use **bold text** for emphasis
   - Use *italic text* for subheadings
   - Use bullet lists (- or *) for multiple points
   - Use numbered lists (1. 2. 3.) for steps or ordering
   - Use > for blockquotes
   - Use \`\`\` for code examples if applicable

6. **Language:**
   - Respond in English as requested by the user
   ${isMultilingual ? '- The passages may contain Arabic text, translate as needed' : ''}

${customPrompt ? `\n**Additional Instructions:**\n${customPrompt}\n` : ''}`;

  const userQuery = queryAnalysis?.originalQuery || query;

  const fullPrompt = contextParts.length > 0
    ? `${systemPrompt}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${contextParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n')}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**`
    : `${systemPrompt}\n\n**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**\n${userQuery}\n\n**${isArabic ? 'إجابتك' : 'Your Answer'}:**`;

  console.log('🤖 Querying Gemini...');
  const geminiStream = await generateResponse(fullPrompt);
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) await writer.write(encoder.encode(text));
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
  bookPage?: number
) {
  const db = getDb();
  const history = db.prepare(`
    SELECT role, content 
    FROM chat_messages 
    WHERE session_id = ? 
    ORDER BY created_at ASC
  `).all(sessionId) as Array<{ role: string; content: string }>;

  let conversationContext = '';
  if (history.length > 0) {
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

  // Detect language and respond accordingly
  const queryLang = detectQueryLanguage(message);
  const langInstruction = queryLang === 'ar' 
    ? 'Respond in Arabic using proper Markdown formatting (bold, italic, lists, etc.).'
    : 'Respond in English using proper Markdown formatting (bold, italic, lists, etc.).';

  const prompt = conversationContext
    ? `You are a helpful assistant for reading books. Continue the conversation naturally. ${langInstruction}
${contextSection}

**Previous conversation:**
${conversationContext}

**User:** ${message}
**Assistant:**`
    : `You are a helpful assistant for reading books. ${langInstruction}
${contextSection}

**User:** ${message}
**Assistant:**`;

  const geminiStream = await generateResponse(prompt);
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
}

// ==================== SIMPLE QUERY HANDLER ====================
async function handleSimpleQuery(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  query: string,
  extractedText?: string
) {
  const queryLang = detectQueryLanguage(query);
  const langInstruction = queryLang === 'ar' 
    ? 'أجب بالعربية مع استخدام تنسيق Markdown المناسب.'
    : 'Respond in English using proper Markdown formatting.';

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

  const geminiStream = await generateResponse(prompt);
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
}