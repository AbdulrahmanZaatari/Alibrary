import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const messages = db.prepare(`
      SELECT * FROM chat_messages 
      WHERE session_id = ? 
      ORDER BY created_at ASC
    `).all(sessionId);

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Error fetching reader messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { 
      sessionId, 
      userMessage, 
      assistantMessage, 
      bookId, 
      bookTitle, 
      bookPage,
      extractedText,
      documentsUsed,
      customPromptName
    } = await request.json();

    if (!sessionId || !userMessage || !assistantMessage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const db = getDb();
    const now = new Date().toISOString();
    
    let documentNames: string[] = [];
    if (documentsUsed && Array.isArray(documentsUsed) && documentsUsed.length > 0) {
      const placeholders = documentsUsed.map(() => '?').join(',');
      const docs = db.prepare(`
        SELECT display_name FROM documents WHERE id IN (${placeholders})
      `).all(...documentsUsed);
      
      documentNames = docs.map((doc: any) => doc.display_name);
    }

    const existingMessages = db.prepare(`
      SELECT id FROM chat_messages 
      WHERE session_id = ? 
        AND content IN (?, ?)
        AND created_at > datetime('now', '-5 seconds')
    `).all(sessionId, userMessage, assistantMessage);

    if (existingMessages.length > 0) {
      console.log('⚠️ Duplicate message detected, skipping save');
      return NextResponse.json({ success: true, skipped: true });
    }

    const userMsgId = randomUUID();
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, mode, 
        book_id, book_title, book_page, extracted_text,
        documents_used, document_names, custom_prompt_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userMsgId,
      sessionId,
      'user',
      userMessage,
      'reader',
      bookId || null,
      bookTitle || null,
      bookPage || null,
      extractedText || null,
      documentsUsed ? JSON.stringify(documentsUsed) : null, 
      documentNames.length > 0 ? JSON.stringify(documentNames) : null,
      customPromptName || null,
      now
    );

    const assistantMsgId = randomUUID();
    const assistantTime = new Date(Date.now() + 1000).toISOString(); 
    
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, mode, 
        book_id, book_title, book_page, extracted_text,
        documents_used, document_names, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assistantMsgId,
      sessionId,
      'assistant',
      assistantMessage,
      'reader',
      bookId || null,
      bookTitle || null,
      bookPage || null,
      extractedText || null,
      documentsUsed ? JSON.stringify(documentsUsed) : null,
      documentNames.length > 0 ? JSON.stringify(documentNames) : null,
      assistantTime 
    );

    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(assistantTime, sessionId);

    console.log(`✅ Saved user + assistant messages for session ${sessionId}`);
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error('❌ Error saving reader messages:', error);
    return NextResponse.json(
      { error: 'Failed to save messages' },
      { status: 500 }
    );
  }
}