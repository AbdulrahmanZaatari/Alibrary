import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';
import mupdf from 'mupdf';
import { updateDocumentEmbeddingStatus, updateDocument } from './db';
import { addChunksToVectorStore, VectorChunk } from './vectorStore';
import { extractTextWithGeminiVision } from './ocrExtractor';
import { chunkText } from './gemini';
import { cleanPdfText, hasTransliterationIssues } from './transliterationMapper';
import { correctArabicWithAI, hasArabicCorruption } from './arabicTextCleaner';
import fs from 'fs';

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

export async function embedDocumentInBatches(
  documentId: string,
  pdfPath: string,
  onProgress?: (current: number, total: number) => void
) {
  console.log(`\n🚀 Starting embedding for document: ${documentId}`);
  console.log(`📂 PDF path: ${pdfPath}`);

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    console.log(`📄 Total pages: ${totalPages}`);

    updateDocument(documentId, { total_pages: totalPages });

    const allChunks: VectorChunk[] = [];
    let processedPages = 0;

    for (let i = 0; i < totalPages; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalPages);
      console.log(`\n📦 Processing batch: pages ${i + 1}-${batchEnd}`);

      const batchPromises = [];
      for (let pageNum = i; pageNum < batchEnd; pageNum++) {
        batchPromises.push(processPage(pdfBytes, pageNum, documentId));
      }

      const batchResults = await Promise.all(batchPromises);
      
      for (const pageChunks of batchResults) {
        allChunks.push(...pageChunks);
      }

      processedPages += batchResults.length;

      if (onProgress) {
        onProgress(processedPages, totalPages);
      }

      if (batchEnd < totalPages) {
        console.log(`⏳ Rate limit delay: ${RATE_LIMIT_DELAY}ms`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    console.log(`\n✅ All pages processed. Total chunks: ${allChunks.length}`);

    if (allChunks.length > 0) {
      console.log(`💾 Storing ${allChunks.length} chunks in vector database...`);
      await addChunksToVectorStore(allChunks);
      console.log(`✅ Vector storage complete`);
    }

    updateDocumentEmbeddingStatus(documentId, 'completed', allChunks.length);
    console.log(`\n🎉 Embedding completed for document: ${documentId}`);

  } catch (error) {
    console.error(`❌ Embedding failed for ${documentId}:`, error);
    updateDocumentEmbeddingStatus(documentId, 'failed', 0);
    throw error;
  }
}

/**
 * Detect language from text
 */
function detectLanguage(text: string): 'ar' | 'en' {
  if (!text) return 'en';
  
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  
  if (totalChars === 0) return 'en';
  
  const arabicRatio = arabicChars / totalChars;
  return arabicRatio > 0.3 ? 'ar' : 'en';
}

/**
 * ✅ Process a single page: Extract → Correct → Chunk → Embed
 */
async function processPage(
  pdfBytes: Buffer,
  pageNum: number,
  documentId: string
): Promise<VectorChunk[]> {
  const chunks: VectorChunk[] = [];
  
  // ✅ STEP 1: Extract text with mupdf (fast initial extraction)
  let rawText = '';
  let mupdfFailed = false;
  
  try {
    const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
    const page = doc.loadPage(pageNum);
    rawText = page.toStructuredText().asText().trim();
    doc.destroy();
    
    if (!rawText || rawText.length < 20) {
      console.warn(`⚠️ mupdf extraction insufficient for page ${pageNum + 1} (${rawText.length} chars)`);
      mupdfFailed = true;
    }
  } catch (err) {
    console.error(`❌ mupdf extraction failed: ${(err as Error).message}`);
    mupdfFailed = true;
    rawText = '';
  }

  // ✅ STEP 2: Detect language (before OCR decision)
  let language = detectLanguage(rawText);
  console.log(`🌐 Page ${pageNum + 1}: Initial detection: ${language} (${rawText.length} chars)`);

  // ✅ STEP 3: Decide if OCR is needed
  let finalText = rawText;
  let extractionMethod: 'mupdf' | 'ocr' = 'mupdf';
  let usedOcr = false;
  
  const needsOcr = language === 'ar' || mupdfFailed;
  
  if (needsOcr) {
    console.log(`📸 OCR needed for page ${pageNum + 1} (${language === 'ar' ? 'Arabic detected' : 'mupdf failed'})`);
    
    try {
      const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
      const page = doc.loadPage(pageNum);
      
      const scale = 2.5;
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale), 
        mupdf.ColorSpace.DeviceRGB, 
        false
      );
      const imageBuffer = Buffer.from(pixmap.asPNG());
      
      const ocrText = await extractTextWithGeminiVision(imageBuffer);
      doc.destroy();
      
      if (ocrText && ocrText.length > 20) {
        finalText = ocrText;
        extractionMethod = 'ocr';
        usedOcr = true;
        
        // ✅ Re-detect language after OCR (in case mupdf was wrong)
        language = detectLanguage(ocrText);
        
        console.log(`✅ OCR extracted ${ocrText.length} chars (re-detected: ${language})`);
      } else {
        console.warn(`⚠️ OCR returned insufficient text for page ${pageNum + 1}`);
        
        // ✅ If OCR fails and mupdf also failed, skip page
        if (mupdfFailed) {
          console.error(`❌ Both mupdf and OCR failed for page ${pageNum + 1}`);
          return [];
        }
      }
    } catch (ocrErr) {
      console.error(`❌ OCR failed for page ${pageNum + 1}: ${(ocrErr as Error).message}`);
      
      // ✅ Fallback to mupdf if available
      if (!mupdfFailed && rawText) {
        console.log(`   ↳ Using mupdf fallback text (${rawText.length} chars)`);
        finalText = rawText;
      } else {
        console.error(`❌ No fallback available for page ${pageNum + 1}`);
        return [];
      }
    }
  } else {
    console.log(`✓ English text detected - using mupdf extraction`);
  }

  // ✅ STEP 4: Apply AI corrections
  let correctedText = finalText;
  let correctionConfidence = 1.0;
  
  if (language === 'ar') {
    console.log('🤖 Applying AI-powered Arabic correction...');
    
    try {
      correctedText = await correctArabicWithAI(finalText);
      
      if (hasArabicCorruption(correctedText)) {
        console.log('⚠️ Some Arabic corruption remains after AI correction');
        correctionConfidence = 0.85;
      } else {
        console.log('✅ Arabic text corrected successfully with AI');
        correctionConfidence = usedOcr ? 0.98 : 0.90;
      }
    } catch (aiError) {
      console.error('❌ AI correction failed, using original text:', (aiError as Error).message);
      correctedText = finalText;
      correctionConfidence = 0.70;
    }
  } else {
    // ✅ English: Check if transliteration fixes are needed
    const hasTransliteration = hasTransliterationIssues(finalText);
    
    if (hasTransliteration) {
      console.log('🔧 Applying transliteration fixes (English)...');
      try {
        correctedText = await cleanPdfText(finalText, false);
        correctionConfidence = 0.90;
      } catch (err) {
        console.error('❌ Transliteration fix failed:', (err as Error).message);
        correctedText = finalText;
        correctionConfidence = 0.85;
      }
    }
  }

  // ✅ Validate final text
  if (!correctedText || correctedText.length < 10) {
    console.log(`⚠️ Page ${pageNum + 1} has insufficient text after processing`);
    return [];
  }

  // ✅ STEP 5: Extract metadata (dates, citations, etc.)
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

  // ✅ STEP 6: Chunk and embed
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
        console.error(`⚠️ Embedding attempt ${attempt + 1} failed for page ${pageNum + 1}, chunk ${i + 1}`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        }
      }
    }

    if (!embedding) {
      console.error(`❌ Failed to embed page ${pageNum + 1}, chunk ${i + 1} after ${MAX_RETRIES} attempts`);
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
      metadata: {
        dateContext: extractedContext,
        chunkIndex: i,
        totalChunks: pageChunks.length,
      }
    });
  }

  console.log(`✅ Page ${pageNum + 1}: Generated ${chunks.length} chunks (${language}, ${extractionMethod}, confidence: ${(correctionConfidence * 100).toFixed(0)}%)`);

  return chunks;
}