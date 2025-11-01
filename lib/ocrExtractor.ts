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
  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ];
  
  const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  
  // ✅ IMPROVED PROMPT: More explicit instructions for better extraction
  const prompt = `You are an expert OCR system. Extract ALL text from this image with MAXIMUM accuracy.

CRITICAL RULES:
1. Extract EVERY word visible in the image
2. Preserve original formatting (paragraphs, line breaks)
3. Maintain original language (Arabic/English/mixed)
4. For Arabic: Use correct direction (RTL) and proper diacritics
5. Keep numbers, dates, and references exactly as shown
6. DO NOT add explanations, summaries, or descriptions
7. DO NOT skip headers, footnotes, or page numbers
8. If text is unclear, make your best guess rather than skip it
9. Proper Nouns & Names: Extract with EXTREME precision (e.g., "جماعي" not "جمالي", "Jama'i" not "Jamali")
10. Technical Terms: Preserve exact spelling of Islamic, historical, and academic terms
11. Diacritics: Include ALL Arabic diacritics (َ ِ ُ ّ ْ) when visible
12. Hamza & Letters: Distinguish ء، ؤ، ئ، أ، إ، آ precisely
13. Double-check: Review proper nouns twice before finalizing
14. Numbers & Dates: Keep exactly as shown (both Arabic ٠١٢٣ and English 0123)

⚠️ COMMON ERRORS TO AVOID:
- Confusing ي/ى (ya/alef maksura)
- Mistakes with latinized Arabic terms (for example: Jama'i)
- Mixing ة/ه (ta marbuta/ha)
- Dropping hamza (ء)
- Changing proper noun spellings
- Skipping diacritics in technical terms
Return ONLY the extracted text with MAXIMUM fidelity to the original.

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
        console.log(`🔄 OCR attempt ${attempt}/${maxRetries} with ${modelName}...`);
        
        const model = genAI.getGenerativeModel({ 
          model: modelName, 
          safetySettings,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          }
        });
        
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        
        if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content) {
          const blockReason = response.promptFeedback?.blockReason || 'Unknown block reason';
          console.warn(`⚠️ ${modelName} was blocked: ${blockReason}. Trying next model...`);
          break;
        }

        const text = response.text().trim();
        
        if (text.length < 20) {
          console.warn(`⚠️ ${modelName} returned too little text (${text.length} chars), retrying...`);
          if (attempt < maxRetries) continue;
        }
        
        console.log(`✅ OCR success with ${modelName}: ${text.length} characters`);
        return text;
        
      } catch (error: any) {
        const errorMessage = error?.message || '';
        const isOverloaded = error?.status === 503 || errorMessage.includes('overloaded');
        const isRecitation = errorMessage.includes('RECITATION');
        const isQuota = error?.status === 429 || errorMessage.includes('quota');
        
        const isLastAttempt = attempt === maxRetries;
        const isLastModel = modelName === models[models.length - 1];

        if (isOverloaded && !isLastAttempt) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`⚠️ ${modelName} overloaded, retrying in ${delay/1000}s...`);
          await sleep(delay);
          continue;
        }

        if (isRecitation) {
          console.warn(`⚠️ ${modelName} blocked for RECITATION. Trying next model...`);
          break;
        }

        if (isQuota) {
          console.error(`❌ ${modelName} hit 429 Quota. Aborting page.`);
          throw error;
        }
        
        console.error(`❌ OCR error (${modelName}, attempt ${attempt}/${maxRetries}):`, error.message);

        if (isLastAttempt) {
          if (isLastModel) {
            throw new Error(`Failed to extract text. Last error: ${error.message}`);
          }
          console.warn(`⚠️ ${modelName} failed all attempts. Trying next model...`);
          break;
        }
      }
    }
  }
  
  throw new Error('Failed to extract text after all model and retry attempts');
}