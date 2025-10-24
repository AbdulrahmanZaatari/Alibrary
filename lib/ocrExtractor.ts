import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const genAI = new GoogleGenerativeAI(apiKey);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function extractTextWithGeminiVision(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const maxRetries = 3;
  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',  // Try experimental first
  ];
  
  // Convert to Buffer if Uint8Array
  const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  
  const prompt = `Extract ALL text EXACTLY as it appears.
- Preserve formatting
- Keep original language (Arabic/English)
- Maintain RTL for Arabic text
- Return raw text only, no explanations

Text:`;

  const imagePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    },
  };

  for (const modelName of models) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} with ${modelName}...`);
        
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text().trim();
        
        console.log(`✅ Success with ${modelName}: ${text.length} characters`);
        return text;
        
      } catch (error: any) {
        const isOverloaded = error?.status === 503 || error?.message?.includes('overloaded');
        const isLastAttempt = attempt === maxRetries;
        const isLastModel = modelName === models[models.length - 1];
        
        if (isOverloaded && !isLastAttempt) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.log(`⚠️ ${modelName} overloaded, retrying in ${delay/1000}s...`);
          await sleep(delay);
          continue;
        }
        
        if (isOverloaded && isLastAttempt && !isLastModel) {
          console.log(`⚠️ ${modelName} failed, trying next model...`);
          break; // Try next model
        }
        
        console.error(`❌ Gemini Vision OCR error (${modelName}):`, error);
        
        if (isLastModel && isLastAttempt) {
          throw new Error('All Gemini models are currently overloaded. Please try again later.');
        }
      }
    }
  }
  
  throw new Error('Failed to extract text after all retry attempts');
}