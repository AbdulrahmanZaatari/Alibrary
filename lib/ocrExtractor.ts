import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];


export async function extractTextWithGeminiVision(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const maxRetries = 2;
  const model = 'gemini-2.0-flash'; 
  
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
      mimeType: 'image/png',
    },
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 OCR attempt ${attempt}/${maxRetries} with ${model}...`);
      
      const geminiModel = genAI.getGenerativeModel({ 
        model, 
        safetySettings,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192, // ✅ Increased for longer pages
        },
      });

      const result = await geminiModel.generateContent([prompt, imagePart]);
      const text = result.response.text().trim();

      if (text && text.length > 20) {
        console.log(`✅ OCR success: ${text.length} characters extracted`);
        return text;
      } else {
        console.warn(`⚠️ OCR returned insufficient text (${text.length} chars)`);
      }
    } catch (error) {
      console.error(`❌ OCR attempt ${attempt} failed:`, (error as Error).message);
      
      if (attempt < maxRetries) {
        const delay = 2000 * attempt; // Longer delay between retries
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error('❌ All OCR attempts failed');
  return '';
}