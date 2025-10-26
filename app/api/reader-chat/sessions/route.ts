import { NextRequest, NextResponse } from 'next/server';
import { createReaderChatSession, getReaderChatSessions, getDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { bookId, bookTitle } = await request.json();

    if (!bookId || !bookTitle) {
      return NextResponse.json(
        { error: 'Book ID and title required' },
        { status: 400 }
      );
    }

    const sessionId = createReaderChatSession(bookId, bookTitle);
    
    return NextResponse.json({ sessionId, success: true });
  } catch (error) {
    console.error('Error creating reader session:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const bookId = request.nextUrl.searchParams.get('bookId');
    
    if (!bookId) {
      return NextResponse.json(
        { error: 'Book ID required' },
        { status: 400 }
      );
    }

    const sessions = getReaderChatSessions(bookId);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching reader sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // Delete session (messages will cascade delete due to FOREIGN KEY)
    const stmt = db.prepare('DELETE FROM chat_sessions WHERE id = ?');
    stmt.run(id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting reader session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}

// ✅ NEW: PATCH method for renaming sessions
export async function PATCH(request: NextRequest) {
  try {
    const { id, name } = await request.json();
    
    if (!id || !name) {
      return NextResponse.json(
        { error: 'Session ID and name required' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // Update session name
    const stmt = db.prepare('UPDATE chat_sessions SET name = ? WHERE id = ?');
    stmt.run(name, id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error renaming reader session:', error);
    return NextResponse.json(
      { error: 'Failed to rename session' },
      { status: 500 }
    );
  }
}