import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Correct spelling in Arabic/English text
 */
export async function correctSpelling(
  text: string,
  language: 'ar' | 'en',
  aggressive: boolean = false
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const prompt = language === 'ar'
    ? `صحح الأخطاء الإملائية في النص التالي. ${aggressive ? 'صحح جميع الأخطاء.' : 'صحح الأخطاء الواضحة فقط، واحتفظ بالكلمات النادرة أو التاريخية.'}

النص الأصلي:
${text}

النص المصحح (بدون شرح، فقط النص):`
    : `Correct spelling errors in the following text. ${aggressive ? 'Fix all errors.' : 'Fix only obvious errors, preserve rare or historical words.'}

Original text:
${text}

Corrected text (no explanations, just the text):`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Correct chunks in batches
 */
export async function correctChunksBatch(
  chunks: any[],
  language: 'ar' | 'en',
  aggressive: boolean = false
): Promise<any[]> {
  console.log(`🔧 Correcting ${chunks.length} chunks (${aggressive ? 'aggressive' : 'conservative'} mode)...`);

  const correctedChunks = [];
  const batchSize = 5;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    const correctedBatch = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const correctedText = await correctSpelling(chunk.chunk_text, language, aggressive);
          return { ...chunk, chunk_text: correctedText, corrected: true };
        } catch (error) {
          console.warn(`   ⚠️ Failed to correct chunk ${chunk.id}:`, error);
          return chunk;
        }
      })
    );

    correctedChunks.push(...correctedBatch);
    console.log(`   ✅ Corrected batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}`);
  }

  return correctedChunks;
}