import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    
    console.log('📥 PDF request for book ID:', bookId);
    
    const db = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any;

    if (!book) {
      console.error('❌ Book not found:', bookId);
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    console.log('📂 Downloading from Supabase:', book.supabase_path);

    // ✅ FIX: Use correct bucket name 'reader-books'
    const { data, error } = await supabaseAdmin
      .storage
      .from('reader-books')  // ✅ CHANGED from 'books' to 'reader-books'
      .download(book.supabase_path);

    if (error || !data) {
      console.error('❌ Supabase download error:', error);
      return NextResponse.json({ error: 'Failed to download book' }, { status: 500 });
    }

    console.log('✅ PDF downloaded successfully, size:', data.size);

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${book.filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('❌ Error in PDF route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}