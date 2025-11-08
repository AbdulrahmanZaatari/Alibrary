import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { updateChatSessionTimestamp } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { 
      sessionId, 
      userMessage, 
      assistantMessage, 
      documentsUsed,
      mode 
    } = await request.json();

    if (!sessionId || !userMessage || !assistantMessage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // ✅ Check if messages already exist (prevent duplicates)
    const existingMessages = db.prepare(`
      SELECT id FROM chat_messages 
      WHERE session_id = ? 
      AND content IN (?, ?)
      AND created_at > datetime('now', '-10 seconds')
    `).all(sessionId, userMessage, assistantMessage);

    if (existingMessages.length > 0) {
      console.log('⏭️ Messages already saved, skipping duplicate');
      return NextResponse.json({ 
        success: true, 
        message: 'Messages already exist',
        skipped: true
      });
    }

    // Get document names if available
    let documentNames: string[] = [];
    if (documentsUsed && Array.isArray(documentsUsed) && documentsUsed.length > 0) {
      try {
        const placeholders = documentsUsed.map(() => '?').join(',');
        const docs = db.prepare(`
          SELECT display_name FROM documents WHERE id IN (${placeholders})
        `).all(...documentsUsed);
        
        documentNames = docs.map((doc: any) => doc.display_name);
      } catch (error) {
        console.error('Error fetching document names:', error);
      }
    }

    // ✅ Save user message FIRST with current timestamp
    const userMessageId = crypto.randomUUID();
    const userTimestamp = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, documents_used, document_names, mode, created_at
      )
      VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
    `).run(
      userMessageId,
      sessionId,
      userMessage,
      documentsUsed ? JSON.stringify(documentsUsed) : null,
      documentNames.length > 0 ? JSON.stringify(documentNames) : null,
      mode || 'general',
      userTimestamp
    );

    // ✅ Save assistant message 1 second LATER
    const assistantMessageId = crypto.randomUUID();
    const assistantTimestamp = new Date(Date.now() + 1000).toISOString();
    
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, documents_used, document_names, mode, created_at
      )
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
    `).run(
      assistantMessageId,
      sessionId,
      assistantMessage,
      documentsUsed ? JSON.stringify(documentsUsed) : null,
      documentNames.length > 0 ? JSON.stringify(documentNames) : null,
      mode || 'general',
      assistantTimestamp
    );

    // Update session timestamp
    updateChatSessionTimestamp(sessionId);

    console.log('✅ Messages saved in correct order (user → assistant)');

    return NextResponse.json({ 
      success: true,
      userMessageId,
      assistantMessageId,
      messageCount: 2
    });

  } catch (error) {
    console.error('❌ Error saving messages:', error);
    return NextResponse.json(
      { error: 'Failed to save messages' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

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
      ORDER BY created_at ASC, id ASC
    `).all(sessionId);

    return NextResponse.json(messages);
  } catch (error) {
    console.error('❌ Error fetching messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' }, 
      { status: 500 }
    );
  }
}