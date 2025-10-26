import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { message, sessionId } = await request.json();

      if (!message || !sessionId) {
        await writer.write(encoder.encode('Error: Missing message or sessionId'));
        await writer.close();
        return;
      }

      const db = getDb();
      // Fetch history from the 'messages' table for the main chat panel
      const history = db.prepare(`
        SELECT role, content 
        FROM chat_messages 
        WHERE session_id = ? 
        ORDER BY created_at ASC
      `).all(sessionId) as Array<{ role: string; content: string }>;

      let conversationContext = '';
      if (history.length > 0) {
        conversationContext = history
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n');
      }

      const prompt = conversationContext
        ? `You are a helpful and knowledgeable research assistant. Continue the conversation naturally.

**Previous conversation:**
${conversationContext}

**User:** ${message}
**Assistant:**`
        : `You are a helpful and knowledgeable research assistant.

**User:** ${message}
**Assistant:**`;

      const geminiStream = await generateResponse(prompt);
      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          await writer.write(encoder.encode(text));
        }
      }

      await writer.close();

    } catch (error) {
      console.error('❌ General chat error:', error);
      try {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await writer.write(encoder.encode(`Error: ${errorMsg}`));
        await writer.close();
      } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}