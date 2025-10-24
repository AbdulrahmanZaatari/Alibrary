import { NextRequest, NextResponse } from 'next/server';
import { getBookById } from '@/lib/db';
import { getBookDownloadUrl } from '@/lib/supabaseStorage';
import { extractTextWithGeminiVision } from '@/lib/ocrExtractor';
import mupdf from 'mupdf';

export async function POST(request: NextRequest) {
  try {
    const { bookId, pageNumber } = await request.json();

    if (!bookId || !pageNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const book: any = getBookById(bookId);
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    console.log(`📄 Extracting page ${pageNumber} from ${book.title}`);

    // Download PDF from Supabase
    const downloadUrl = await getBookDownloadUrl(book.supabase_path);
    const response = await fetch(downloadUrl);
    const dataBuffer = Buffer.from(await response.arrayBuffer());

    // Open PDF with MuPDF
    const doc = mupdf.Document.openDocument(dataBuffer, 'application/pdf');
    const page = doc.loadPage(pageNumber - 1);

    // Try direct text extraction
    let pageText = '';
    try {
      pageText = page.toStructuredText().asText().trim();
    } catch {}

    // If no text, use OCR
    if (!pageText || pageText.length < 100) {
      console.log(`   🔍 Using Gemini Vision OCR...`);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(2, 2),
        mupdf.ColorSpace.DeviceRGB,
        false
      );
      const imageBuffer = Buffer.from(pixmap.asPNG());
      pageText = await extractTextWithGeminiVision(imageBuffer);
    }

    doc.destroy();

    return NextResponse.json({ success: true, text: pageText, pageNumber });
  } catch (error) {
    console.error('❌ Page extraction error:', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}