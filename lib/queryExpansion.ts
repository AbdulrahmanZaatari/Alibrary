import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const EXPANSION_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

/**
 * ✅ Arabic Query Expansion with Synonyms and Related Terms
 * 
 * This module expands Arabic queries by:
 * 1. Adding synonyms (مرادفات)
 * 2. Adding related terms (مصطلحات مرتبطة)
 * 3. Handling variant spellings (تهجئة مختلفة)
 * 4. Expanding abbreviations
 */

export interface ExpandedQuery {
  originalQuery: string;
  expandedQuery: string;
  synonyms: string[];
  relatedTerms: string[];
  variants: string[];
  keywords: string[];
  confidence: number;
}

/**
 * ✅ Arabic Synonym Dictionary (commonly used terms)
 */
const ARABIC_SYNONYMS: Record<string, string[]> = {
  // Religious terms
  'الله': ['الرب', 'الإله', 'المولى', 'الخالق', 'ذو الجلال'],
  'النبي': ['الرسول', 'المصطفى', 'الحبيب', 'سيدنا محمد', 'محمد صلى الله عليه وسلم'],
  'القرآن': ['الكتاب', 'المصحف', 'الذكر', 'الفرقان', 'كلام الله'],
  'الصلاة': ['العبادة', 'الفريضة', 'الصلوات'],
  'الإيمان': ['التصديق', 'العقيدة', 'الاعتقاد'],
  'الكفر': ['الشرك', 'الجحود', 'الإلحاد'],
  'الجنة': ['الفردوس', 'دار السلام', 'النعيم'],
  'النار': ['جهنم', 'السعير', 'الجحيم'],
  'الحديث': ['السنة', 'الأثر', 'الخبر', 'الرواية'],
  'الفقه': ['الشريعة', 'الأحكام', 'التشريع'],
  
  // Actions
  'قال': ['ذكر', 'أخبر', 'روى', 'حدث', 'أفاد'],
  'كتب': ['ألف', 'صنف', 'دون', 'سطر'],
  'توفي': ['مات', 'انتقل', 'فارق الحياة', 'وافته المنية'],
  'ولد': ['نشأ', 'ظهر', 'خرج'],
  'تعلم': ['درس', 'طلب العلم', 'تفقه', 'تأدب'],
  'علم': ['عرف', 'أدرك', 'فهم', 'وعى'],
  
  // Descriptors
  'عظيم': ['كبير', 'جليل', 'عالي', 'رفيع'],
  'صالح': ['تقي', 'ورع', 'زاهد', 'عابد'],
  'عالم': ['فقيه', 'محدث', 'شيخ', 'إمام', 'عارف'],
  'صحابي': ['صاحب', 'من الصحابة', 'من أصحاب النبي'],
  
  // Time
  'قديم': ['عتيق', 'سالف', 'غابر'],
  'الآن': ['حالياً', 'في الوقت الحاضر', 'اليوم'],
  'دائماً': ['أبداً', 'على الدوام', 'باستمرار'],
  
  // Places
  'المدينة': ['يثرب', 'طيبة', 'المدينة المنورة'],
  'مكة': ['البلد الحرام', 'أم القرى', 'مكة المكرمة'],
};

/**
 * ✅ Arabic Related Concepts Dictionary
 */
const ARABIC_RELATED_CONCEPTS: Record<string, string[]> = {
  'الصلاة': ['الوضوء', 'الطهارة', 'القبلة', 'الركوع', 'السجود', 'التشهد'],
  'الزكاة': ['الصدقة', 'النصاب', 'الفقراء', 'المساكين'],
  'الحج': ['العمرة', 'الكعبة', 'عرفة', 'منى', 'الإحرام', 'الطواف', 'السعي'],
  'الصيام': ['رمضان', 'الإفطار', 'السحور', 'ليلة القدر'],
  'الجهاد': ['القتال', 'الغزوة', 'السرية', 'الفتح', 'النصر'],
  'الصحابة': ['المهاجرون', 'الأنصار', 'البدريون', 'أهل بيعة الرضوان'],
  'التابعون': ['السلف', 'العلماء', 'الأئمة'],
  'الخلافة': ['الإمامة', 'الخليفة', 'أمير المؤمنين', 'الحكم'],
  'العقيدة': ['التوحيد', 'الأسماء والصفات', 'الإيمان', 'الغيب'],
  'السيرة': ['حياة النبي', 'المغازي', 'الشمائل'],
};

