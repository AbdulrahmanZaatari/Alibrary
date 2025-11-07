import { NextRequest, NextResponse } from 'next/server';
import { generateResponse } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const { firstMessage } = await request.json();

    if (!firstMessage) {
      return NextResponse.json(
        { error: 'First message required' },
        { status: 400 }
      );
    }

    const prompt = `Generate a short, descriptive title (max 5 words) for a chat that starts with this message: "${firstMessage}". Only return the title, nothing else.`;

    const { stream } = await generateResponse(prompt);
    let title = '';

    for await (const chunk of stream) {
      title += chunk.text();
    }

    // Clean up and limit length
    title = title.trim().replace(/['"]/g, '').substring(0, 50);

    return NextResponse.json({ name: title });
  } catch (error) {
    console.error('Error generating name:', error);
    return NextResponse.json(
      { error: 'Failed to generate name' },
      { status: 500 }
    );
  }
}