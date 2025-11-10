import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    console.log('📚 Fetching books from Supabase...');

    // Get all books from book_metadata table
    const { data: books, error } = await supabaseAdmin
      .from('book_metadata')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    console.log(`✅ Found ${books?.length || 0} books in Supabase`);

    // Transform to match expected format
    const formattedBooks = (books || []).map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      filename: book.filename,
      total_pages: book.total_pages,
      created_at: book.created_at,
      file_size: book.file_size
    }));

    return NextResponse.json({
      success: true,
      books: formattedBooks,
      count: formattedBooks.length
    });

  } catch (error: any) {
    console.error('❌ Error fetching books from Supabase:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch books',
        details: error.message
      },
      { status: 500 }
    );
  }
}