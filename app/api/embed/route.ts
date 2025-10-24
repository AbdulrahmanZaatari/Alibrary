import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { processAndEmbedDocument } from '@/lib/vectorStore';
import { getDb } from '@/lib/db';
import { extractTextWithGeminiVision } from '@/lib/ocrExtractor';
import mupdf from 'mupdf';

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
    
    // Update SQLite status
    const db = getDb();
    db.prepare(`
      UPDATE documents 
      SET embedding_status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run('processing', documentId);
    
    // Read PDF file
    const filepath = join(process.cwd(), 'public', 'books', filename);
    console.log('📂 Reading PDF from:', filepath);
    
    const dataBuffer = await readFile(filepath);
    console.log('✅ PDF file loaded, size:', dataBuffer.length, 'bytes');
    
    console.log('🔍 Opening PDF with MuPDF (same as PyMuPDF/fitz)...');
    
    // Open PDF document (same as fitz.open() in Python)
    const doc = mupdf.Document.openDocument(dataBuffer, 'application/pdf');
    const numPages = doc.countPages();
    console.log(`📄 PDF has ${numPages} pages`);
    
    const pageTexts: Array<{ pageNumber: number; text: string }> = [];
    
    console.log('🔍 Extracting text with hybrid approach (Direct + Gemini Vision)...');
    
    // Process each page (same as your Streamlit logic)
    for (let pageNum = 0; pageNum < numPages; pageNum++) {
      try {
        const page = doc.loadPage(pageNum);
        
        // Try direct text extraction first (same as page.get_text("text"))
        let pageText = '';
        try {
          pageText = page.toStructuredText().asText().trim();
        } catch (textError) {
          console.log(`   ⚠️ Direct text extraction failed for page ${pageNum + 1}`);
        }
        
        // If no text found, use Gemini Vision OCR (same as your extract_text_with_gemini_vision)
        if (!pageText || pageText.length < 100) {
          console.log(`   🔍 Using Gemini Vision for page ${pageNum + 1}...`);
          
          // Render page to pixmap (same as page.get_pixmap(alpha=False))
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(2, 2), // 2x scale for quality
            mupdf.ColorSpace.DeviceRGB,
            false // alpha=False
          );
          
          // Convert to PNG buffer (Uint8Array -> Buffer)
          const imageUint8Array = pixmap.asPNG();
          const imageBuffer = Buffer.from(imageUint8Array);
          
          // Extract text with Gemini Vision
          pageText = await extractTextWithGeminiVision(imageBuffer);
          
          if (pageText && pageText.length > 10) {
            console.log(`   ✅ OCR Page ${pageNum + 1}: ${pageText.length} characters (Gemini Vision)`);
          } else {
            console.log(`   ⚠️ Page ${pageNum + 1}: No text extracted`);
          }
        } else {
          console.log(`   ✅ Page ${pageNum + 1}: ${pageText.length} characters (Direct PDF)`);
        }
        
        // Add to results if we have text
        if (pageText && pageText.length > 10) {
          pageTexts.push({
            pageNumber: pageNum + 1,
            text: pageText
          });
        }
        
        // Log progress every 10 pages
        if ((pageNum + 1) % 10 === 0) {
          console.log(`   📊 Progress: ${pageNum + 1}/${numPages} pages processed`);
        }
        
      } catch (pageError) {
        console.error(`   ❌ Error processing page ${pageNum + 1}:`, pageError);
      }
    }
    
    // Close document
    doc.destroy();
    
    const totalChars = pageTexts.reduce((sum, p) => sum + p.text.length, 0);
    const successfulPages = pageTexts.length;
    
    console.log(`📊 Final extraction: ${totalChars.toLocaleString()} characters from ${successfulPages}/${numPages} pages`);

    if (successfulPages === 0) {
      throw new Error('No text could be extracted from any page.');
    }

    // Process and embed
    console.log('🚀 Starting embedding process...');
    const chunkCount = await processAndEmbedDocument(documentId, pageTexts);
    console.log(`✅ Created ${chunkCount} embeddings`);

    // Update metadata
    db.prepare(`
      UPDATE documents 
      SET embedding_status = ?, chunks_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run('completed', chunkCount, documentId);

    return NextResponse.json({ 
      success: true,
      chunkCount,
      pagesProcessed: successfulPages,
      totalPages: numPages,
      message: `Successfully embedded ${chunkCount} chunks from ${successfulPages}/${numPages} pages`
    });
  } catch (error) {
    console.error('❌ Embedding error:', error);
    
    if (documentId) {
      try {
        const db = getDb();
        db.prepare(`
          UPDATE documents 
          SET embedding_status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run('failed', documentId);
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