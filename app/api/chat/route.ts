import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini'; // ✅ Changed from queryLLM

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  console.log('💬 /api/chat - General chat request received');
  
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { message, sessionId } = await request.json();

      if (!message || !sessionId) {
        console.error('❌ Missing message or sessionId');
        await writer.write(encoder.encode('Error: Missing message or session ID'));
        await writer.close();
        return;
      }

      console.log('📝 Message:', message);
      console.log('🔖 Session:', sessionId);

      // Build general conversation prompt
      const prompt = `You are a knowledgeable Islamic studies assistant. Answer the following question in a helpful, accurate, and respectful manner. If the question is in Arabic, respond in Arabic. If it's in English, respond in English.

User question: ${message}

Please provide a clear and informative answer.`;

      console.log('🤖 Querying Gemini for general chat...');

      // ✅ Use gemini.ts generateResponse
      const geminiStream = await generateResponse(prompt);

      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          await writer.write(encoder.encode(text));
        }
      }

      console.log('✅ General chat response complete');
      await writer.close();

    } catch (error) {
      console.error('❌ Error in /api/chat:', error);
      console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');
      
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await writer.write(encoder.encode(`Error: ${errorMessage}`));
        await writer.close();
      } catch (writeError) {
        console.error('Failed to write error:', writeError);
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}