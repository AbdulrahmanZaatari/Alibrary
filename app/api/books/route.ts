import { NextRequest, NextResponse } from 'next/server';
import { getBooks, deleteBook as deleteBookFromDb, getBookById } from '@/lib/db';
import { deleteBookFromSupabase } from '@/lib/supabaseStorage';

export async function GET() {
  try {
    const books = getBooks();
    return NextResponse.json({ books });
  } catch (error) {
    console.error('Error fetching books:', error);
    return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('id');

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    const book: any = getBookById(bookId);

    if (book?.supabase_path) {
      await deleteBookFromSupabase(book.supabase_path);
    }

    deleteBookFromDb(bookId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting book:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}