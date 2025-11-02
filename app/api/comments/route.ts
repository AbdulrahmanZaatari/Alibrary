import { NextRequest, NextResponse } from 'next/server';
import { getDb, addComment, getComments, deleteComment } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bookId = searchParams.get('bookId');

  if (!bookId) {
    return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
  }

  try {
    const comments = getComments(bookId);
    return NextResponse.json(comments || []);
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { bookId, pageNumber, selectedText, comment } = await req.json();

    if (!bookId || !pageNumber || !comment) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = randomUUID();
    addComment({
      id,
      bookId,
      pageNumber,
      selectedText: selectedText || undefined,
      comment
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();

    deleteComment(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}