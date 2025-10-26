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

  // ✅ Step 3: Determine response language
  const responseLanguage = queryLanguage;
  console.log(`💬 Response will be in: ${responseLanguage}`);

  // ✅ Step 4: Analyze and translate query
  const queryAnalysis = await analyzeQuery(query, documentLanguage);
  console.log('🔍 Query Analysis:', {
    original: queryAnalysis.originalQuery,
    translated: queryAnalysis.translatedQuery,
    type: queryAnalysis.queryType,
    keywords: queryAnalysis.keywords,
    isMultiDoc: queryAnalysis.isMultiDocumentQuery
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

  // ✅ Step 8: Group chunks by document and format context
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

  // ✅ Step 9: Build enhanced prompt
  const isArabic = responseLanguage === 'ar';
  
  const systemPrompt = isArabic
    ? `أنت مساعد بحثي دقيق ومتخصص. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الأولوية للسياق المقدم:**
   - إذا كانت الإجابة موجودة في المقاطع أدناه، استخدمها وأشر إلى رقم الصفحة والوثيقة
   - اقتبس المعلومات بدقة من السياق

2. **دمج المعرفة العامة:**
   - إذا كان السياق ناقصًا، يمكنك إضافة معلومات من معرفتك
   - **وضّح بوضوح** المعلومات من خارج السياق

3. **الإجابات المتكاملة:**
   - اجمع بين معلومات السياق والمعرفة العامة
   - رتب الإجابة بشكل منطقي ومنظم
   - استخدم أقسام واضحة:
     * **[من النص]** للمعلومات من السياق
     * **[معلومات إضافية]** للمعرفة العامة

4. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم القوائم النقطية والمرقمة
   - استخدم > للاقتباسات

${isMultilingual ? '5. **تعدد اللغات:** قد تحتوي المقاطع على نصوص بالإنجليزية، ترجمها حسب الحاجة\n' : ''}

${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
    : `You are an accurate and specialized research assistant. Use Markdown formatting in your responses.

📋 **Core Guidelines:**

1. **Prioritize Provided Context:**
   - Use passages below and cite page numbers and document numbers
   - Quote information accurately

2. **Integrate General Knowledge:**
   - Add general knowledge if context is limited
   - **Clearly indicate** information NOT from context

3. **Comprehensive Answers:**
   - Combine context with general knowledge
   - Use clear sections:
     * **[From Text]** for context information
     * **[Additional Information]** for general knowledge

4. **Markdown Formatting:**
   - Use **bold**, lists, > for quotes

${isMultilingual ? '5. **Multilingual:** Passages may contain Arabic text, translate as needed\n' : ''}

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

  const queryLang = detectQueryLanguage(message);
  const langInstruction = queryLang === 'ar' 
    ? 'Respond in Arabic using proper Markdown formatting.'
    : 'Respond in English using proper Markdown formatting.';

  const prompt = conversationContext
    ? `You are a helpful assistant. ${langInstruction}
${contextSection}

**Previous conversation:**
${conversationContext}

**User:** ${message}
**Assistant:**`
    : `You are a helpful assistant. ${langInstruction}
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

  const geminiStream = await generateResponse(prompt);
  for await (const chunk of geminiStream) {
    const text = chunk.text();
    if (text) {
      await writer.write(encoder.encode(text));
    }
  }
}