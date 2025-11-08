import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// --- User-Requested Fallback Models ---
const FALLBACK_MODELS = [
  'gemini-2.0-flash', 
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-exp',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',   
];

/**
 * ✅ AI-powered Arabic text correction using Gemini with model fallback and retry logic.
 * This system attempts models in order to ensure high reliability.
 */
export async function correctArabicWithAI(text: string): Promise<string> {
  if (!text || text.length < 20) return text;
  
  let delay = 1000; // Initial delay of 1 second for exponential backoff

  const prompt = `أنت خبير في تصحيح النصوص العربية المستخرجة من ملفات PDF.

**المهمة:** صحّح الأخطاء التالية فقط:
1. إزالة المسافات الزائدة بين الأحرف (مثل: "الص لاة" → "الصلاة")
2. إصلاح الهمزات الخاطئة (مثل: "اإلمام" → "الإمام")
3. إصلاح "ال" التعريف (مثل: "ال أمر" → "الأمر")
4. إصلاح التنوين والتشكيل الخاطئ
5. إصلاح الأخطاء الإملائية الواضحة
6. إصلاح تقطيع الكلمات (مثل: "و أكملنا" → "وأكملنا")
7. إصلاح علامات الترقيم (مثل: "فضحكنا او" → "فضحكنا أو")

**قواعد مهمة جداً:**
- **لا تغيّر ة إلى ه ولا ى إلى ي** - احتفظ بالحرف الأصلي تماماً
- احتفظ بالمعنى الأصلي تمامًا
- لا تغير الأسلوب أو البنية
- لا تضف محتوى جديد
- احتفظ بعلامات الترقيم والفقرات
- أرجع النص المصحح فقط بدون شرح أو ملاحظات
- لا تضف علامات اقتباس أو تنسيق Markdown

**أمثلة:**
- ❌ خطأ: "المكتبة" → "المكتبه"
- ✅ صحيح: "المكتبة" → "المكتبة"
- ❌ خطأ: "على" → "علي"  
- ✅ صحيح: "على" → "على"
- ❌ خطأ: "موسى" → "موسي"
- ✅ صحيح: "موسى" → "موسى"

**النص الأصلي:**
${text}

**النص المصحح:**`;

  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`🤖 Attempting Arabic correction with model: ${modelName}`);

      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        }
      });

      const result = await model.generateContent(prompt);
      let correctedText = result.response.text().trim();
      
      // Remove any markdown formatting if AI adds it
      correctedText = correctedText.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
      correctedText = correctedText.replace(/^\*\*.*?\*\*:?\s*/gm, '');
      
      console.log(`✅ AI correction success with ${modelName}: ${text.length} → ${correctedText.length} chars`);
      return correctedText; // Return on successful correction

    } catch (error: any) {
      const errorMessage = error.message;
      const isQuotaError = errorMessage.includes('429') || 
                           errorMessage.includes('Rate limit exceeded') || 
                           errorMessage.includes('Quota');

      if (isQuotaError) {
        console.warn(`⏳ Model ${modelName} hit rate limit. Waiting ${delay / 1000}s and trying next model...`);
      } else {
        console.warn(`⚠️ Model ${modelName} failed. Error: ${errorMessage}. Trying next model after ${delay / 1000}s...`);
      }
      
      // Implement exponential backoff before trying the next model
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; 
      if (delay > 8000) delay = 8000;
    }
  }

  // If all models fail after all attempts
  console.error('❌ All AI models failed for Arabic correction. Returning original text.');
  return text;
}

/**
 * ✅ Fix common Arabic PDF extraction issues (REGEX-BASED - FALLBACK ONLY)
 */
export function cleanArabicPdfText(text: string): string {
  let cleaned = text;

  // 1. Fix spacing issues
  cleaned = cleaned.replace(/([؟!،.])([^\s\n])/g, '$1 $2');
  cleaned = cleaned.replace(/([^\s])([أإآا])/g, '$1 $2');
  
  // 2. Fix hamza issues
  cleaned = cleaned.replace(/األ/g, 'الأ');
  cleaned = cleaned.replace(/اؤ/g, 'أؤ');
  cleaned = cleaned.replace(/اإل/g, 'الإ');
  cleaned = cleaned.replace(/ائ/g, 'أئ');
  
  // 3. Fix tanween position
  cleaned = cleaned.replace(/([ٌٍَُِّْ])([ا-ي])/g, '$2$1');
  
  // 4. Fix common word corruptions
  const arabicWordFixes: [RegExp, string][] = [
    [/\bال([ـ-ي])/g, 'ال$1'],
    [/ال\s+([ا-ي])/g, 'ال$1'],
    [/صالة/g, 'صلاة'],
    [/الصالة/g, 'الصلاة'],
    [/الص الة/g, 'الصلاة'],
    [/صل اة/g, 'صلاة'],
    [/فال([ا-ي])/g, 'فلا$1'],
    [/\bفال\b/g, 'فلا'],
    [/\bف ال\b/g, 'فلا'],
    [/االبتعاد/g, 'الابتعاد'],
    [/ب االبتعاد/g, 'بالابتعاد'],
    [/التالوة/g, 'التلاوة'],
    [/التل اوة/g, 'التلاوة'],
    [/قبالت/g, 'قبلات'],
    [/قب الت/g, 'قبلات'],
    [/اإلمام/g, 'الإمام'],
    [/ال إم ام/g, 'الإمام'],
    [/إم امً/g, 'إمامًا'],
    [/إم ام/g, 'إمام'],
    [/اإلسالم/g, 'الإسلام'],
    [/ال إسل ام/g, 'الإسلام'],
    [/ا ألمر/g, 'الأمر'],
    [/هذ ا/g, 'هذا'],
    [/الشب اب/g, 'الشباب'],
    [/الن اس/g, 'الناس'],
    [/القر آن/g, 'القرآن'],
    [/و ال([ا-ي])/g, 'وال$1'],
    [/و أ/g, 'وأ'],
    [/و إ/g, 'وإ'],
  ];
  
  for (const [pattern, replacement] of arabicWordFixes) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  
  // 5. Fix excessive spacing
  cleaned = cleaned.replace(/([ا-ي])\s+([ا-ي])\s+([ا-ي])/g, '$1$2$3');
  cleaned = cleaned.replace(/([ا-ي])\s+([ا-ي])(?=\s|[؟!،.]|$)/g, '$1$2');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\n\s+/g, '\n');
  cleaned = cleaned.replace(/\s+\n/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 6. Fix line breaks in middle of words
  cleaned = cleaned.replace(/([ا-ي])\n([ا-ي])/g, '$1$2');
  
  return cleaned.trim();
}

/**
 * ✅ Detect if Arabic text has PDF corruption
 */
export function hasArabicCorruption(text: string): boolean {
  if (!text || text.length < 20) return false;
  
  const corruptionPatterns = [
    /[.،؟!][^\s\n]/,
    /األ/,
    /اإل/,
    /فال[ا-ي]/,
    /ف ال/,
    /صالة/,
    /الص الة/,
    /صل اة/,
    /\s{3,}/,
    /([ا-ي])\s+([ا-ي])\s+([ا-ي])/,
    /ا ألمر/,
    /اإلمام/,
    /ال إسل ام/,
    /ال إم ام/,
    /و ال([ا-ي])/,
  ];
  
  return corruptionPatterns.some(pattern => pattern.test(text));
}