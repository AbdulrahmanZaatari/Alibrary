import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addBook } from '@/lib/db';
import { uploadBookToSupabase } from '@/lib/supabaseStorage';
import { PDFDocument } from 'pdf-lib';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file || !file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'Invalid PDF file' }, { status: 400 });
    }

    console.log('📄 Processing PDF:', file.name);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Extract page count
    let pageCount = 0;
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      pageCount = pdfDoc.getPageCount();
      console.log('📊 Page count:', pageCount);
    } catch (pdfError) {
      console.error('❌ PDF parsing error:', pdfError);
      return NextResponse.json({ error: 'Invalid PDF format' }, { status: 400 });
    }

    const bookId = uuidv4();
    const filename = `${bookId}.pdf`;

    console.log('📤 Uploading book to Supabase...');
    
    let supabasePath;
    try {
      supabasePath = await uploadBookToSupabase(bookId, buffer, filename);
    } catch (uploadError: any) {
      console.error('❌ Supabase upload failed:', uploadError);
      return NextResponse.json({ 
        error: `Upload failed: ${uploadError.message}`,
        details: uploadError.toString()
      }, { status: 500 });
    }

    // Save to database
    try {
      addBook({
        id: bookId,
        filename,
        title: file.name.replace('.pdf', ''),
        size: file.size,
        pageCount,
        supabasePath,
      });
    } catch (dbError) {
      console.error('❌ Database error:', dbError);
      return NextResponse.json({ error: 'Database save failed' }, { status: 500 });
    }

    console.log('✅ Book uploaded successfully:', { bookId, pageCount, supabasePath });

    return NextResponse.json({
      success: true,
      book: { 
        id: bookId, 
        filename, 
        title: file.name.replace('.pdf', ''), 
        size: file.size, 
        pageCount,
        supabasePath
      }
    });
  } catch (error: any) {
    console.error('❌ Book upload error:', error);
    return NextResponse.json({ 
      error: 'Upload failed', 
      message: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}