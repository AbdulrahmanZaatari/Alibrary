import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMMA_MODELS = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it'];

export async function POST(request: NextRequest) {
  try {
    const { prompt, model, images } = await request.json();

    if (!prompt && (!images || images.length === 0)) {
      return NextResponse.json(
        { error: 'Please provide a prompt or images' },
        { status: 400 }
      );
    }

    if (!GEMMA_MODELS.includes(model)) {
      return NextResponse.json(
        { error: `Invalid model. Choose from: ${GEMMA_MODELS.join(', ')}` },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const gemmaModel = genAI.getGenerativeModel({ model });

    console.log(`[Gemma Test] Using model: ${model}`);
    console.log(`[Gemma Test] Prompt: ${prompt?.substring(0, 100)}...`);
    console.log(`[Gemma Test] Images attached: ${images?.length || 0}`);

    let result;

    if (images && images.length > 0) {
      // Vision request with images
      const imageParts = images.map((base64: string) => ({
        inlineData: {
          data: base64,
          mimeType: 'image/jpeg', // Assume JPEG, could be detected
        },
      }));

      const parts = [
        ...imageParts,
        { text: prompt || 'Describe this image in detail.' },
      ];

      result = await gemmaModel.generateContent(parts);
    } else {
      // Text-only request
      result = await gemmaModel.generateContent(prompt);
    }

    const response = result.response;
    const text = response.text();

    console.log(`[Gemma Test] Response length: ${text.length} chars`);

    return NextResponse.json({
      response: text,
      model,
      promptTokens: prompt?.length || 0,
      responseTokens: text.length,
    });
  } catch (error) {
    console.error('[Gemma Test] Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check for specific error types
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return NextResponse.json({
        error: `Model not available. The selected model may not support this operation.`,
        details: errorMessage,
      }, { status: 400 });
    }

    if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
      return NextResponse.json({
        error: 'Rate limit or quota exceeded. Please try again later.',
        details: errorMessage,
      }, { status: 429 });
    }

    return NextResponse.json({
      error: 'Failed to generate response',
      details: errorMessage,
    }, { status: 500 });
  }
}