/**
 * ✅ Arabic Variant Spellings (OCR and typing variations)
 */
const ARABIC_VARIANTS: Record<string, string[]> = {
  // Hamza variations
  'إسلام': ['اسلام', 'الإسلام', 'الاسلام'],
  'إيمان': ['ايمان', 'الإيمان', 'الايمان'],
  'أمر': ['امر'],
  'إلى': ['الى', 'الي'],
  
  // Ta marbuta vs Ha
  'صلاة': ['صلاه'],
  'زكاة': ['زكاه'],
  'حياة': ['حياه'],
  'قراءة': ['قراءه', 'قرائه'],
  
  // Ya vs Alef Maqsura
  'على': ['علي'],
  'موسى': ['موسي'],
  'عيسى': ['عيسي'],
  'مصطفى': ['مصطفي'],
  'هدى': ['هدي'],
  
  // Common names
  'محمد': ['محمّد', 'مُحَمَّد'],
  'عبدالله': ['عبد الله', 'عبدُ الله'],
  'عبدالرحمن': ['عبد الرحمن', 'عبدُ الرحمن'],
};

/**
 * ✅ Quick rule-based query expansion
 */
function expandQueryQuick(query: string): {
  synonyms: string[];
  relatedTerms: string[];
  variants: string[];
} {
  const synonyms: string[] = [];
  const relatedTerms: string[] = [];
  const variants: string[] = [];
  
  const words = query.split(/\s+/);
  
  for (const word of words) {
    // Check synonyms
    if (ARABIC_SYNONYMS[word]) {
      synonyms.push(...ARABIC_SYNONYMS[word].slice(0, 3));
    }
    
    // Check related concepts
    if (ARABIC_RELATED_CONCEPTS[word]) {
      relatedTerms.push(...ARABIC_RELATED_CONCEPTS[word].slice(0, 3));
    }
    
    // Check variants
    if (ARABIC_VARIANTS[word]) {
      variants.push(...ARABIC_VARIANTS[word]);
    }
    
    // Generate common variants
    // Ta marbuta to Ha and vice versa
    if (word.endsWith('ة')) {
      variants.push(word.slice(0, -1) + 'ه');
    } else if (word.endsWith('ه')) {
      variants.push(word.slice(0, -1) + 'ة');
    }
    
    // Ya to Alef Maqsura at end
    if (word.endsWith('ي')) {
      variants.push(word.slice(0, -1) + 'ى');
    } else if (word.endsWith('ى')) {
      variants.push(word.slice(0, -1) + 'ي');
    }
    
    // Remove/add Hamza
    if (word.startsWith('أ') || word.startsWith('إ') || word.startsWith('آ')) {
      variants.push('ا' + word.slice(1));
    } else if (word.startsWith('ا')) {
      variants.push('أ' + word.slice(1));
      variants.push('إ' + word.slice(1));
    }
  }
  
  return {
    synonyms: [...new Set(synonyms)],
    relatedTerms: [...new Set(relatedTerms)],
    variants: [...new Set(variants)]
  };
}

/**
 * ✅ AI-powered Arabic query expansion
 */
