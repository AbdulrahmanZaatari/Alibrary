import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { Buffer } from 'buffer';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Gemma models for OCR (high RPD limits)
const OCR_MODELS = [
    'gemma-3-27b-it',      
    'gemma-3-12b-it',
    'gemini-2.5-flash-lite',        
    'gemini-2.5-flash',  
    'gemini-3-flash-preview'   
];

/**
 * Main OCR function using Gemma vision models
 */
export async function extractTextWithGeminiVision(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const MAX_RETRIES = 2; 
  
  const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  
  const prompt = `Extract ALL text EXACTLY as it appears.
- Preserve formatting
- Keep original language
- Maintain RTL for Arabic
- Return raw text only
- Do not return anything else, do not write anything else
Text:`;

  const imagePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    },
  };

  // --- Model Fallback Loop ---
  for (const model of OCR_MODELS) {
    
    // --- Retry Loop ---
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      
      try {
        console.log(`🔄 OCR attempt ${attempt}/${MAX_RETRIES} with model: ${model}...`);
        
        const geminiModel = genAI.getGenerativeModel({ 
          model, 
          safetySettings,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192, 
          },
        });

        const result = await geminiModel.generateContent([prompt, imagePart]);
        const text = result.response.text().trim();

        if (text && text.length > 20) {
          console.log(`✅ OCR success: ${text.length} characters extracted using ${model}`);
          return text;
        } else {
          console.warn(`⚠️ OCR returned insufficient text (${text.length} chars) using ${model}.`);
        }
      } catch (error) {
        const errorMessage = (error as Error).message.toLowerCase();
        
        const isQuotaError = errorMessage.includes('quota') || 
                             errorMessage.includes('rate limit') ||
                             errorMessage.includes('resource exhausted');

        if (isQuotaError) {
            console.warn(`⚠️ Quota error on model ${model} (attempt ${attempt}): ${errorMessage}. Switching to next model...`);
            break; 
        }

        console.error(`❌ OCR attempt ${attempt} failed for ${model}:`, errorMessage);
        
        if (attempt < MAX_RETRIES) {
          const delay = 2000 * attempt; 
          console.log(`⏳ Retrying current model ${model} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  console.error('❌ All models and all retry attempts failed.');
  return '';
}