import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT * FROM chat_sessions 
      ORDER BY updated_at DESC
    `).all();

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    const id = randomUUID();
    const now = new Date().toISOString();

    const db = getDb();
    db.prepare(`
      INSERT INTO chat_sessions (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, now, now);

    return NextResponse.json({ id, name, created_at: now, updated_at: now });
  } catch (error) {
    console.error('Error creating session:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    const db = getDb();
    
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}