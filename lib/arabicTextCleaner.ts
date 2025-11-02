import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * ✅ AI-powered Arabic text correction using Gemini
 * This matches the Gemini website behavior for perfect results
 */
export async function correctArabicWithAI(text: string): Promise<string> {
  if (!text || text.length < 20) return text;
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      }
    });

    const prompt = `أنت خبير في تصحيح النصوص العربية المستخرجة من ملفات PDF.

**المهمة:** صحّح الأخطاء التالية فقط:
1. إزالة المسافات الزائدة بين الأحرف (مثل: "الص لاة" → "الصلاة")
2. إصلاح الهمزات الخاطئة (مثل: "اإلمام" → "الإمام")
3. إصلاح "ال" التعريف (مثل: "ال أمر" → "الأمر")
4. إصلاح التنوين والتشكيل الخاطئ
5. إصلاح الأخطاء الإملائية الواضحة
6. إصلاح تقطيع الكلمات (مثل: "و أكملنا" → "وأكملنا")
7. إصلاح علامات الترقيم (مثل: "فضحكنا او" → "فضحكنا أو")

**قواعد مهمة:**
- احتفظ بالمعنى الأصلي تمامًا
- لا تغير الأسلوب أو البنية
- لا تضف محتوى جديد
- احتفظ بعلامات الترقيم والفقرات
- أرجع النص المصحح فقط بدون شرح أو ملاحظات
- لا تضف علامات اقتباس أو تنسيق Markdown

**النص الأصلي:**
${text}

**النص المصحح:**`;

    const result = await model.generateContent(prompt);
    let correctedText = result.response.text().trim();
    
    // ✅ Remove any markdown formatting if AI adds it
    correctedText = correctedText.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
    correctedText = correctedText.replace(/^\*\*.*?\*\*:?\s*/gm, '');
    
    console.log(`✅ AI correction complete: ${text.length} → ${correctedText.length} chars`);
    
    return correctedText;
  } catch (error) {
    console.error('❌ AI correction failed:', error);
    return text; // Fallback to original if AI fails
  }
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