import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * ✅ Model priority for OCR correction - 27B first for highest quality
 * The 27B model is better at understanding Arabic orthographic nuances
 */
const OCR_CORRECTION_MODELS = [
  'gemma-3-27b-it',  // Best for Arabic orthographic correction
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
];

/**
 * ✅ Arabic character confusion patterns that OCR commonly makes
 */
const ARABIC_OCR_CONFUSION_PATTERNS = {
  // ي vs ى (ya vs alef maqsura) - most common confusion
  yaVsAlefMaqsura: {
    description: 'OCR confuses ي (ya) with ى (alef maqsura)',
    examples: ['على→علي', 'موسى→موسي', 'عيسى→عيسي', 'يحيى→يحيي'],
  },
  // أ vs ا (hamza on alef vs plain alef)
  hamzaOnAlef: {
    description: 'OCR drops hamza from أ making it ا',
    examples: ['أمر→امر', 'أنا→انا', 'أخ→اخ', 'إلى→الى'],
  },
  // ذ vs د (thal vs dal)
  thalVsDal: {
    description: 'OCR confuses ذ with د',
    examples: ['هذا→هدا', 'الذي→الدي', 'ذلك→دلك'],
  },
  // ة vs ه (ta marbuta vs ha)
  taMarbutaVsHa: {
    description: 'OCR confuses ة (ta marbuta) with ه (ha)',
    examples: ['المكتبة→المكتبه', 'الصلاة→الصلاه', 'القراءة→القراءه'],
  },
  // ئ vs ي (ya with hamza vs ya)
  yaWithHamza: {
    description: 'OCR drops hamza from ئ',
    examples: ['مائة→مايه', 'رئيس→ريس', 'فائز→فايز'],
  },
};

/**
 * ✅ Common Arabic words with their correct spellings
 * These words are frequently incorrectly OCR'd
 * KEY FIX: OCR outputs ه when it should be ة, and ي when it should be ى
 */
