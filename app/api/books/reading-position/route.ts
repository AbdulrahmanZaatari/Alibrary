import { NextRequest, NextResponse } from 'next/server';
import { updateBookReadingPosition } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { bookId, currentPage } = await request.json();

    if (!bookId || currentPage === undefined) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    updateBookReadingPosition(bookId, currentPage);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating reading position:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}