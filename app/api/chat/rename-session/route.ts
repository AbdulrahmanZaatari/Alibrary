import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, name } = await request.json();

    if (!sessionId || !name) {
      return NextResponse.json(
        { error: 'Session ID and name required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const stmt = db.prepare('UPDATE chat_sessions SET name = ?, updated_at = datetime("now") WHERE id = ?');
    stmt.run(name, sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error renaming session:', error);
    return NextResponse.json(
      { error: 'Failed to rename session' },
      { status: 500 }
    );
  }
}