const ARABIC_COMMON_WORDS_CORRECTIONS: Record<string, string> = {
  // ===== Words ending with ه that should be ة (ta marbuta) =====
  'مكه': 'مكة',
  'المكرمه': 'المكرمة',
  'رساله': 'رسالة',
  'الرساله': 'الرسالة',
  'الجاهليه': 'الجاهلية',
  'بصمه': 'بصمة',
  'الدعوه': 'الدعوة',
  'الاعمده': 'الأعمدة',
  'جنه': 'جنة',
  'الجنه': 'الجنة',
  'قبيله': 'قبيلة',
  'بعثه': 'بعثة',
  'البعثه': 'البعثة',
  'عباده': 'عبادة',
  'الصلاه': 'الصلاة',
  'الزكاه': 'الزكاة',
  'الحياه': 'الحياة',
  'الاخره': 'الآخرة',
  'المعرفه': 'المعرفة',
  'الحكمه': 'الحكمة',
  'الرحمه': 'الرحمة',
  'النعمه': 'النعمة',
  'الامه': 'الأمة',
  'الملائكه': 'الملائكة',
  'الشهاده': 'الشهادة',
  'الكتابه': 'الكتابة',
  'القراءه': 'القراءة',
  'المكتبه': 'المكتبة',
  'السنه': 'السنة',
  'الشريعه': 'الشريعة',
  'العقيده': 'العقيدة',
  'الفريضه': 'الفريضة',
  'السيره': 'السيرة',
  'الهجره': 'الهجرة',
  'الغزوه': 'الغزوة',
  'المعركه': 'المعركة',
  'الخلافه': 'الخلافة',
  'الوصيه': 'الوصية',
  'الايه': 'الآية',
  'السوره': 'السورة',
  'الفاتحه': 'الفاتحة',
  'البقره': 'البقرة',
  'الماءده': 'المائدة',
  'التوبه': 'التوبة',
  'الكهف': 'الكهف',
  'الروميه': 'الرومية',
  'القصه': 'القصة',
  'الحقيقه': 'الحقيقة',
  'المدينه': 'المدينة',
  'المنوره': 'المنورة',
  'الطائفه': 'الطائفة',
  'الجماعه': 'الجماعة',
  'العائله': 'العائلة',
  'الاسره': 'الأسرة',
  'الزوجه': 'الزوجة',
  'البنت': 'البنت',
  'الابنه': 'الابنة',
  'السيده': 'السيدة',
  'الصحابه': 'الصحابة',
  'الخليفه': 'الخليفة',
  'الامانه': 'الأمانة',
  'الشجاعه': 'الشجاعة',
  'العداله': 'العدالة',
  'الحريه': 'الحرية',
  'الكرامه': 'الكرامة',
  'النبوه': 'النبوة',
  'الولايه': 'الولاية',
  'الامامه': 'الإمامة',
  'العصمه': 'العصمة',
  'الطهاره': 'الطهارة',
  'النجاسه': 'النجاسة',
  'الوضوء': 'الوضوء',
  'الغسل': 'الغسل',
  'التيمم': 'التيمم',
  
  // ===== Words ending with ي that should be ى (alef maqsura) =====
  'صلي': 'صلى',
  'دعي': 'دعى',
  'هدي': 'هدى',
  'الهدي': 'الهدى',
  'علي': 'على',
  'الي': 'إلى',
  'موسي': 'موسى',
  'عيسي': 'عيسى',
  'يحيي': 'يحيى',
  'متي': 'متى',
  'حتي': 'حتى',
  'شتي': 'شتى',
  'سوي': 'سوى',
  'لدي': 'لدى',
  'احدي': 'إحدى',
  'الاولي': 'الأولى',
  'الاخري': 'الأخرى',
  'الكبري': 'الكبرى',
  'الصغري': 'الصغرى',
  'القصوي': 'القصوى',
  'مستوي': 'مستوى',
  'محتوي': 'محتوى',
  'معني': 'معنى',
  'مبني': 'مبنى',
  'ملتقي': 'ملتقى',
  'منتهي': 'منتهى',
  'مصطفي': 'مصطفى',
  'مرتضي': 'مرتضى',
  'تقوي': 'تقوى',
  'فتوي': 'فتوى',
  'دعوي': 'دعوى',
  'شوري': 'شورى',
  'ذكري': 'ذكرى',
  'بشري': 'بشرى',
  'اسري': 'أسرى',
  'قتلي': 'قتلى',
  'جرحي': 'جرحى',
  'مرضي': 'مرضى',
  'هلكي': 'هلكى',
  'اعمي': 'أعمى',
  'ادني': 'أدنى',
  'اقصي': 'أقصى',
  'اعلي': 'أعلى',
  
  // ===== Words with missing hamza =====
  'الاسلام': 'الإسلام',
  'الايمان': 'الإيمان',
  'الامام': 'الإمام',
  'الانسان': 'الإنسان',
  'الاوثان': 'الأوثان',
  'اصحابه': 'أصحابه',
  'اصحاب': 'أصحاب',
  'الاصحاب': 'الأصحاب',
  'امر': 'أمر',
  'الامر': 'الأمر',
  'اخ': 'أخ',
  'اخت': 'أخت',
  'اب': 'أب',
  'ام': 'أم',
  'انا': 'أنا',
  'انت': 'أنت',
  'اهل': 'أهل',
  'الاهل': 'الأهل',
  'اول': 'أول',
  'الاول': 'الأول',
  'الاوايل': 'الأوائل',
  'الاوائل': 'الأوائل',
  'اوليك': 'أولئك',
  'اولئك': 'أولئك',
  'ابو': 'أبو',
  'ابي': 'أبي',
  'اخوال': 'أخوال',
  'الاخوال': 'الأخوال',
  'انشد': 'أنشد',
  'ارسلت': 'أرسلت',
  'اشهد': 'أشهد',
  'انه': 'أنه',
  'انها': 'أنها',
  'انهم': 'أنهم',
  'اسلم': 'أسلم',
  'اسلامه': 'إسلامه',
  'ايقن': 'أيقن',
  
  // ===== Common phrases =====
  'صلي الله عليه وسلم': 'صلى الله عليه وسلم',
  'رضي الله عنه': 'رضي الله عنه',
  'رضي الله عنها': 'رضي الله عنها',
  'رضي الله عنهم': 'رضي الله عنهم',
  
  // ===== More words from real OCR samples =====
  'واسلامه': 'وإسلامه',
  'عبده': 'عبدة',
  'اخفاء': 'إخفاء',
  'عميقه': 'عميقة',
  'بانهم': 'بأنهم',
  'بانه': 'بأنه',
  'بحمره': 'بحمرة',
  'يسمي': 'يسمى',
  'تحري': 'تحرى',
  'تحرز': 'تحرى',
  'دايما': 'دائمًا',
  'يساله': 'يسأله',
  'احوالها': 'أحوالها',
  'الاصنام': 'الأصنام',
  'الابيات': 'الأبيات',
  'امثال': 'أمثال',
  'طلحه': 'طلحة',
  'ليقرا': 'ليقرأ',
  'القران': 'القرآن',
  'والرساله': 'والرسالة',
  'اليها': 'إليها',
  'بشهاده': 'بشهادة',
  'اله': 'إله',
  'اصبحوا': 'أصبحوا',
};

