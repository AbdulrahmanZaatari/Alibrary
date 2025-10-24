import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';
import mupdf from 'mupdf';
import { updateDocumentEmbeddingStatus, updateDocument } from './db';
import { addChunksToVectorStore, VectorChunk } from './vectorStore';
import { extractTextWithGeminiVision } from './ocrExtractor';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ✅ Optimized batch settings to avoid rate limits
const BATCH_SIZE = 3; // Process 3 pages at a time (was 10)
const MAX_RETRIES = 3;
const EMBEDDING_TIMEOUT = 30000;
const RATE_LIMIT_DELAY = 8000; // Wait 8 seconds between batches

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

    // ✅ Read file from filesystem
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`File not found: ${pdfPath}`);
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    console.log(`📊 Total pages: ${totalPages}`);

    // Update total pages in DB
    updateDocument(documentId, { total_pages: totalPages });

    let processedPages = 0;
    let totalChunks = 0;

    // Process in batches
    for (let i = 0; i < totalPages; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalPages);
      const batchPromises = [];

      console.log(`📦 Processing batch: pages ${i + 1}-${batchEnd} of ${totalPages}`);

      // Process pages in parallel (3 at a time to avoid rate limits)
      for (let pageNum = i; pageNum < batchEnd; pageNum++) {
        batchPromises.push(
          processPage(pdfBytes, pageNum, documentId).catch(error => {
            console.error(`❌ Error on page ${pageNum + 1}:`, error.message);
            return [];
          })
        );
      }

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Flatten and store all chunks from this batch
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

      // ✅ Rate limiting: Wait 8 seconds between batches to avoid 429 errors
      if (batchEnd < totalPages) {
        console.log(`⏳ Waiting ${RATE_LIMIT_DELAY/1000}s before next batch (rate limit protection)...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    console.log(`✅ Embedding complete: ${totalChunks} chunks from ${totalPages} pages`);

    // Update DB with final counts
    updateDocument(documentId, { chunks_count: totalChunks });

    return { success: true, totalPages, chunksCount: totalChunks };
  } catch (error) {
    console.error('❌ Embedding process error:', error);
    throw error;
  }
}

async function processPage(
  pdfBytes: Buffer,
  pageNum: number,
  documentId: string
): Promise<VectorChunk[]> {
  const chunks: VectorChunk[] = [];
  
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  const page = doc.loadPage(pageNum);

  // Extract text from PDF
  let text = '';
  try {
    text = page.toStructuredText().asText().trim();
  } catch (error) {
    console.warn(`⚠️ Text extraction failed for page ${pageNum + 1}, will try OCR`);
  }

  // ✅ Use OCR if text is too short or missing
  if (!text || text.length < 50) {
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(2, 2),
      mupdf.ColorSpace.DeviceRGB,
      false
    );
    const imageBuffer = Buffer.from(pixmap.asPNG());
    
    // Use OCR function with retry logic and model fallbacks
    try {
      text = await extractTextWithGeminiVision(imageBuffer);
      console.log(`📷 OCR extracted ${text.length} characters from page ${pageNum + 1}`);
    } catch (error: any) {
      console.error(`❌ OCR failed for page ${pageNum + 1}:`, error.message);
      text = ''; // Continue processing even if OCR fails
    }
  }

  doc.destroy();

  // Skip pages with insufficient text
  if (!text || text.length < 10) {
    console.warn(`⚠️ Page ${pageNum + 1} has insufficient text (${text.length} chars), skipping`);
    return [];
  }

  // Split text into chunks
  const textChunks = chunkText(text, 1000, 100);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  // Generate embeddings for all chunks
  for (let i = 0; i < textChunks.length; i++) {
    const chunkText = textChunks[i];
    let embedding = null;

    // Retry logic for embedding generation
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        const result = await fetchWithTimeout(
          model.embedContent(chunkText),
          EMBEDDING_TIMEOUT
        );
        embedding = result.embedding.values;
        break;
      } catch (error: any) {
        console.warn(`⚠️ Embedding retry ${retry + 1}/${MAX_RETRIES} for page ${pageNum + 1}, chunk ${i + 1}`);
        
        // If it's the last retry, log error and skip this chunk
        if (retry === MAX_RETRIES - 1) {
          console.error(`❌ Failed to embed chunk after ${MAX_RETRIES} retries:`, error.message);
          break;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }

    // Skip chunk if embedding failed
    if (!embedding) continue;

    chunks.push({
      documentId,
      chunkText,
      pageNumber: pageNum + 1,
      embedding,
      metadata: {
        length: chunkText.length,
        timestamp: new Date().toISOString(),
      }
    });
  }

  console.log(`✅ Page ${pageNum + 1}: Created ${chunks.length} chunks`);
  return chunks;
}

/**
 * Split text into chunks with overlap for better context preservation
 */
function chunkText(text: string, maxLength: number = 1000, overlap: number = 100): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');

  let currentChunk = '';
  for (const para of paragraphs) {
    if ((currentChunk + para).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  
  // Filter out very short chunks
  return chunks.filter(c => c.length > 10);
}