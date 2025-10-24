import { NextRequest, NextResponse } from 'next/server';
import { getBookById } from '@/lib/db';
import { getBookDownloadUrl } from '@/lib/supabaseStorage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('id');

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    const book: any = getBookById(bookId);
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const url = await getBookDownloadUrl(book.supabase_path);
    return NextResponse.json({ url });
  } catch (error) {
    console.error('Error getting download URL:', error);
    return NextResponse.json({ error: 'Failed to get URL' }, { status: 500 });
  }
}