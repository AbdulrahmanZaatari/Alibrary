import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';
import mupdf from 'mupdf';
import { updateDocumentEmbeddingStatus, updateDocument } from './db';
import { addChunksToVectorStore, VectorChunk } from './vectorStore';
import { extractTextWithGeminiVision } from './ocrExtractor';
import { extractTextWithOcrSpace, isOcrSpaceAvailable } from './ocrSpaceApi';
import { chunkText } from './gemini';
import { cleanPdfText, hasTransliterationIssues } from './transliterationMapper';
import { correctArabicWithAI, hasArabicCorruption } from './arabicTextCleaner';
import { correctArabicOcrWithAI, hasArabicOcrIssues } from './arabicOcrCorrection';
import { detectChapterBoundary } from './chapterDetector';
import fs from 'fs';

// ✅ Shared chapter context across pages (used for propagation)
interface ChapterState {
  chapterNumber: number | null;
  storyNumber: number | null;
  chapterTitle: string | null;
  storyTitle: string | null;
  sectionName: string | null;
  boundaryType: 'chapter' | 'story' | 'part' | 'section' | 'none';
}

let currentChapterState: ChapterState | null = null;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BATCH_SIZE = 2;
const MAX_RETRIES = 3;
const EMBEDDING_TIMEOUT = 30000;
const RATE_LIMIT_DELAY = 12000;

async function fetchWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
}

/**
 * ✅ FIXED: Enhanced language detection with extended Unicode ranges
 */
