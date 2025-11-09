// ✅ Load env FIRST before any imports
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ 
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  path: require('path').resolve(process.cwd(), '.env.local') 
});

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Verify env vars loaded
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in environment');
  console.log('📂 Current directory:', process.cwd());
  console.log('🔍 Looking for: .env.local');
  process.exit(1);
}

console.log('✅ Environment variables loaded');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite', 
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

/**
 * ✅ Embed text using Gemini (inline version for script)
 */
async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * ✅ COMPREHENSIVE Arabic text correction with OCR error fixing
 */
async function correctArabicChunk(text: string): Promise<string> {
  if (!text || text.length < 20) return text;

  const prompt = `أنت خبير في تصحيح النصوص العربية المستخرجة من ملفات PDF.

**المهمة:** صحّح جميع الأخطاء في النص التالي:

1. **أخطاء OCR الشائعة:**
   - "فلمت" → "فلثمت" (الثاء تصبح لام)
   - "اسفًا" → "آسفًا" (الهمزة الممدودة)
   - "فايده" → "فائدة" (الهمزة على الياء)
   - "هايجه" → "هائجة" (الهمزة على الياء)
   - "المفاجاه" → "المفاجأة" (الهمزة على الألف)
   - "سماحه" → "سماحة" (التاء المربوطة)
   - "قفاه" → "قفاه" (حسب السياق)

2. **الأخطاء الإملائية:**
   - إصلاح الهمزات الخاطئة
   - إصلاح التاء المربوطة والهاء
   - إصلاح الألف المقصورة والياء
   - إصلاح التنوين والتشكيل

3. **علامات الترقيم:**
   - إصلاح المسافات قبل وبعد علامات الترقيم
   - إصلاح النقاط والفواصل

**قواعد مهمة:**
- احتفظ بالمعنى الأصلي تمامًا
- لا تغير البنية أو الأسلوب
- لا تضف محتوى جديد
- أرجع النص المصحح فقط بدون شرح

**النص الأصلي:**
${text}

**النص المصحح:**`;

  let lastError: Error | null = null;

  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
        }
      });

      const result = await model.generateContent(prompt);
      let corrected = result.response.text().trim();

      // Remove markdown formatting if AI adds it
      corrected = corrected.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
      corrected = corrected.replace(/^\*\*النص المصحح:\*\*\s*/, '');

      // Validation: ensure similar length (±30%)
      const lengthDiff = Math.abs(corrected.length - text.length) / text.length;
      if (lengthDiff > 0.3) {
        console.warn(`   ⚠️ ${modelName} changed length too much (${(lengthDiff * 100).toFixed(1)}%), trying next model`);
        continue;
      }

      // Validation: ensure Arabic content preserved
      const originalArabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
      const correctedArabic = (corrected.match(/[\u0600-\u06FF]/g) || []).length;
      const arabicDiff = Math.abs(correctedArabic - originalArabic) / originalArabic;

      if (arabicDiff > 0.2) {
        console.warn(`   ⚠️ ${modelName} removed too much Arabic (${(arabicDiff * 100).toFixed(1)}%), trying next model`);
        continue;
      }

      console.log(`   ✅ Corrected with ${modelName}`);
      return corrected;

    } catch (error) {
      lastError = error as Error;
      console.warn(`   ⚠️ Correction failed with ${modelName}:`, error instanceof Error ? error.message.substring(0, 100) : 'Unknown');
      continue;
    }
  }

  console.error('   ❌ All correction models failed, returning original text');
  return text;
}

/**
 * ✅ Detect if chunk needs correction
 */
function needsCorrection(text: string): boolean {
  const corruptionPatterns = [
    /اسفًا/,          // Missing hamza madda
    /فايده/,          // Hamza on wrong letter
    /هايجه/,          // Hamza on wrong letter  
    /المفاجاه/,       // Hamza on wrong letter
    /سماحه/,          // ه instead of ة
    /قفاه/,           // Context-dependent
    /وزرّ/,           // Spacing issues
    /منه بد\.\.\./,   // Spacing around punctuation
    /\s[،.!؟]\s/,     // Spaces around Arabic punctuation
    /[هى]$/,          // Wrong ending letter (common OCR error)
    /\bفال([ا-ي])/,   // "فال" instead of "فلا"
    /[اإآ]ل([ـ-ي])/,  // Hamza issues with "ال"
  ];

  return corruptionPatterns.some(pattern => pattern.test(text));
}

/**
 * ✅ Process chunks in batches with rate limiting
 */
async function cleanAllChunks(documentId?: string) {
  console.log('🧹 Starting comprehensive chunk cleaning...\n');

  // Get all chunks (or specific document)
  let query = supabaseAdmin
    .from('embeddings')
    .select('id, chunk_text, document_id, page_number, embedding');

  if (documentId) {
    query = query.eq('document_id', documentId);
    console.log(`📄 Cleaning document: ${documentId}`);
  } else {
    console.log('📚 Cleaning ALL documents');
  }

  const { data: chunks, error } = await query;

  if (error) {
    console.error('❌ Error fetching chunks:', error);
    return;
  }

  if (!chunks || chunks.length === 0) {
    console.log('⚠️ No chunks found');
    return;
  }

  console.log(`📊 Total chunks: ${chunks.length}\n`);

  // Filter chunks that need correction
  const corruptedChunks = chunks.filter(chunk => needsCorrection(chunk.chunk_text));
  
  console.log(`🔍 Found ${corruptedChunks.length} potentially corrupted chunks\n`);

  if (corruptedChunks.length === 0) {
    console.log('✅ No corrupted chunks found!');
    return;
  }

  let corrected = 0;
  let failed = 0;
  let skipped = 0;

  // Process in batches with rate limiting
  const batchSize = 5;
  const delayBetweenBatches = 3000; // 3 seconds

  for (let i = 0; i < corruptedChunks.length; i += batchSize) {
    const batch = corruptedChunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(corruptedChunks.length / batchSize);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

    for (const chunk of batch) {
      try {
        console.log(`\n   Processing chunk ${chunk.id} (page ${chunk.page_number})...`);
        console.log(`   Original: ${chunk.chunk_text.substring(0, 80)}...`);

        // Correct the text
        const correctedText = await correctArabicChunk(chunk.chunk_text);

        // Check if text actually changed
        if (correctedText === chunk.chunk_text) {
          console.log('   ⚠️ No changes made, skipping');
          skipped++;
          continue;
        }

        console.log(`   Corrected: ${correctedText.substring(0, 80)}...`);

        // Re-generate embedding for corrected text
        console.log('   🔄 Regenerating embedding...');
        const newEmbedding = await embedText(correctedText);

        // Update in database
        const { error: updateError } = await supabaseAdmin
          .from('embeddings')
          .update({
            chunk_text: correctedText,
            embedding: newEmbedding
          })
          .eq('id', chunk.id);

        if (updateError) {
          console.error(`   ❌ Failed to update:`, updateError);
          failed++;
        } else {
          console.log('   ✅ Updated successfully');
          corrected++;
        }

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`   ❌ Error processing chunk ${chunk.id}:`, error);
        failed++;
      }
    }

    // Delay between batches to respect rate limits
    if (i + batchSize < corruptedChunks.length) {
      console.log(`\n⏳ Waiting ${delayBetweenBatches / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  console.log(`\n\n✅ Cleaning complete!`);
  console.log(`   Corrected: ${corrected}`);
  console.log(`   Skipped (no changes): ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

// Run the script
const documentId = process.argv[2]; // Optional: pass document ID as argument
cleanAllChunks(documentId).catch(console.error);