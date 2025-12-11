import { NextRequest, NextResponse } from 'next/server';
import { cleanArabicPdfText, hasArabicCorruption } from '@/lib/arabicTextCleaner';
import { cleanPdfText } from '@/lib/transliterationMapper';
import { extractTextWithGeminiVision } from '@/lib/ocrExtractor';
import { extractTextWithOcrSpace, isOcrSpaceAvailable } from '@/lib/ocrSpaceApi';
import { correctArabicOcrWithAI } from '@/lib/arabicOcrCorrection';
import { getBookById } from '@/lib/db';
import { getBookBuffer } from '@/lib/supabaseStorage';
import mupdf from 'mupdf';

export async function POST(request: NextRequest) {
  try {
    const { bookId, pageNumber, enableAiCorrection } = await request.json();

    if (!bookId || !pageNumber) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    console.log(`📖 Extracting page ${pageNumber} from book ${bookId}`);

    // ✅ STEP 1: Get book metadata from SQLite database
    const book = getBookById(bookId) as any;
    
    if (!book) {
      console.error('Book not found in database');
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // ✅ STEP 2: Download PDF from Supabase Storage (with local cache)
    console.log('📂 Fetching from storage:', book.supabase_path);
    const pdfBytes = await getBookBuffer(bookId, book.supabase_path);
    
    if (!pdfBytes || pdfBytes.length === 0) {
      console.error('PDF buffer is empty');
      return NextResponse.json({ error: 'PDF not found in storage' }, { status: 404 });
    }

    console.log(`   ✓ Downloaded PDF: ${pdfBytes.length} bytes`);

    // ✅ STEP 3: Quick mupdf extraction to detect language
    let pageText = '';
    let extractionMethod = 'mupdf';
    
    try {
      const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
      const page = doc.loadPage(pageNumber - 1);
      pageText = page.toStructuredText().asText().trim();
      doc.destroy();
      console.log(`   ✓ mupdf extracted ${pageText.length} chars`);
    } catch (mupdfError) {
      console.error(`   ❌ mupdf failed: ${(mupdfError as Error).message}`);
    }

    // ✅ STEP 4: Detect language
    const arabicChars = (pageText.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = pageText.replace(/\s/g, '').length || 1;
    const isArabic = (arabicChars / totalChars) > 0.3;

    console.log(`   🌐 Detected: ${isArabic ? 'Arabic' : 'English'}`);

    // ✅ STEP 5: For Arabic - ALWAYS force OCR (OCR.space first, then Gemma fallback)
    if (isArabic) {
      console.log(`   📸 Arabic detected - forcing OCR`);
      
      try {
        const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
        const page = doc.loadPage(pageNumber - 1);
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(2.5, 2.5),
          mupdf.ColorSpace.DeviceRGB,
          false
        );
        const imageBuffer = Buffer.from(pixmap.asPNG());
        
        let ocrText = '';
        
        // Try OCR.space first for Arabic
        if (isOcrSpaceAvailable()) {
          console.log(`   🌐 Trying OCR.space API for Arabic...`);
          const ocrSpaceResult = await extractTextWithOcrSpace(imageBuffer, 'ara');
          if (ocrSpaceResult.success && ocrSpaceResult.text.length > 20) {
            ocrText = ocrSpaceResult.text;
            console.log(`   ✅ OCR.space success: ${ocrText.length} chars`);
            
            // ✅ Apply Gemma AI correction to OCR.space output
            console.log(`   🤖 Applying Gemma AI correction...`);
            try {
              const correctionResult = await correctArabicOcrWithAI(ocrText);
              if (correctionResult.correctedText && correctionResult.correctedText.length > 20) {
                console.log(`   ✅ AI correction applied: ${correctionResult.corrections.length} fixes`);
                ocrText = correctionResult.correctedText;
              }
            } catch {
              console.warn(`   ⚠️ AI correction failed, using raw OCR.space text`);
            }
          } else {
            console.log(`   ⚠️ OCR.space failed, falling back to Gemma...`);
          }
        }
        
        // Fallback to Gemma Vision
        if (!ocrText || ocrText.length < 20) {
          ocrText = await extractTextWithGeminiVision(imageBuffer);
        }
        
        doc.destroy();
        
        if (ocrText && ocrText.length > 20) {
          pageText = ocrText;
          extractionMethod = 'ocr';
          console.log(`   ✅ OCR extracted ${ocrText.length} chars`);
        } else {
          console.warn(`   ⚠️ OCR insufficient, using mupdf fallback`);
        }
      } catch (ocrError) {
        console.error(`   ❌ OCR failed: ${(ocrError as Error).message}`);
      }
    }

    // ✅ STEP 6: Apply corrections
    let cleanedText = pageText;
    let corrected = false;
    
    if (isArabic) {
      console.log('   🔧 Applying Arabic cleaning...');
      cleanedText = cleanArabicPdfText(pageText);
      corrected = cleanedText !== pageText || hasArabicCorruption(pageText);
      
      console.log(`   📊 Corruption ${hasArabicCorruption(cleanedText) ? 'remains' : 'fixed'}`);
    } else {
      console.log('   🔧 Applying transliteration fixes...');
      const useAI = enableAiCorrection !== false;
      cleanedText = await cleanPdfText(pageText, useAI);
      corrected = cleanedText !== pageText;
    }

    return NextResponse.json({ 
      success: true, 
      text: cleanedText, 
      pageNumber,
      language: isArabic ? 'ar' : 'en',
      corrected,
      extractionMethod,
      stats: {
        originalLength: pageText.length,
        cleanedLength: cleanedText.length,
        arabicRatio: isArabic ? (arabicChars / totalChars * 100).toFixed(1) + '%' : '0%'
      }
    });
  } catch (error) {
    console.error('❌ Page extraction error:', error);
    return NextResponse.json({ 
      error: 'Extraction failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}