import { NextRequest, NextResponse } from 'next/server';
import { generateResponse } from '@/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { message, pageText, pageNumber, bookTitle } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Build context-aware prompt
    let systemPrompt = `You are a helpful AI assistant specialized in Islamic studies and research.

**Guidelines:**
- Provide accurate, well-researched answers
- Use clear, accessible language
- Be respectful of Islamic knowledge and traditions
- If you don't know something, admit it honestly
- Format your responses in Markdown for readability
`;

    // Add page context if available
    if (pageText) {
      systemPrompt += `\n**Current Page Context:**\n`;
      if (bookTitle) {
        systemPrompt += `Book: ${bookTitle}\n`;
      }
      if (pageNumber) {
        systemPrompt += `Page: ${pageNumber}\n`;
      }
      systemPrompt += `\nText from current page:\n"""\n${pageText}\n"""\n\n`;
      systemPrompt += `Use the above text to provide more specific answers when relevant.\n`;
    }

    const fullPrompt = `${systemPrompt}\n**User Question:**\n${message}\n\n**Your Answer:**`;

    console.log('🤖 Kindle Chat - Calling Gemini...');

    // Get streaming response from Gemini
    const geminiResult = await generateResponse(fullPrompt, 'gemini-2.5-flash');
    const geminiStream = geminiResult.stream;

    console.log(`✅ Using model: ${geminiResult.modelUsed}`);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (error) {
          console.error('❌ Streaming error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('❌ Kindle chat error:', error);

    // Handle quota errors
    if (error.message && error.message.includes('quota')) {
      return new Response(
        '⚠️ AI service quota exceeded. Please try again later.',
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to process request', details: error.message },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'kindle-chat',
    timestamp: new Date().toISOString()
  });
}