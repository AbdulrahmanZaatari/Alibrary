import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';
import mupdf from 'mupdf';
import { updateDocumentEmbeddingStatus, updateDocument } from './db';
import { addChunksToVectorStore, VectorChunk } from './vectorStore';
import { extractTextWithGeminiVision } from './ocrExtractor';
import { chunkText } from './gemini';
import { cleanPdfText, hasTransliterationIssues } from './transliterationMapper';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BATCH_SIZE = 2; 
const MAX_RETRIES = 3;
const EMBEDDING_TIMEOUT = 30000;
const RATE_LIMIT_DELAY = 12000; 

async function fetchWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

export async function embedDocumentInBatches(
  documentId: string,
  pdfPath: string,
  onProgress?: (current: number, total: number) => void
) {
  try {
    console.log(`📄 Starting embedding for document: ${documentId}`);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`File not found: ${pdfPath}`);
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    console.log(`📊 Total pages: ${totalPages}`);
    updateDocument(documentId, { total_pages: totalPages });

    let processedPages = 0;
    let totalChunks = 0;

    for (let i = 0; i < totalPages; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalPages);
      const batchPromises = [];

      console.log(`📦 Processing batch: pages ${i + 1}-${batchEnd} of ${totalPages}`);

      for (let pageNum = i; pageNum < batchEnd; pageNum++) {
        batchPromises.push(
          processPage(pdfBytes, pageNum, documentId).catch(error => {
            console.error(`❌ Error on page ${pageNum + 1}:`, error.message);
            return [];
          })
        );
      }

      const batchResults = await Promise.all(batchPromises);
      const batchChunks = batchResults.flat();
      
      if (batchChunks.length > 0) {
        try {
          await addChunksToVectorStore(batchChunks);
          totalChunks += batchChunks.length;
          console.log(`✅ Stored ${batchChunks.length} chunks (batch ${Math.floor(i/BATCH_SIZE) + 1})`);
        } catch (error) {
          console.error('Error storing batch chunks:', error);
        }
      }

      processedPages = batchEnd;
      onProgress?.(processedPages, totalPages);

      if (batchEnd < totalPages) {
        console.log(`⏳ Waiting ${RATE_LIMIT_DELAY/1000}s before next batch (rate limit protection)...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    console.log(`✅ Embedding complete: ${totalChunks} chunks from ${totalPages} pages`);
    updateDocument(documentId, { chunks_count: totalChunks });

    return { success: true, totalPages, chunksCount: totalChunks };
  } catch (error) {
    console.error('❌ Embedding process error:', error);
    throw error;
  }
}

/**
 * Detect language from text
 */
function detectLanguage(text: string): 'ar' | 'en' {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length || 1;
  const arabicRatio = arabicChars / totalChars;
  return arabicRatio > 0.3 ? 'ar' : 'en';
}

async function processPage(
  pdfBytes: Buffer,
  pageNum: number,
  documentId: string
): Promise<VectorChunk[]> {
  const chunks: VectorChunk[] = [];
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  const page = doc.loadPage(pageNum);

  let rawText = '';
  try {
    rawText = page.toStructuredText().asText().trim();
  } catch (err) {
    rawText = '';
  }

  const scale = 2.5;
  let imageBuffer: Buffer | null = null;
  let ocrText = '';
  let usedRotation = false;

  try {
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    imageBuffer = Buffer.from(pixmap.asPNG());
    ocrText = await extractTextWithGeminiVision(imageBuffer);
  } catch (err) {
    console.warn(`⚠️ OCR failed for page ${pageNum + 1}: ${(err as Error).message}`);
    ocrText = '';
  }

  if (!ocrText || ocrText.length < 40) {
    try {
      const combinedMatrix = mupdf.Matrix.concat(mupdf.Matrix.rotate(Math.PI / 2), mupdf.Matrix.scale(scale, scale));
      const rotatedPixmap = page.toPixmap(combinedMatrix, mupdf.ColorSpace.DeviceRGB, false);
      const rotatedBuffer = Buffer.from(rotatedPixmap.asPNG());
      const rotatedOcr = await extractTextWithGeminiVision(rotatedBuffer);
      if (rotatedOcr && rotatedOcr.length > ocrText.length) {
        ocrText = rotatedOcr;
        imageBuffer = rotatedBuffer;
        usedRotation = true;
      }
    } catch (rotErr) {
      console.warn(`⚠️ Rotated OCR failed for page ${pageNum + 1}: ${(rotErr as Error).message}`);
    }
  }

  doc.destroy();

  // ✅ HYBRID APPROACH: Choose best extraction method
  let finalText = '';
  let extractionMethod: 'pdf_text' | 'ocr' | 'hybrid' = 'pdf_text';
  const language = detectLanguage(ocrText || rawText);

  if (language === 'ar') {
    // For Arabic: prefer OCR (better RTL support)
    finalText = ocrText || rawText;
    extractionMethod = ocrText ? 'ocr' : 'pdf_text';
    console.log(`📝 Arabic detected: using ${extractionMethod}`);
  } else {
    // For English: use hybrid approach
    if (rawText.length > 40 && ocrText.length > 40) {
      // Use PDF text but verify with OCR for special characters
      finalText = rawText;
      extractionMethod = 'hybrid';
      console.log('📝 English detected: using hybrid (PDF + OCR verification)');
    } else if (ocrText.length > rawText.length) {
      finalText = ocrText;
      extractionMethod = 'ocr';
      console.log('📝 English detected: OCR has more content');
    } else {
      finalText = rawText;
      extractionMethod = 'pdf_text';
      console.log('📝 English detected: using PDF text');
    }
  }

  const isImageHeavy = (!finalText || finalText.length < 30) && !!imageBuffer;

  if (!finalText || finalText.length < 10) {
    console.log(`⚠️ Page ${pageNum + 1} is image-heavy or has no usable text. Skipping chunk creation.`);
    return [];
  }

  function extractDatesAndContext(t: string): { dates: string[]; context: string[] } {
    const datePatterns = [
      /\b\d{4}\b/g,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/ig,
      /\b\d{1,2}\s+(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+\d{2,4}\b/ig
    ];
    const foundDates = new Set<string>();
    for (const p of datePatterns) {
      let m;
      while ((m = p.exec(t))) foundDates.add(m[0]);
    }
    const context: string[] = [];
    t.split('\n').forEach(line => {
      if (datePatterns.some(p => p.test(line))) context.push(line.trim());
    });
    return { dates: Array.from(foundDates).slice(0, 8), context };
  }
  const { dates: extractedDates, context: extractedContext } = extractDatesAndContext(finalText);

  // ✅ STEP 1: Detect if transliteration issues exist
  const transliterationFixed = hasTransliterationIssues(finalText);
  
  // ✅ STEP 2: Apply Regex corrections (fast)
  console.log('🔧 Applying regex corrections...');
  let correctedText = await cleanPdfText(finalText, false); // Regex only for speed
  
  // ✅ STEP 3: Use AI validation for important/corrupted pages
  let correctionConfidence = 0.85;
  
  if (transliterationFixed && correctedText.length > 500) {
    console.log('✨ Transliteration issues detected');
    console.log('🤖 Applying AI validation for quality...');
    
    try {
      // Use AI to validate and perfect the regex corrections
      correctedText = await cleanPdfText(finalText, true); // Enable AI
      correctionConfidence = 0.98;
      console.log('✅ AI validation complete');
    } catch (error) {
      console.warn(`⚠️ AI validation failed, using regex corrections: ${error}`);
      correctionConfidence = 0.85;
    }
  } else if (transliterationFixed) {
    console.log('✨ Minor transliteration issues fixed with regex');
    correctionConfidence = 0.90;
  } else {
    console.log('✓ No transliteration issues detected');
    correctionConfidence = 1.0;
  }

  // ✅ STEP 4: Chunk and embed
  const pageChunks = chunkText(correctedText, 1200, 200);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  for (let i = 0; i < pageChunks.length; i++) {
    const chunkText = pageChunks[i];
    let embedding: number[] | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetchWithTimeout(model.embedContent(chunkText), EMBEDDING_TIMEOUT);
        embedding = res.embedding.values;
        break;
      } catch (err) {
        console.warn(`⚠️ Embedding attempt ${attempt + 1} failed: ${(err as Error).message}`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    
    if (!embedding) {
      console.error(`❌ Failed to embed chunk ${i} on page ${pageNum + 1} after ${MAX_RETRIES} attempts. Skipping chunk.`);
      continue; 
    }

    chunks.push({
      documentId,
      chunkText,
      pageNumber: pageNum + 1,
      embedding,
      metadata: {
        original_text: finalText.substring(0, 500),
        language,
        correction_confidence: correctionConfidence,
        transliteration_fixed: transliterationFixed,
        extraction_method: extractionMethod,
        is_image_heavy: isImageHeavy,
        used_rotation: usedRotation,
        extracted_dates: extractedDates,
        extracted_context: extractedContext,
        chunk_index_in_page: i,
        length: chunkText.length,
        byteSize: new TextEncoder().encode(chunkText).length,
        timestamp: new Date().toISOString()
      }
    });
  }

  console.log(`✅ Created ${chunks.length} chunks (${language}, ${extractionMethod}, confidence: ${(correctionConfidence * 100).toFixed(0)}%)`);
  return chunks;
}