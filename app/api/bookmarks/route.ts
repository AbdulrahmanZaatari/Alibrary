import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    const db = getDb();
    const bookmarks = db.prepare(`
      SELECT * FROM bookmarks 
      WHERE book_id = ? 
      ORDER BY page_number ASC
    `).all(bookId);

    // ✅ Always return array (even if empty)
    return NextResponse.json(bookmarks || []);
  } catch (error) {
    console.error('Error fetching bookmarks:', error);
    // ✅ Return empty array on error instead of error object
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { bookId, pageNumber, note } = await request.json();

    if (!bookId || !pageNumber) {
      return NextResponse.json(
        { error: 'Book ID and page number required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO bookmarks (id, book_id, page_number, note, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(id, bookId, pageNumber, note || '');

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error creating bookmark:', error);
    return NextResponse.json(
      { error: 'Failed to create bookmark' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Bookmark ID required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting bookmark:', error);
    return NextResponse.json(
      { error: 'Failed to delete bookmark' },
      { status: 500 }
    );
  }
}