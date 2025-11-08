import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { Buffer } from 'buffer'; // Required for Buffer type if not running in pure Node environment

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Define the model priority list for fallback
const FALLBACK_MODELS = [
    'gemini-2.0-flash', 
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-exp',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',  
];


export async function extractTextWithGeminiVision(imageBuffer: Buffer | Uint8Array): Promise<string> {
  // Use the maxRetries constant for clarity
  const MAX_RETRIES = 2; 
  
  const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  
  // ✅ SIMPLIFIED PROMPT: Matches Streamlit exactly
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
      mimeType: 'image/png', // Assumes PNG, adjust if other types are expected
    },
  };

  // --- Model Fallback Loop (Outer Loop) ---
  for (const model of FALLBACK_MODELS) {
    
    // --- Retry Loop (Inner Loop) ---
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
          // Continue to retry if text is insufficient
        }
      } catch (error) {
        const errorMessage = (error as Error).message.toLowerCase();
        
        // Check for Quota/Rate Limit Errors
        const isQuotaError = errorMessage.includes('quota') || 
                             errorMessage.includes('rate limit') ||
                             errorMessage.includes('resource exhausted');

        if (isQuotaError) {
            console.warn(`⚠️ Quota error on model ${model} (attempt ${attempt}): ${errorMessage}. Switching to next model...`);
            // Break the inner retry loop immediately to try the next model
            break; 
        }

        // Handle general retries (for non-quota errors like networking issues)
        console.error(`❌ OCR attempt ${attempt} failed for ${model}:`, errorMessage);
        
        if (attempt < MAX_RETRIES) {
          const delay = 2000 * attempt; 
          console.log(`⏳ Retrying current model ${model} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        // If maxRetries is reached, the inner loop finishes, and the outer loop moves to the next model.
      }
    }
  }

  console.error('❌ All models and all retry attempts failed.');
  return '';
}