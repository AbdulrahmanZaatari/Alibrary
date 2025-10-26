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
/**
 * Correct chunks in batches with rate limiting
 */
export async function correctChunksBatch(
  chunks: any[],
  language: 'ar' | 'en',
  aggressive: boolean = false
): Promise<any[]> {
  // ✅ ADD: Skip correction if too many chunks to avoid quota issues
  if (chunks.length > 20) {
    console.log(`⚠️ Too many chunks (${chunks.length}), skipping spelling correction to avoid quota limits`);
    return chunks;
  }

  console.log(`🔧 Correcting ${chunks.length} chunks (${aggressive ? 'aggressive' : 'conservative'} mode)...`);
  
  const batchSize = 5;
  const correctedChunks: any[] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    // ✅ ADD: Delay between batches to respect rate limits
    if (i > 0) {
      console.log(`   ⏳ Waiting 2s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    try {
      const corrected = await Promise.all(
        batch.map(async (chunk) => {
          try {
            const correctedText = await correctSpelling(
              chunk.chunk_text,
              language,
              aggressive
            );
            return {
              ...chunk,
              chunk_text: correctedText,
              corrected: true
            };
          } catch (error) {
            console.error(`   ⚠️ Failed to correct chunk ${chunk.id}:`, error);
            return chunk; // Return original on error
          }
        })
      );
      
      correctedChunks.push(...corrected);
      console.log(`   ✅ Corrected batch ${batchNum}/${totalBatches}`);
    } catch (error) {
      console.error(`   ❌ Batch ${batchNum} failed:`, error);
      correctedChunks.push(...batch); // Return originals on batch failure
    }
  }
  
  return correctedChunks;
}