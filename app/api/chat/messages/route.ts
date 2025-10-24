import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const db = getDb();
    const messages = db.prepare(`
      SELECT * FROM chat_messages 
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId);

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, userMessage, assistantMessage, documentsUsed, mode } = await request.json();
    const db = getDb();
    const now = new Date().toISOString();

    const userMsgId = randomUUID();
    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, documents_used, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userMsgId, sessionId, 'user', userMessage, null, mode || 'general', now);

    const assistantMsgId = randomUUID();
    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, documents_used, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      assistantMsgId, 
      sessionId, 
      'assistant', 
      assistantMessage, 
      documentsUsed ? JSON.stringify(documentsUsed) : null, 
      mode || 'general', 
      now
    );

    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving messages:', error);
    return NextResponse.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}