/**
 * ✅ Quick rule-based correction for common patterns
 * This runs first before AI correction for speed
 * Enhanced to handle more OCR patterns
 */
export function quickArabicOcrFix(text: string): string {
  if (!text) return text;
  
  let corrected = text;
  
  // Step 1: Apply dictionary corrections (word-level)
  for (const [wrong, right] of Object.entries(ARABIC_COMMON_WORDS_CORRECTIONS)) {
    // Word boundary matching for Arabic
    const regex = new RegExp(`(^|\\s|[.،؛:!؟])${wrong}($|\\s|[.،؛:!؟])`, 'g');
    corrected = corrected.replace(regex, `$1${right}$2`);
  }
  
  // Step 2: Pattern-based corrections for common endings
  
  // Fix ه → ة at end of feminine words (common patterns)
  // Words ending in يه → ية (e.g., الجاهليه → الجاهلية)
  corrected = corrected.replace(/(\w)يه(\s|$|[.،؛:!؟])/g, '$1ية$2');
  
  // Words ending in وه → وة (e.g., الدعوه → الدعوة)  
  corrected = corrected.replace(/(\w)وه(\s|$|[.،؛:!؟])/g, '$1وة$2');
  
  // Words ending in اه → اة for common patterns (e.g., الصلاه → الصلاة)
  corrected = corrected.replace(/(صلا|حيا|زكا|قرا|كتاب)ه(\s|$|[.،؛:!؟])/g, '$1ة$2');
  
  // Words ending in مه → مة (e.g., بصمه → بصمة, الامه → الأمة)
  corrected = corrected.replace(/(\w)مه(\s|$|[.،؛:!؟])/g, '$1مة$2');
  
  // Step 3: Fix ي → ى at end of specific patterns
  
  // Words ending in لي → لى (e.g., علي → على, الي → إلى)
  corrected = corrected.replace(/\bعلي\b/g, 'على');
  corrected = corrected.replace(/\bالي\b/g, 'إلى');
  
  // Past tense verbs ending in ي → ى (e.g., صلي → صلى)
  corrected = corrected.replace(/\bصلي\b/g, 'صلى');
  corrected = corrected.replace(/\bدعي\b/g, 'دعى');
  corrected = corrected.replace(/\bهدي\b/g, 'هدى');
  corrected = corrected.replace(/\bسمي\b/g, 'سمى');
  corrected = corrected.replace(/\bمشي\b/g, 'مشى');
  corrected = corrected.replace(/\bجري\b/g, 'جرى');
  corrected = corrected.replace(/\bبني\b/g, 'بنى');
  
  // Step 4: Add missing hamza to common words starting with ا
  corrected = corrected.replace(/\bاسلام/g, 'إسلام');
  corrected = corrected.replace(/\bايمان/g, 'إيمان');
  corrected = corrected.replace(/\bامام/g, 'إمام');
  corrected = corrected.replace(/\bاوثان/g, 'أوثان');
  corrected = corrected.replace(/\bاصحاب/g, 'أصحاب');
  corrected = corrected.replace(/\bاعمد/g, 'أعمد');
  corrected = corrected.replace(/\bاوائل/g, 'أوائل');
  corrected = corrected.replace(/\bاوايل/g, 'أوائل');
  corrected = corrected.replace(/\bانسان/g, 'إنسان');
  
  return corrected;
}

/**
 * ✅ AI-powered comprehensive Arabic OCR correction
 * Uses the 27B model for best quality on Arabic orthographic issues
 */