function detectLanguage(text: string): 'ar' | 'en' {
  if (!text) return 'en';

  const cleanText = text.replace(/\s/g, '');
  if (cleanText.length === 0) return 'en';

  // ✅ Extended Arabic Unicode ranges (includes all Arabic presentations)
  const arabicChars = (cleanText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const arabicRatio = arabicChars / cleanText.length;

  // ✅ Common Arabic words check (backup method)
  const arabicWords = ['في', 'من', 'على', 'إلى', 'هذا', 'التي', 'الله', 'كان', 'قال', 'ثم', 'عن', 'ما', 'أن', 'لم', 'هو', 'بن'];
  const hasArabicWords = arabicWords.some(word => text.includes(word));

  // English letters check
  const englishChars = (cleanText.match(/[a-zA-Z]/g) || []).length;
  const englishRatio = englishChars / cleanText.length;

  console.log(`   🔍 Language detection:`);
  console.log(`      Total: ${cleanText.length} chars | Arabic: ${arabicChars} (${(arabicRatio * 100).toFixed(1)}%) | English: ${englishChars} (${(englishRatio * 100).toFixed(1)}%)`);
  console.log(`      Arabic words found: ${hasArabicWords}`);
  console.log(`      Text preview: "${text.substring(0, 50)}..."`);

  // ✅ Decision: Arabic if >20% Arabic chars OR contains Arabic words
  if (arabicRatio > 0.2 || hasArabicWords) {
    console.log(`      ✅ Language: ARABIC`);
    return 'ar';
  }

  console.log(`      ✅ Language: ENGLISH`);
  return 'en';
}

/**
 * ✅ Enhanced embedding function with detailed debugging
 */
async function embedChunk(
  chunkText: string,
  pageNum: number,
  chunkIndex: number,
  attempt: number = 1
): Promise<number[] | null> {
  try {
    console.log(`   🔄 [Page ${pageNum + 1}, Chunk ${chunkIndex + 1}] Embedding attempt ${attempt}/${MAX_RETRIES}`);
    console.log(`      Model: gemini-embedding-001`);
    console.log(`      Text length: ${chunkText.length} chars`);
    console.log(`      Preview: "${chunkText.substring(0, 80)}..."`);

    const model = genAI.getGenerativeModel({
      model: 'gemini-embedding-001'
    });

    const startTime = Date.now();
    const result = await fetchWithTimeout(
      model.embedContent({ content: { role: 'user', parts: [{ text: chunkText }] }, outputDimensionality: 768 } as any),
      EMBEDDING_TIMEOUT
    );
    const elapsed = Date.now() - startTime;

    const embedding = result.embedding.values;

    // Validate embedding
    if (!Array.isArray(embedding)) {
      throw new Error(`Invalid embedding response: not an array (type: ${typeof embedding})`);
    }

    if (embedding.length === 0) {
      throw new Error('Invalid embedding response: empty array');
    }

    if (embedding.length !== 768) {
      throw new Error(`Invalid embedding dimensions: expected 768, got ${embedding.length}`);
    }

    console.log(`   ✅ Embedding successful: ${embedding.length} dimensions in ${elapsed}ms`);

    return embedding;

  } catch (error) {
    const err = error as Error;
    console.error(`   ❌ [Page ${pageNum + 1}, Chunk ${chunkIndex + 1}] Embedding attempt ${attempt} failed:`);
    console.error(`      Error type: ${err.name}`);
    console.error(`      Error message: ${err.message}`);

    // Detailed error analysis
    if (err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED')) {
      console.error(`      🚨 QUOTA ERROR: API quota exceeded - waiting 5s before retry`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else if (err.message.includes('not found') || err.message.includes('invalid model')) {
      console.error(`      🚨 MODEL ERROR: gemini-embedding-001 not available`);
      return null;
    } else if (err.message.includes('Timeout')) {
      console.error(`      🚨 TIMEOUT ERROR: Request exceeded ${EMBEDDING_TIMEOUT}ms`);
    }

    return null;
  }
}

/**
 * ✅ Process a single page with FORCED OCR for Arabic
 */
async function processPage(
  pdfBytes: Buffer,
  pageNum: number,
  documentId: string
): Promise<VectorChunk[]> {
  const chunks: VectorChunk[] = [];

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📄 [Page ${pageNum + 1}] Starting processing...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    // ✅ STEP 1: Extract text with mupdf (for language detection)
    let rawText = '';
    let mupdfFailed = false;

    try {
      console.log(`   🔧 [STEP 1] Attempting mupdf extraction...`);
      const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
      const page = doc.loadPage(pageNum);
      rawText = page.toStructuredText().asText().trim();
      doc.destroy();

      if (!rawText || rawText.length < 20) {
        console.warn(`   ⚠️ mupdf extraction insufficient (${rawText.length} chars)`);
        mupdfFailed = true;
      } else {
        console.log(`   ✅ mupdf extracted ${rawText.length} chars`);
        console.log(`   📝 Preview: "${rawText.substring(0, 100)}..."`);
      }
    } catch (err) {
      console.error(`   ❌ mupdf extraction failed: ${(err as Error).message}`);
      mupdfFailed = true;
      rawText = '';
    }

    // ✅ STEP 2: Detect language
    let language = detectLanguage(rawText);
    console.log(`🌐 [STEP 2] Page ${pageNum + 1}: Detected language: ${language.toUpperCase()}`);

    // ✅ STEP 3: Smart extraction strategy
    // For Arabic: ALWAYS use OCR.space for best quality
    // For English: Use mupdf unless it fails or text is too short
    let finalText = rawText;
    let extractionMethod: 'mupdf' | 'ocr' = 'mupdf';
    let usedOcr = false;

    // Force OCR if: Arabic detected OR mupdf failed OR text is very short
    const needsOcr = language === 'ar' || mupdfFailed || rawText.length < 50;

    if (needsOcr) {
      const reason = language === 'ar'
        ? '🌙 Arabic detected - using OCR.space'
        : mupdfFailed
          ? '❌ mupdf failed'
          : '📏 Text too short';

      console.log(`   📸 [STEP 3] OCR REQUIRED: ${reason}`);

      try {
        const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
        const page = doc.loadPage(pageNum);

        const scale = 2.5;
        console.log(`   🖼️  Rendering page at ${scale}x resolution...`);

        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false
        );
        const imageBuffer = Buffer.from(pixmap.asPNG());

        console.log(`   📦 PNG size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

        let ocrText = '';
        let ocrSource = '';

        // ✅ For Arabic: Try OCR.space first (25k free/month), then fall back to Gemma
        if (language === 'ar' && isOcrSpaceAvailable()) {
          console.log(`   🌐 [ARABIC] Trying OCR.space API...`);
          const ocrSpaceResult = await extractTextWithOcrSpace(imageBuffer, 'ara');

          if (ocrSpaceResult.success && ocrSpaceResult.text.length > 20) {
            ocrText = ocrSpaceResult.text;
            ocrSource = 'OCR.space';
            console.log(`   ✅ OCR.space success: ${ocrText.length} chars`);

            // ✅ Apply Gemma AI correction to OCR.space output
            console.log(`   🤖 Applying Gemma AI correction to OCR.space text...`);
            try {
              const correctionResult = await correctArabicOcrWithAI(ocrText);
              if (correctionResult.correctedText && correctionResult.correctedText.length > 20) {
                console.log(`   ✅ AI correction applied (${correctionResult.modelUsed}): ${correctionResult.corrections.length} fixes`);
                ocrText = correctionResult.correctedText;
                ocrSource = 'OCR.space + Gemma AI';
              }
            } catch {
              console.warn(`   ⚠️ AI correction failed, using raw OCR.space text`);
            }
          } else {
            console.log(`   ⚠️ OCR.space failed/insufficient, falling back to Gemma Vision...`);
          }
        }

        // Fallback to Gemma Vision if OCR.space failed or not Arabic
        if (!ocrText || ocrText.length < 20) {
          console.log(`   🔄 Using Gemma Vision API for OCR...`);
          ocrText = await extractTextWithGeminiVision(imageBuffer);
          ocrSource = 'Gemma Vision';
        }

        doc.destroy();

        if (ocrText && ocrText.length > 20) {
          finalText = ocrText;
          extractionMethod = 'ocr';
          usedOcr = true;

          // ✅ Re-detect language after OCR (in case mupdf was wrong)
          language = detectLanguage(ocrText);

          console.log(`   ✅ OCR success (${ocrSource}): ${ocrText.length} chars (re-detected: ${language})`);
          console.log(`   📝 OCR preview: "${ocrText.substring(0, 100)}..."`);
        } else {
          console.warn(`   ⚠️ OCR returned insufficient text (${ocrText?.length || 0} chars)`);

          if (mupdfFailed) {
            console.error(`   ❌ Both mupdf and OCR failed - skipping page`);
            return [];
          }

          // Use mupdf fallback if available
          finalText = rawText;
        }

      } catch (ocrErr) {
        console.error(`   ❌ OCR failed: ${(ocrErr as Error).message}`);

        if (!mupdfFailed && rawText) {
          console.log(`   ↳ Fallback: Using mupdf text (${rawText.length} chars)`);
          finalText = rawText;
        } else {
          console.error(`   ❌ No fallback available - skipping page`);
          return [];
        }
      }
    } else {
      console.log(`   ✓ [STEP 3] Using mupdf extraction (English, sufficient length)`);
    }

    // ✅ STEP 4: Apply AI corrections (only for Arabic)
    // Toggle: Set DISABLE_AI_OCR_CORRECTION=true to see raw OCR quality
    const disableAiCorrection = process.env.DISABLE_AI_OCR_CORRECTION === 'true';
    let correctedText = finalText;
    let correctionConfidence = 1.0;

    if (disableAiCorrection) {
      console.log(`   ⚠️ [STEP 4] AI OCR correction DISABLED - using raw OCR output`);
      correctedText = finalText;
      correctionConfidence = 0.75;
    } else if (language === 'ar') {
      console.log(`   🤖 [STEP 4] Applying enhanced AI-powered Arabic OCR correction...`);

      try {
        // ✅ FIRST: Apply specialized OCR correction (using 27B model for best quality)
        // This specifically targets: ي/ى, أ/ا, ذ/د, ة/ه, ئ/ي confusion
        const ocrCorrectionResult = await correctArabicOcrWithAI(finalText);
        const intermediateText = ocrCorrectionResult.correctedText;
        correctionConfidence = ocrCorrectionResult.confidence;

        console.log(`   ✅ OCR correction complete (model: ${ocrCorrectionResult.modelUsed})`);
        console.log(`   📊 OCR corrections made: ${ocrCorrectionResult.corrections.length}`);

        // ✅ SECOND: Apply general Arabic cleanup if still has issues
        if (hasArabicCorruption(intermediateText) || hasArabicOcrIssues(intermediateText)) {
          console.log(`   🔧 Applying additional Arabic cleanup...`);
          correctedText = await correctArabicWithAI(intermediateText);
          correctionConfidence = Math.min(correctionConfidence, 0.90);
        } else {
          correctedText = intermediateText;
          console.log(`   ✅ No additional cleanup needed`);
        }

        console.log(`   ✅ Arabic text correction complete (confidence: ${(correctionConfidence * 100).toFixed(0)}%)`);
      } catch (aiError) {
        console.error(`   ❌ AI correction failed: ${(aiError as Error).message}`);
        correctedText = finalText;
        correctionConfidence = 0.70;
      }
    } else if (!disableAiCorrection) {
      // English: Check if transliteration fixes are needed
      const hasTransliteration = hasTransliterationIssues(finalText);

      if (hasTransliteration) {
        console.log(`   🔧 [STEP 4] Applying transliteration fixes (English)...`);
        try {
          correctedText = await cleanPdfText(finalText, false);
          correctionConfidence = 0.90;
        } catch (err) {
          console.error(`   ❌ Transliteration fix failed: ${(err as Error).message}`);
          correctedText = finalText;
          correctionConfidence = 0.85;
        }
      } else {
        console.log(`   ✓ [STEP 4] No corrections needed`);
      }
    }

    // ✅ Validate final text
    if (!correctedText || correctedText.length < 10) {
      console.log(`   ⚠️ Insufficient text after processing (${correctedText?.length || 0} chars) - skipping page`);
      return [];
    }

    // ✅ STEP 5: Extract metadata
    console.log(`   🔍 [STEP 5] Extracting metadata...`);

    function extractDatesAndContext(t: string): { dates: string[]; context: string[] } {
      const datePatterns = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g,
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
      ];

      const dates: string[] = [];
      const context: string[] = [];

      for (const pattern of datePatterns) {
        const matches = t.match(pattern);
        if (matches) {
          dates.push(...matches);
          matches.forEach(match => {
            const idx = t.indexOf(match);
            if (idx !== -1) {
              const start = Math.max(0, idx - 50);
              const end = Math.min(t.length, idx + match.length + 50);
              context.push(t.substring(start, end));
            }
          });
        }
      }

      return { dates: [...new Set(dates)], context };
    }

    const { dates: extractedDates, context: extractedContext } = extractDatesAndContext(correctedText);
    console.log(`   ✅ Found ${extractedDates.length} date(s)`);

    // ✅ STEP 5.5: Detect chapter/story boundaries
    console.log(`   📖 [STEP 5.5] Detecting chapter/story boundaries...`);
    let chapterState: ChapterState | null = currentChapterState;

    try {
      const boundary = detectChapterBoundary(correctedText, language);

      if (boundary.isNewSection) {
        console.log(`   📚 NEW ${boundary.sectionType?.toUpperCase() || 'SECTION'} DETECTED!`);
        console.log(`      Number: ${boundary.number || 'N/A'}`);
        console.log(`      Title: ${boundary.title || 'N/A'}`);

        // Update the chapter state
        chapterState = {
          chapterNumber: boundary.sectionType === 'chapter' ? boundary.number : null,
          storyNumber: boundary.sectionType === 'story' ? boundary.number : null,
          chapterTitle: boundary.sectionType === 'chapter' ? boundary.title : null,
          storyTitle: boundary.sectionType === 'story' ? boundary.title : null,
          sectionName: boundary.title || null,
          boundaryType: boundary.sectionType || 'section',
        };

        // Update the global chapter state for subsequent pages
        currentChapterState = chapterState;
      } else if (currentChapterState) {
        // Continue with current chapter state
        chapterState = currentChapterState;
        console.log(`   📖 Continuing ${currentChapterState.boundaryType}: ${currentChapterState.chapterNumber || currentChapterState.storyNumber || 'Unknown'}`);
      } else {
        console.log(`   📖 No chapter/story context yet`);
      }
    } catch (chapterErr) {
      console.warn(`   ⚠️ Chapter detection failed: ${(chapterErr as Error).message}`);
      // Continue with the existing chapter state if any
      chapterState = currentChapterState;
    }

    // ✅ STEP 6: Chunk text
    console.log(`   📦 [STEP 6] Chunking text...`);
    const pageChunks = chunkText(correctedText, 1200, 200);

    if (pageChunks.length === 0) {
      console.log(`   ⚠️ No valid chunks created - skipping page`);
      return [];
    }

    console.log(`   ✅ Created ${pageChunks.length} chunks`);

    // ✅ STEP 7: Embed each chunk
    console.log(`   🔄 [STEP 7] Embedding ${pageChunks.length} chunk(s)...`);

    for (let i = 0; i < pageChunks.length; i++) {
      const chunkText = pageChunks[i];
      let embedding: number[] | null = null;

      // Retry with exponential backoff
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        embedding = await embedChunk(chunkText, pageNum, i, attempt);

        if (embedding) {
          break;
        }

        if (attempt < MAX_RETRIES) {
          const backoffDelay = 2000 * Math.pow(2, attempt - 1);
          console.log(`   ⏳ Waiting ${backoffDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }

      if (!embedding) {
        console.error(`   ❌ Failed to embed chunk ${i + 1} after ${MAX_RETRIES} attempts`);
        console.error(`      Chunk preview: "${chunkText.substring(0, 100)}..."`);
        continue;
      }

      chunks.push({
        documentId,
        chunkText,
        pageNumber: pageNum + 1,
        embedding,
        extractionMethod,
        corrected: correctedText !== finalText,
        language,
        correctionConfidence,
        dates: extractedDates,
        hasDateContext: extractedDates.length > 0,
        // ✅ Enhanced metadata with chapter/story context
        chapterNumber: chapterState?.chapterNumber || null,
        storyTitle: chapterState?.storyTitle || chapterState?.chapterTitle || null,
        sectionName: chapterState?.sectionName || null,
        chapterContext: chapterState?.boundaryType !== 'none'
          ? `${chapterState?.boundaryType} ${chapterState?.chapterNumber || chapterState?.storyNumber || ''}`.trim()
          : null,
        metadata: {
          dateContext: extractedContext,
          chunkIndex: i,
          totalChunks: pageChunks.length,
          // ✅ Additional chapter metadata
          chapter_number: chapterState?.chapterNumber || undefined,
          story_number: chapterState?.storyNumber || undefined,
          chapter_title: chapterState?.chapterTitle || undefined,
          story_title: chapterState?.storyTitle || undefined,
          section_name: chapterState?.sectionName || undefined,
          boundary_type: chapterState?.boundaryType || 'none',
        }
      });
    }

    console.log(`✅ [Page ${pageNum + 1}] Generated ${chunks.length}/${pageChunks.length} chunks (${language}, ${extractionMethod}, confidence: ${(correctionConfidence * 100).toFixed(0)}%)`);

    return chunks;

  } catch (error) {
    console.error(`❌ [Page ${pageNum + 1}] Fatal error:`, error);
    console.error(`   Error details: ${(error as Error).message}`);
    console.error(`   Stack: ${(error as Error).stack?.substring(0, 300)}`);
    return [];
  }
}

/**
 * ✅ Main document processor with batching and rate limiting
 */
export async function embedDocumentInBatches(
  documentId: string,
  pdfPath: string,
  onProgress?: (current: number, total: number) => void
) {
  // ✅ Reset chapter state for new document
  currentChapterState = null;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 STARTING DOCUMENT EMBEDDING`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📄 Document ID: ${documentId}`);
  console.log(`📂 PDF path: ${pdfPath}`);
  console.log(`🤖 Embedding model: gemini-embedding-001`);
  console.log(`📦 Batch size: ${BATCH_SIZE} pages`);
  console.log(`⏱️  Rate limit delay: ${RATE_LIMIT_DELAY}ms`);
  console.log(`🔄 Max retries per chunk: ${MAX_RETRIES}`);
  console.log(`🔤 Arabic OCR: FORCED (always use OCR for Arabic pages)`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    console.log(`📊 PDF loaded: ${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB, ${totalPages} pages\n`);

    updateDocument(documentId, { total_pages: totalPages });

    const allChunks: VectorChunk[] = [];
    let processedPages = 0;

    // Process pages in batches
    for (let i = 0; i < totalPages; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalPages);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalPages / BATCH_SIZE);

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`📦 BATCH ${batchNum}/${totalBatches}: Processing pages ${i + 1}-${batchEnd}`);
      console.log(`${'─'.repeat(60)}`);

      // Process batch in parallel
      const batchPromises = [];
      for (let pageNum = i; pageNum < batchEnd; pageNum++) {
        batchPromises.push(processPage(pdfBytes, pageNum, documentId));
      }

      const batchResults = await Promise.all(batchPromises);

      // Collect all chunks
      for (const pageChunks of batchResults) {
        allChunks.push(...pageChunks);
      }

      processedPages += batchResults.length;

      console.log(`\n📊 Batch ${batchNum} complete:`);
      console.log(`   - Pages processed: ${processedPages}/${totalPages}`);
      console.log(`   - Total chunks so far: ${allChunks.length}`);
      console.log(`   - Progress: ${Math.round((processedPages / totalPages) * 100)}%`);

      if (onProgress) {
        onProgress(processedPages, totalPages);
      }

      // Rate limiting between batches
      if (batchEnd < totalPages) {
        console.log(`\n⏳ Rate limit delay: ${RATE_LIMIT_DELAY}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ ALL PAGES PROCESSED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 Final statistics:`);
    console.log(`   - Total pages: ${totalPages}`);
    console.log(`   - Total chunks: ${allChunks.length}`);
    console.log(`   - Average chunks per page: ${(allChunks.length / totalPages).toFixed(1)}`);
    console.log(`${'='.repeat(60)}\n`);

    if (allChunks.length > 0) {
      console.log(`💾 Storing ${allChunks.length} chunks in vector database...`);
      await addChunksToVectorStore(allChunks);
      console.log(`✅ Vector storage complete\n`);
    } else {
      console.warn(`⚠️ No chunks generated - check PDF content\n`);
    }

    updateDocumentEmbeddingStatus(documentId, 'completed', allChunks.length);

    console.log(`🎉 EMBEDDING COMPLETED for document: ${documentId}\n`);

  } catch (error) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`❌ EMBEDDING FAILED for ${documentId}`);
    console.error(`${'='.repeat(60)}`);
    console.error(`Error: ${(error as Error).message}`);
    console.error(`Stack: ${(error as Error).stack}`);
    console.error(`${'='.repeat(60)}\n`);

    updateDocumentEmbeddingStatus(documentId, 'failed', 0);
    throw error;
  }
}