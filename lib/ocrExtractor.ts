import { 
  GoogleGenerativeAI, 
  HarmCategory, 
  HarmBlockThreshold 
} from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const genAI = new GoogleGenerativeAI(apiKey);

// ✅ ADD: Safety settings to disable recitation and other blocks
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function extractTextWithGeminiVision(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const maxRetries = 3;
  // Your requested model list
  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ];
  
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
        
        // ✅ ADD: Pass safetySettings to the model
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        
        // Handle cases where the response might be blocked *despite* settings
        if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content) {
          const blockReason = response.promptFeedback?.blockReason || 'Unknown block reason';
          console.warn(`⚠️ ${modelName} was blocked: ${blockReason}. Trying next model...`);
          break; // Break from retry loop, try next model
        }

        const text = response.text().trim();
        
        console.log(`✅ Success with ${modelName}: ${text.length} characters`);
        return text;
        
      } catch (error: any) {
        const errorMessage = error?.message || '';
        const isOverloaded = error?.status === 503 || errorMessage.includes('overloaded');
        const isRecitation = errorMessage.includes('RECITATION');
        const isQuota = error?.status === 429 || errorMessage.includes('quota');
        
        const isLastAttempt = attempt === maxRetries;
        const isLastModel = modelName === models[models.length - 1];

        // Case 1: Overloaded. Wait and retry this model.
        if (isOverloaded && !isLastAttempt) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`⚠️ ${modelName} overloaded, retrying in ${delay/1000}s...`);
          await sleep(delay);
          continue; // Retry this loop
        }

        // Case 2: Recitation block. Don't retry this model, just try the next one.
        if (isRecitation) {
          console.warn(`⚠️ ${modelName} blocked for RECITATION. Trying next model...`);
          break; // Break from retry loop, go to next model
        }

        // Case 3: Quota error. This shouldn't happen, but if it does, fail fast.
        if (isQuota) {
           console.error(`❌ ${modelName} hit 429 Quota. This should be handled by the caller (embedder.ts). Aborting page.`);
           throw error; // Re-throw to be caught by processPage
        }
        
        // Case 4: Any other error (or last attempt failed)
        console.error(`❌ Gemini Vision OCR error (${modelName}, attempt ${attempt}/${maxRetries}):`, error.message);

        if (isLastAttempt) {
          if (isLastModel) {
            // All models and retries failed
            throw new Error(`Failed to extract text. Last error: ${error.message}`);
          }
          console.warn(`⚠️ ${modelName} failed all attempts. Trying next model...`);
          break; // Break from retry loop, go to next model
        }
      }
    }
  }
  
  throw new Error('Failed to extract text after all model and retry attempts');
}