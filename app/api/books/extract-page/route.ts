import { NextRequest, NextResponse } from 'next/server';
import { getBookById } from '@/lib/db';
import { getBookDownloadUrl } from '@/lib/supabaseStorage';
import { extractTextWithGeminiVision } from '@/lib/ocrExtractor';
import { cleanPdfText } from '@/lib/transliterationMapper';
import mupdf from 'mupdf';

export async function POST(request: NextRequest) {
  try {
    const { bookId, pageNumber, enableAiCorrection } = await request.json();

    if (!bookId || !pageNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const book: any = getBookById(bookId);
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    console.log(`📄 Extracting page ${pageNumber} from ${book.title}`);

    const downloadUrl = await getBookDownloadUrl(book.supabase_path);
    const response = await fetch(downloadUrl);
    const dataBuffer = Buffer.from(await response.arrayBuffer());

    const doc = mupdf.Document.openDocument(dataBuffer, 'application/pdf');
    const page = doc.loadPage(pageNumber - 1);

    let pageText = '';
    try {
      pageText = page.toStructuredText().asText().trim();
    } catch {}

    const arabicChars = (pageText.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = pageText.replace(/\s/g, '').length || 1;
    const isArabic = (arabicChars / totalChars) > 0.3;

    if (isArabic || !pageText || pageText.length < 100) {
      console.log(`   🔍 Using Gemini Vision OCR (${isArabic ? 'Arabic detected' : 'no text found'})...`);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(2.5, 2.5),
        mupdf.ColorSpace.DeviceRGB,
        false
      );
      const imageBuffer = Buffer.from(pixmap.asPNG());
      pageText = await extractTextWithGeminiVision(imageBuffer);
    }

    doc.destroy();

    // ✅ Step 1: Regex corrections
    // ✅ Step 2: AI validates and perfects
    console.log('🔧 Applying corrections (Regex + AI validation)...');
    const useAI = enableAiCorrection !== false; // Default to true
    const cleanedText = await cleanPdfText(pageText, useAI);

    return NextResponse.json({ 
      success: true, 
      text: cleanedText, 
      pageNumber,
      language: isArabic ? 'ar' : 'en',
      corrected: cleanedText !== pageText,
      aiUsed: useAI
    });
  } catch (error) {
    console.error('❌ Page extraction error:', error);
    return NextResponse.json({ 
      error: 'Extraction failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}