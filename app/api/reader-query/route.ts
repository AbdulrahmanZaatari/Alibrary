import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext } from '@/lib/smartRetrieval';
import { correctChunksBatch } from '@/lib/spellingCorrection';
import { getDb } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ✅ Initialize Supabase client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { 
        query, 
        documentIds, 
        extractedText, 
        customPrompt,
        correctSpelling = false,
        aggressiveCorrection = false
      } = await request.json();

      console.log('📝 Reader Query:', {
        hasQuery: !!query,
        hasExtractedText: !!extractedText,
        hasCustomPrompt: !!customPrompt,
        documentIds: documentIds?.length || 0,
        correctSpelling,
        aggressiveCorrection
      });

      if (!query && !extractedText) {
        await writer.write(encoder.encode('Please provide a query or extracted text.'));
        await writer.close();
        return;
      }

      const contextParts: string[] = [];

      // ✅ Step 1: Detect document language
      const documentLanguage = documentIds && documentIds.length > 0
        ? await detectDocumentLanguage(documentIds[0])
        : 'ar';

      console.log(`📖 Document language: ${documentLanguage}`);

      // ✅ Step 2: Analyze and translate query
      let queryAnalysis: any = null;
      if (query) {
        queryAnalysis = await analyzeQuery(query, documentLanguage);
        console.log('🔍 Query Analysis:', {
          original: queryAnalysis.originalQuery,
          translated: queryAnalysis.translatedQuery,
          type: queryAnalysis.queryType,
          keywords: queryAnalysis.keywords
        });
      }

      // ✅ Step 3: Add extracted text
      if (extractedText) {
        const extractLabel = documentLanguage === 'ar' 
          ? '**📄 نص الصفحة الحالية:**'
          : '**📄 Current Page Text:**';
        contextParts.push(`${extractLabel}\n${extractedText}`);
      }

      // ✅ Step 4: Smart corpus retrieval
      if (documentIds && documentIds.length > 0 && queryAnalysis) {
        console.log('🔄 Starting smart retrieval...');
        
        const { chunks, strategy, confidence } = await retrieveSmartContext(
          queryAnalysis,
          documentIds
        );

        console.log(`📊 Retrieval Results:
   - Strategy: ${strategy}
   - Chunks found: ${chunks.length}
   - Confidence: ${(confidence * 100).toFixed(1)}%`);

        if (chunks.length > 0) {
          // ✅ Optional: Correct spelling in retrieved chunks
          let processedChunks = chunks;
          if (correctSpelling) {
            console.log('🔧 Applying spelling correction...');
            processedChunks = await correctChunksBatch(
              chunks,
              documentLanguage,
              aggressiveCorrection
            );
          }

          // ✅ Group chunks by page number
          const chunksByPage = new Map<number, any[]>();
          processedChunks.slice(0, 30).forEach((chunk: any) => {
            const page = chunk.page_number;
            if (!chunksByPage.has(page)) {
              chunksByPage.set(page, []);
            }
            chunksByPage.get(page)!.push(chunk);
          });

          // ✅ Format grouped chunks with page numbers only
          const isArabic = documentLanguage === 'ar';
          const pageEntries = Array.from(chunksByPage.entries())
            .sort((a, b) => {
              const maxSimA = Math.max(...a[1].map(c => c.similarity || 0));
              const maxSimB = Math.max(...b[1].map(c => c.similarity || 0));
              return maxSimB - maxSimA;
            })
            .slice(0, 15); // Limit to 15 pages max

          const corpusContext = pageEntries
            .map(([pageNum, pageChunks]) => {
              const bestSimilarity = Math.max(...pageChunks.map(c => c.similarity || 0));
              
              // Relevance indicators
              const relevanceIcon = bestSimilarity >= 0.5 
                ? '🎯' 
                : bestSimilarity >= 0.4 
                  ? '✓' 
                  : '📄';
              
              const hasCorrected = pageChunks.some(c => c.corrected);
              const correctionBadge = hasCorrected ? ' ✨' : '';
              
              // Page header
              const pageHeader = isArabic 
                ? `**${relevanceIcon} صفحة ${pageNum}**${correctionBadge}`
                : `**${relevanceIcon} Page ${pageNum}**${correctionBadge}`;
              
              // Combine all chunks from this page
              const pageText = pageChunks
                .map(c => c.chunk_text)
                .join('\n\n');
              
              return `${pageHeader}\n${pageText}`;
            })
            .join('\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n');

          const contextTitle = isArabic 
            ? '**📚 مقاطع ذات صلة من الكتاب:**'
            : '**📚 Relevant Passages from the Book:**';

          contextParts.push(`${contextTitle}\n\n${corpusContext}`);
        } else {
          console.warn('⚠️ No relevant chunks found');
        }
      }

      // ✅ Step 5: Build enhanced prompt with citation instructions
      const isArabic = documentLanguage === 'ar';
      
      const systemPrompt = isArabic
        ? `أنت مساعد ذكي متخصص في التحليل الأدبي والبحث الإسلامي.

📋 مهمتك:
- استخدم السياق المقدم للإجابة بدقة وعمق
- اجمع المعلومات من جميع المقاطع ذات الصلة
- **عند الإشارة إلى معلومة، اذكر رقم الصفحة فقط** (مثال: "حسب ما ورد في صفحة 15..." أو "(صفحة 15)")
- إذا كانت المعلومات غير كافية، اذكر ذلك بوضوح
- قدم إجابة شاملة ومنظمة ومترابطة
- **لا تذكر "Chunk" أو "مقطع رقم" أو أي مصطلحات تقنية**
- اجعل الإجابة طبيعية وسلسة

${customPrompt ? `\n**تعليمات إضافية:**\n${customPrompt}\n` : ''}`
        : `You are an intelligent assistant specialized in literary analysis and Islamic research.

📋 Your Task:
- Use the provided context to answer accurately and deeply
- Synthesize information from all relevant passages
- **When citing information, only mention page numbers** (example: "As stated on page 15..." or "(page 15)")
- If information is insufficient, state it clearly
- Provide a comprehensive, organized, and coherent answer
- **Do NOT mention "Chunk" or any technical terms**
- Make the answer natural and flowing

${customPrompt ? `\n**Additional Instructions:**\n${customPrompt}\n` : ''}`;

      const userQuery = queryAnalysis?.originalQuery || query || 'Please analyze the extracted text.';

      const fullPrompt = contextParts.length > 0
        ? `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${contextParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**
${userQuery}

**${isArabic ? 'إجابتك' : 'Your Answer'}:**`
        : `${systemPrompt}

**${isArabic ? 'سؤال المستخدم' : "User's Question"}:**
${userQuery}

**${isArabic ? 'إجابتك' : 'Your Answer'}:**`;

      console.log('🤖 Querying Gemini...');

      // ✅ Stream response
      const geminiStream = await generateResponse(fullPrompt);

      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          await writer.write(encoder.encode(text));
        }
      }

      console.log('✅ Response complete');
      await writer.close();

    } catch (error) {
      console.error('❌ Reader query error:', error);
      
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

/**
 * ✅ Detect document language from Supabase embeddings
 */
async function detectDocumentLanguage(documentId: string): Promise<'ar' | 'en'> {
  try {
    console.log(`🔍 Detecting language for document: ${documentId}`);

    // ✅ Query Supabase embeddings table
    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('chunk_text')
      .eq('document_id', documentId)
      .limit(5);

    if (error) {
      console.error('⚠️ Error fetching embeddings:', error);
      return 'ar'; // Default to Arabic
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No embeddings found for document, defaulting to Arabic');
      return 'ar';
    }

    // Analyze language from sample chunks
    const combinedText = data.map(row => row.chunk_text).join(' ');
    const arabicChars = (combinedText.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = combinedText.replace(/\s/g, '').length;

    const arabicRatio = arabicChars / totalChars;
    const detectedLang = arabicRatio > 0.5 ? 'ar' : 'en';

    console.log(`   ✅ Language detected: ${detectedLang} (${(arabicRatio * 100).toFixed(1)}% Arabic)`);

    return detectedLang;

  } catch (error) {
    console.error('❌ Error in detectDocumentLanguage:', error);
    return 'ar'; // Safe default
  }
}