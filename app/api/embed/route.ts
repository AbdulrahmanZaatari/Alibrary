import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { getDb, updateDocument } from '@/lib/db'; 
import { extractTextWithGeminiVision } from '@/lib/ocrExtractor';
import mupdf from 'mupdf';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { chunkText } from '@/lib/chunking';
import { addChunksToVectorStore, VectorChunk } from '@/lib/vectorStore'; 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  let documentId: string = '';
  
  try {
    const body = await request.json();
    documentId = body.documentId;
    const filename = body.filename;
    
    if (!documentId || !filename) {
      return NextResponse.json({ 
        error: 'Missing required fields' 
      }, { status: 400 });
    }
    
    console.log('📄 Embedding document:', { documentId, filename });
    
    const db = getDb();
    // <-- MODIFIED: Use the imported function
    updateDocument(documentId, { embedding_status: 'processing' });
    
    const filepath = join(process.cwd(), 'public', 'books', filename);
    console.log('📂 Reading PDF from:', filepath);
    
    const dataBuffer = await readFile(filepath);
    console.log('✅ PDF file loaded, size:', dataBuffer.length, 'bytes');
    
    console.log('🔍 Opening PDF with MuPDF...');
    
    const doc = mupdf.Document.openDocument(dataBuffer, 'application/pdf');
    const numPages = doc.countPages();
    console.log(`📄 PDF has ${numPages} pages`);
    
    // <-- NEW: Update total pages in DB
    updateDocument(documentId, { total_pages: numPages });
    
    // <-- NEW: Init embedding model and chunk counter
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    let totalChunks = 0;

    console.log('🔍 Extracting text with hybrid approach (Direct + Gemini Vision)...');
    
    // Process each page
    for (let pageNum = 0; pageNum < numPages; pageNum++) {
      console.log(`   Processing page ${pageNum + 1}/${numPages}...`);
      let pageText = '';
      const page = doc.loadPage(pageNum);

      try {
        // 1. Try direct text extraction
        try {
          pageText = page.toStructuredText().asText().trim();
        } catch (textError) {
          console.log(`   ⚠️ Direct text extraction failed for page ${pageNum + 1}`);
        }
        
        // 2. Fallback to Gemini Vision OCR
        if (!pageText || pageText.length < 100) {
          console.log(`   🔍 Using Gemini Vision for page ${pageNum + 1}...`);
          
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(2, 2),
            mupdf.ColorSpace.DeviceRGB,
            false
          );
          
          const imageBuffer = Buffer.from(pixmap.asPNG());
          
          try {
            pageText = await extractTextWithGeminiVision(imageBuffer);
            console.log(`   ✅ OCR Page ${pageNum + 1}: ${pageText.length} characters`);
          } catch (ocrError: any) {
            console.error(`   ❌ OCR failed for page ${pageNum + 1}: ${ocrError.message}`);
            pageText = ''; // Ensure text is empty on failure
          }
        } else {
          console.log(`   ✅ Page ${pageNum + 1}: ${pageText.length} characters (Direct PDF)`);
        }

        // 3. Skip if no text
        if (!pageText || pageText.length < 10) {
          console.log(`   ⚠️ Page ${pageNum + 1} is image-heavy or has no usable text. Skipping.`);
          continue;
        }
        
        // 4. Semantic Chunking (NEW)
        const pageChunks = chunkText(pageText, 1000, 200); // Use your new chunker
        const vectorChunks: VectorChunk[] = [];
        
        // 5. Embed Chunks for this page
        for (let i = 0; i < pageChunks.length; i++) {
          const chunkText = pageChunks[i];
          try {
            const res = await model.embedContent(chunkText);
            const embedding = res.embedding.values;
            
            vectorChunks.push({
              documentId,
              chunkText,
              pageNumber: pageNum + 1,
              embedding,
              metadata: {
                // Add any metadata you want here
                chunk_index_in_page: i,
                length: chunkText.length,
                timestamp: new Date().toISOString()
              }
            });
          } catch (embedError: any) {
            console.warn(`   ❌ Embedding failed for chunk ${i} on page ${pageNum + 1}: ${embedError.message}`);
            // Add a small delay if we hit a rate limit
            if (embedError.message.includes('quota')) {
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
        
        // 6. Store chunks for this page
        if (vectorChunks.length > 0) {
          try {
            await addChunksToVectorStore(vectorChunks); // Assuming this is your Supabase insert fn
            totalChunks += vectorChunks.length;
            console.log(`   ✅ Stored ${vectorChunks.length} chunks for page ${pageNum + 1}`);
          } catch (storeError: any) {
            console.error(`   ❌ Failed to store chunks for page ${pageNum + 1}: ${storeError.message}`);
          }
        }
        
        // Add a rate limit delay to avoid spamming embedding API
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay per page
      
      } catch (pageError) {
        console.error(`   ❌ Error processing page ${pageNum + 1}:`, pageError);
      } finally {
        page.destroy(); // <-- IMPORTANT: Free page memory
      }
    }
    
    doc.destroy(); // <-- IMPORTANT: Free document memory
    
    console.log(`✅ Embedding complete. Total chunks: ${totalChunks}`);

    // Update metadata
    updateDocument(documentId, {
      embedding_status: 'completed',
      chunks_count: totalChunks
    });

    return NextResponse.json({ 
      success: true,
      chunkCount: totalChunks,
      totalPages: numPages,
      message: `Successfully embedded ${totalChunks} chunks from ${numPages} pages`
    });
  } catch (error) {
    console.error('❌ Embedding error:', error);
    
    if (documentId) {
      try {
        updateDocument(documentId, { embedding_status: 'failed' });
      } catch (dbError) {
        console.error('Failed to update error status:', dbError);
      }
    }
    
    return NextResponse.json({ 
      error: 'Embedding failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}