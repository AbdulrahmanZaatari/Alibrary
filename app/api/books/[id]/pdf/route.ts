import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getBookBuffer } from '@/lib/supabaseStorage';

// Server-side cache storing Buffer for NextResponse compatibility
const pdfCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    
    console.log('📥 PDF request for book ID:', bookId);

    // Check server cache
    const cached = pdfCache.get(bookId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('⚡ Serving from server cache');
      // Convert Buffer to Uint8Array for Blob compatibility
      const uint8Array = new Uint8Array(cached.buffer);
      const blob = new Blob([uint8Array], { type: 'application/pdf' });
      return new NextResponse(blob, {
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const db = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any;

    if (!book) {
      console.error('❌ Book not found:', bookId);
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    console.log('📂 Fetching from storage:', book.supabase_path);

    // getBookBuffer returns a Node Buffer
    const buffer = await getBookBuffer(bookId, book.supabase_path);

    // Cache in server memory as Buffer
    pdfCache.set(bookId, { buffer, timestamp: Date.now() });

    console.log('✅ PDF loaded successfully, size:', buffer.length);

    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: 'application/pdf' });

    return new NextResponse(blob, {
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