export async function correctArabicOcrWithAI(text: string): Promise<{
  correctedText: string;
  corrections: string[];
  confidence: number;
  modelUsed: string;
}> {
  if (!text || text.length < 20) {
    return {
      correctedText: text,
      corrections: [],
      confidence: 1.0,
      modelUsed: 'none',
    };
  }

  // Step 1: Apply quick rule-based fixes first
  const quickFixed = quickArabicOcrFix(text);
  
  const prompt = `أنت خبير متخصص في تصحيح النصوص العربية المستخرجة بتقنية OCR.

**المشكلة:** نظام OCR يخطئ في الأحرف التالية ويجب تصحيحها:
- يكتب "ه" بدلاً من "ة" (التاء المربوطة)
- يكتب "ي" بدلاً من "ى" (الألف المقصورة)  
- يحذف الهمزات من أول الكلمات

**التصحيحات المطلوبة:**

1. **تصحيح ه → ة في نهاية الكلمات المؤنثة:**
   - مكه → مكة، رساله → رسالة، الجاهليه → الجاهلية
   - الدعوه → الدعوة، الصلاه → الصلاة، الحياه → الحياة
   - بصمه → بصمة، قبيله → قبيلة، الاخره → الآخرة
   - جنه → جنة، المدينه → المدينة، المنوره → المنورة

2. **تصحيح ي → ى في نهاية الكلمات:**
   - صلي → صلى، علي → على، الي → إلى
   - موسي → موسى، عيسي → عيسى، مصطفي → مصطفى
   - حتي → حتى، متي → متى، لدي → لدى، الهدي → الهدى
   - الاولي → الأولى، الكبري → الكبرى

3. **إضافة الهمزات المفقودة:**
   - الاسلام → الإسلام، الايمان → الإيمان
   - الاوثان → الأوثان، اصحابه → أصحابه
   - الاعمده → الأعمدة، اوليك → أولئك
   - ابو → أبو، انا → أنا، اهل → أهل

4. **تصحيح كلمات شائعة أخرى:**
   - الذي (صحيح)، التي (صحيح) - لا تغيرها
   - الاوايل → الأوائل

**قواعد:**
- أرجع النص المصحح فقط بدون أي شرح
- لا تضف علامات اقتباس أو markdown
- حافظ على التنسيق والفقرات
- لا تغير الكلمات التي لا تحتاج تصحيحاً
- إذا أحسست أن كلمة مفقودة حسب السياق أضفها، لا تترك شيء غير مفهوم

**النص للتصحيح:**
${quickFixed}

**النص المصحح:**`;

  let delay = 1000;
  
  for (const modelName of OCR_CORRECTION_MODELS) {
    try {
      console.log(`🤖 [OCR Correction] Attempting with ${modelName}...`);
      
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent corrections
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent(prompt);
      let correctedText = result.response.text().trim();
      
      // Clean up any markdown formatting the model might add
      correctedText = correctedText
        .replace(/^```[\s\S]*?\n/, '')
        .replace(/\n```$/, '')
        .replace(/^\*\*.*?\*\*:?\s*/gm, '');

      // Identify corrections made
      const corrections = identifyCorrections(quickFixed, correctedText);
      
      // Calculate confidence based on model and correction count
      const confidence = calculateCorrectionConfidence(modelName, corrections.length, text.length);
      
      console.log(`✅ [OCR Correction] Success with ${modelName}`);
      console.log(`   Corrections made: ${corrections.length}`);
      console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
      
      if (corrections.length > 0) {
        console.log(`   Sample corrections: ${corrections.slice(0, 3).join(', ')}`);
      }

      return {
        correctedText,
        corrections,
        confidence,
        modelUsed: modelName,
      };

    } catch (error: any) {
      const errorMessage = error.message || '';
      const isQuotaError = errorMessage.includes('429') ||
                          errorMessage.includes('Rate limit') ||
                          errorMessage.includes('Quota') ||
                          errorMessage.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError) {
        console.warn(`⏳ [OCR Correction] ${modelName} rate limited. Waiting ${delay}ms...`);
      } else {
        console.warn(`⚠️ [OCR Correction] ${modelName} failed: ${errorMessage}`);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }

  // All models failed - return quick-fixed text
  console.error('❌ [OCR Correction] All models failed. Using rule-based fixes only.');
  return {
    correctedText: quickFixed,
    corrections: [],
    confidence: 0.6,
    modelUsed: 'rule-based-only',
  };
}

/**
 * ✅ Identify what corrections were made between original and corrected text
 */
function identifyCorrections(original: string, corrected: string): string[] {
  const corrections: string[] = [];
  
  // Simple diff - find words that changed
  const originalWords = original.split(/\s+/);
  const correctedWords = corrected.split(/\s+/);
  
  const minLen = Math.min(originalWords.length, correctedWords.length);
  
  for (let i = 0; i < minLen; i++) {
    if (originalWords[i] !== correctedWords[i]) {
      corrections.push(`${originalWords[i]} → ${correctedWords[i]}`);
    }
  }
  
  return corrections.slice(0, 50); // Limit to prevent huge arrays
}

/**
 * ✅ Calculate confidence score based on model and corrections
 */
function calculateCorrectionConfidence(model: string, correctionCount: number, textLength: number): number {
  // Base confidence by model
  let confidence = model.includes('27b') ? 0.95
                 : model.includes('12b') ? 0.90
                 : model.includes('2.0-flash') ? 0.85
                 : 0.80;
  
  // Adjust based on correction density (too many corrections might indicate issues)
  const correctionDensity = correctionCount / (textLength / 100);
  
  if (correctionDensity > 5) {
    // Very high correction rate - might be over-correcting
    confidence *= 0.85;
  } else if (correctionDensity > 2) {
    // Moderate corrections - normal
    confidence *= 0.95;
  }
  // Low corrections - likely accurate
  
  return Math.min(confidence, 0.98);
}

/**
 * ✅ Check if text has common Arabic OCR issues
 * Enhanced to detect more patterns from real OCR output
 */
export function hasArabicOcrIssues(text: string): boolean {
  if (!text || text.length < 20) return false;
  
  // Patterns that indicate OCR confusion
  const ocrIssuePatterns = [
    // ===== ه instead of ة (ta marbuta) =====
    /\bمكه\b/, // Should be مكة
    /\bرساله\b/, // Should be رسالة
    /يه\s/, // Words ending in يه should be ية
    /وه\s/, // Words ending in وه should be وة
    /مه\s/, // Words ending in مه should be مة
    /\bالجاهليه\b/,
    /\bالدعوه\b/,
    /\bالصلاه\b/,
    /\bالحياه\b/,
    /\bجنه\b/,
    /\bالاخره\b/,
    /\bبصمه\b/,
    /\bقبيله\b/,
    /\bعباده\b/,
    
    // ===== ي instead of ى (alef maqsura) =====
    /\bصلي\b/, // Should be صلى
    /\bعلي\b(?!\s+بن)/, // Should be على (but not in names like علي بن)
    /\bالي\b/, // Should be إلى
    /\bموسي\b/, // Should be موسى
    /\bعيسي\b/, // Should be عيسى
    /\bمصطفي\b/, // Should be مصطفى
    /\bحتي\b/, // Should be حتى
    /\bمتي\b/, // Should be متى
    /\bالهدي\b/, // Should be الهدى
    /\bلدي\b/, // Should be لدى
    
    // ===== Missing hamza =====
    /\bالاسلام\b/, // Should be الإسلام
    /\bالايمان\b/, // Should be الإيمان
    /\bالاوثان\b/, // Should be الأوثان
    /\bاصحاب/, // Should be أصحاب
    /\bالاعمد/, // Should be الأعمد
    /\bاوليك\b/, // Should be أولئك
    /\bالاوايل\b/, // Should be الأوائل
    /\bالاوائل\b/, // Should be الأوائل
    /\bانفجر\b/, // Should be انفجر (this is correct actually - وصل)
    /\bاخفاء\b/, // Should be إخفاء
  ];
  
  return ocrIssuePatterns.some(pattern => pattern.test(text));
}

/**
 * ✅ Create normalized version of text for search matching
 * This doesn't change the stored text, just creates a searchable version
 */
export function normalizeArabicForSearch(text: string): string {
  if (!text) return text;
  
  return text
    // Normalize alef variants
    .replace(/[أإآ]/g, 'ا')
    // Normalize ya/alef maqsura (both become ya for search)
    .replace(/ى/g, 'ي')
    // Normalize ta marbuta to ha
    .replace(/ة/g, 'ه')
    // Remove tashkeel (diacritics)
    .replace(/[\u064B-\u0652\u0670]/g, '')
    // Normalize hamza forms
    .replace(/[ؤئء]/g, '')
    // Remove tatweel
    .replace(/ـ/g, '');
}

const arabicOcrCorrection = {
  correctArabicOcrWithAI,
  quickArabicOcrFix,
  hasArabicOcrIssues,
  normalizeArabicForSearch,
  ARABIC_OCR_CONFUSION_PATTERNS,
};

export default arabicOcrCorrection;