export async function expandArabicQuery(
  query: string,
  useAI: boolean = true
): Promise<ExpandedQuery> {
  console.log(`🔄 Expanding Arabic query: "${query.substring(0, 50)}..."`);
  
  // Start with rule-based expansion
  const quickExpansion = expandQueryQuick(query);
  
  if (!useAI || query.length < 10) {
    // Build expanded query from quick expansion
    const allTerms = [
      query,
      ...quickExpansion.synonyms.slice(0, 5),
      ...quickExpansion.variants.slice(0, 3)
    ];
    
    return {
      originalQuery: query,
      expandedQuery: allTerms.join(' '),
      synonyms: quickExpansion.synonyms,
      relatedTerms: quickExpansion.relatedTerms,
      variants: quickExpansion.variants,
      keywords: query.split(/\s+/).filter(w => w.length > 2),
      confidence: 0.6
    };
  }

  // AI-powered expansion for better results
  const prompt = `أنت خبير في اللغة العربية والبحث. وسّع الاستعلام التالي بإضافة مرادفات ومصطلحات مرتبطة.

**الاستعلام الأصلي:**
${query}

**المطلوب:**
1. أضف مرادفات للكلمات الرئيسية
2. أضف مصطلحات مرتبطة بالموضوع
3. أضف تهجئات بديلة شائعة
4. استخرج الكلمات المفتاحية

**أجب بتنسيق JSON:**
{
  "synonyms": ["مرادف1", "مرادف2"],
  "relatedTerms": ["مصطلح1", "مصطلح2"],
  "variants": ["بديل1", "بديل2"],
  "keywords": ["كلمة1", "كلمة2"],
  "expandedQuery": "الاستعلام الموسع مع المرادفات"
}

**JSON:**`;

  for (const modelName of EXPANSION_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { 
          temperature: 0.3,
          maxOutputTokens: 500
        }
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Merge AI results with rule-based results
        const mergedSynonyms = [...new Set([
          ...(parsed.synonyms || []),
          ...quickExpansion.synonyms
        ])].slice(0, 10);
        
        const mergedRelated = [...new Set([
          ...(parsed.relatedTerms || []),
          ...quickExpansion.relatedTerms
        ])].slice(0, 8);
        
        const mergedVariants = [...new Set([
          ...(parsed.variants || []),
          ...quickExpansion.variants
        ])].slice(0, 5);
        
        console.log(`✅ Query expanded with ${modelName}`);
        console.log(`   Synonyms: ${mergedSynonyms.length}`);
        console.log(`   Related: ${mergedRelated.length}`);
        console.log(`   Variants: ${mergedVariants.length}`);
        
        return {
          originalQuery: query,
          expandedQuery: parsed.expandedQuery || query,
          synonyms: mergedSynonyms,
          relatedTerms: mergedRelated,
          variants: mergedVariants,
          keywords: parsed.keywords || query.split(/\s+/).filter(w => w.length > 2),
          confidence: 0.85
        };
      }
    } catch {
      console.warn(`⚠️ Query expansion with ${modelName} failed`);
    }
  }

  // Fallback to rule-based
  const allTerms = [
    query,
    ...quickExpansion.synonyms.slice(0, 5),
    ...quickExpansion.variants.slice(0, 3)
  ];
  
  return {
    originalQuery: query,
    expandedQuery: allTerms.join(' '),
    synonyms: quickExpansion.synonyms,
    relatedTerms: quickExpansion.relatedTerms,
    variants: quickExpansion.variants,
    keywords: query.split(/\s+/).filter(w => w.length > 2),
    confidence: 0.6
  };
}

/**
 * ✅ Expand English query (simpler approach)
 */
export async function expandEnglishQuery(query: string): Promise<ExpandedQuery> {
  // For English, we do simpler expansion
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'who', 'when', 'where', 'why'].includes(w));
  
  return {
    originalQuery: query,
    expandedQuery: query,
    synonyms: [],
    relatedTerms: [],
    variants: [],
    keywords,
    confidence: 0.7
  };
}

/**
 * ✅ Main query expansion function
 */
export async function expandQuery(
  query: string,
  language: 'ar' | 'en',
  useAI: boolean = true
): Promise<ExpandedQuery> {
  if (language === 'ar') {
    return expandArabicQuery(query, useAI);
  } else {
    return expandEnglishQuery(query);
  }
}

/**
 * ✅ Build search query from expansion
 * Creates a query string optimized for vector search
 */
export function buildSearchQuery(expansion: ExpandedQuery): string {
  const parts = [
    expansion.originalQuery,
    ...expansion.synonyms.slice(0, 5),
    ...expansion.variants.slice(0, 3)
  ];
  
  return parts.join(' ');
}

/**
 * ✅ Build keyword list from expansion
 * For use with keyword-based search
 */
export function buildKeywordList(expansion: ExpandedQuery): string[] {
  const keywords = [
    ...expansion.keywords,
    ...expansion.synonyms.slice(0, 3),
    ...expansion.relatedTerms.slice(0, 3)
  ];
  
  return [...new Set(keywords)];
}
