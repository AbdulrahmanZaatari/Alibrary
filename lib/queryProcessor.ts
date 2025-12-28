import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const FALLBACK_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview'
];

interface QueryAnalysis {
  originalQuery: string;
  translatedQuery?: string;
  detectedLanguage: 'ar' | 'en' | 'mixed';
  expandedQuery: string;
  queryType: 'narrative' | 'analytical' | 'factual' | 'thematic' | 'comparative';
  keywords: string[];
  isMultiDocumentQuery: boolean;
  isFollowUp?: boolean;
  followUpConfidence?: number;
  needsNewRetrieval?: boolean;
  // ✅ NEW: Page-specific query analysis
  pageReference?: {
    pageNumber: number;
    isExact: boolean; // true if user wants exactly this page, false if "around page X"
    context: 'check' | 'search' | 'find' | 'read' | 'general';
  };
  // ✅ NEW: Page range filtering (from page X to Y)
  pageRangeFilter?: {
    start?: number;
    end?: number;
    chapter?: string;
  };
}

/**
 * ✅ Enhanced page reference detection with range support
 * Detects:
 * - Single pages: "page 6", "صفحة 6"
 * - Page ranges: "page 10 to 18", "from page 10 to 18", "pages 10-18"
 * - Arabic ranges: "من صفحة 10 إلى 18", "صفحات 10-18"
 */
export function detectPageReference(query: string): {
  pageNumber: number;
  endPageNumber?: number;  // ✅ NEW: For page ranges
  isRange: boolean;        // ✅ NEW: Indicates if this is a range
  isExact: boolean;
  context: 'check' | 'search' | 'find' | 'read' | 'general';
} | null {
  
  // ✅ NEW: Page RANGE patterns (check these first - they're more specific)
  const rangePatterns = [
    // English range patterns
    /(?:from\s*)?page[s]?\s*(\d+)\s*(?:to|through|until|-|–|—)\s*(?:page\s*)?(\d+)/i,
    /page[s]?\s*(\d+)\s*(?:to|through|until|-|–|—)\s*(\d+)/i,
    /(?:between\s*)?page[s]?\s*(\d+)\s*(?:and|&)\s*(?:page\s*)?(\d+)/i,
    /p\.?\s*(\d+)\s*(?:-|–|—|to)\s*(?:p\.?\s*)?(\d+)/i,
    // "it is from page X to Y" pattern
    /(?:is\s*)?(?:from\s*)?page\s*(\d+)\s*to\s*(\d+)/i,
    
    // Arabic range patterns
    /(?:من\s*)?صفحة\s*(\d+)\s*(?:إلى|الى|حتى|-|–)\s*(?:صفحة\s*)?(\d+)/i,
    /صفحات?\s*(\d+)\s*(?:إلى|الى|حتى|-|–|و)\s*(\d+)/i,
    /(?:بين\s*)?صفحة\s*(\d+)\s*و(?:صفحة\s*)?(\d+)/i,
    /ص\.?\s*(\d+)\s*(?:-|–|—|إلى)\s*(?:ص\.?\s*)?(\d+)/i,
  ];
  
  // Check range patterns first
  for (const pattern of rangePatterns) {
    const match = query.match(pattern);
    if (match && match[1] && match[2]) {
      const startPage = parseInt(match[1], 10);
      const endPage = parseInt(match[2], 10);
      if (startPage > 0 && endPage > 0 && startPage < 10000 && endPage < 10000 && startPage <= endPage) {
        console.log(`   📄 PAGE RANGE DETECTED: Pages ${startPage} to ${endPage}`);
        return {
          pageNumber: startPage,
          endPageNumber: endPage,
          isRange: true,
          isExact: true,
          context: 'general',
        };
      }
    }
  }
  
  // Patterns for exact single page references
  const exactPatterns = [
    // English patterns
    /(?:in|on|at|check|look\s*at|see|read|view)\s*page\s*(\d+)/i,
    /page\s*(\d+)/i,
    /p\.?\s*(\d+)/i,
    // Arabic patterns
    /(?:في|على|من|اقرأ|انظر|تحقق|راجع)\s*(?:صفحة|ص\.?)\s*(\d+)/i,
    /صفحة\s*(\d+)/i,
    /ص\.?\s*(\d+)/i,
    // Mixed patterns
    /صفحة\s*رقم\s*(\d+)/i,
    /الصفحة\s*(\d+)/i,
  ];

  // Patterns for approximate page references
  const approximatePatterns = [
    /(?:around|near|about|approximately)\s*page\s*(\d+)/i,
    /(?:حوالي|قرب|تقريباً)\s*صفحة\s*(\d+)/i,
  ];

  // Patterns that indicate checking/verifying content
  const checkPatterns = [
    /(?:check|verify|confirm|تحقق|تأكد)/i,
  ];

  // Patterns that indicate searching
  const searchPatterns = [
    /(?:search|find|look\s*for|ابحث|جد|أوجد)/i,
  ];

  // Patterns that indicate reading
  const readPatterns = [
    /(?:read|show|display|اقرأ|أظهر)/i,
  ];

  // Try approximate patterns first (they're more specific)
  for (const pattern of approximatePatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      const pageNum = parseInt(match[1], 10);
      if (pageNum > 0 && pageNum < 10000) {
        return {
          pageNumber: pageNum,
          isRange: false,
          isExact: false,
          context: 'general',
        };
      }
    }
  }

  // Try exact patterns
  for (const pattern of exactPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      const pageNum = parseInt(match[1], 10);
      if (pageNum > 0 && pageNum < 10000) {
        // Determine context
        let context: 'check' | 'search' | 'find' | 'read' | 'general' = 'general';
        if (checkPatterns.some(p => p.test(query))) {
          context = 'check';
        } else if (searchPatterns.some(p => p.test(query))) {
          context = 'search';
        } else if (readPatterns.some(p => p.test(query))) {
          context = 'read';
        }

        return {
          pageNumber: pageNum,
          isRange: false,
          isExact: true,
          context,
        };
      }
    }
  }

  return null;
}

/**
 * Detect language of text
 */
export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  const arabicRatio = arabicChars / totalChars;

  if (arabicRatio > 0.7) return 'ar';
  if (arabicRatio < 0.3) return 'en';
  return 'mixed';
}

/**
 * ✅ Clean and validate keywords for search
 */
function cleanKeywords(keywords: string[], lang: 'ar' | 'en'): string[] {
  console.log('   🧹 Cleaning keywords...');
  
  const cleaned = keywords
    .map(k => k.trim())
    .filter(k => {
      // Remove empty keywords
      if (!k || k.length < 2) {
        console.log(`   ⚠️ Skipping short keyword: "${k}"`);
        return false;
      }
      
      // Remove keywords with special characters at start
      if (/^[*:#\-،.!?؛]/.test(k)) {
        console.log(`   ⚠️ Skipping keyword with special char: "${k}"`);
        return false;
      }
      
      // For Arabic queries, skip English-only keywords
      if (lang === 'ar' && /^[a-zA-Z\s:،\-]+$/.test(k)) {
        console.log(`   ⚠️ Skipping English keyword in Arabic query: "${k}"`);
        return false;
      }
      
      return true;
    })
    // Extract actual words from complex patterns
    .map(k => {
      // Remove prefixes like "* مشتقات: " or "- تحليل:" and keep only the actual word
      if (lang === 'ar') {
        // Extract all Arabic words from the keyword
        const arabicWords = k.match(/[\u0600-\u06FF]+/g);
        if (arabicWords && arabicWords.length > 0) {
          // Return the longest Arabic word (likely the main keyword)
          return arabicWords.sort((a, b) => b.length - a.length)[0];
        }
      } else {
        // For English, remove special chars and punctuation
        return k.replace(/[*:#\-،.!?؛]/g, '').trim();
      }
      return k;
    })
    .filter(k => k.length >= 2) // Re-filter after extraction
    // Remove duplicates (case-insensitive for English, exact for Arabic)
    .filter((k, i, arr) => {
      if (lang === 'ar') {
        return arr.indexOf(k) === i; // Exact match for Arabic
      } else {
        return arr.findIndex(item => item.toLowerCase() === k.toLowerCase()) === i;
      }
    })
    .slice(0, 20); // Limit to 20 keywords max

  console.log(`   ✅ Cleaned keywords (${cleaned.length}):`, cleaned);
  
  return cleaned;
}

/**
 * ✅ Extract Arabic words directly from query as fallback
 */
function extractArabicKeywords(query: string): string[] {
  // Extract all Arabic words (3+ characters)
  const arabicWords = query.match(/[\u0600-\u06FF]{3,}/g) || [];
  
  // Remove duplicates and common stop words
  const stopWords = ['الذي', 'التي', 'هذا', 'هذه', 'ذلك', 'تلك', 'هنا', 'هناك', 'كان', 'يكون'];
  
  return arabicWords
    .filter(word => !stopWords.includes(word))
    .filter((word, i, arr) => arr.indexOf(word) === i)
    .slice(0, 10);
}

/**
 * ✅ Extract English words directly from query as fallback
 */
function extractEnglishKeywords(query: string): string[] {
  // Extract words 4+ characters, excluding common stop words
  const stopWords = ['this', 'that', 'these', 'those', 'what', 'where', 'when', 'which', 'there', 'their', 'about'];
  
  return query
    .toLowerCase()
    .match(/\b[a-z]{4,}\b/g)
    ?.filter(word => !stopWords.includes(word))
    .filter((word, i, arr) => arr.indexOf(word) === i)
    .slice(0, 10) || [];
}

/**
 * ✅ Translate query to target language using Gemini with fallback
 */
export async function translateQuery(
  query: string,
  targetLang: 'ar' | 'en'
): Promise<string> {
  const prompt = targetLang === 'ar'
    ? `Translate this question to Arabic, preserving meaning and nuance. Return ONLY the Arabic translation, no explanations:

${query}

Arabic translation:`
    : `Translate this question to English, preserving meaning and nuance. Return ONLY the English translation, no explanations:

${query}

English translation:`;

  let lastError: Error | null = null;

  // ✅ Try each fallback model
  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`   🔄 Trying translation with ${modelName}...`);
      
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const translation = result.response.text().trim();
      
      if (translation && translation.length > 0) {
        console.log(`   ✅ Translation successful with ${modelName}`);
        return translation;
      }
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`   ⚠️ Translation failed with ${modelName}:`, error instanceof Error ? error.message : 'Unknown error');
      
      // Continue to next model
      continue;
    }
  }

  // ✅ All models failed - return original query
  console.error('❌ All translation models failed, using original query');
  if (lastError) {
    console.error('Last error:', lastError.message);
  }
  
  return query;
}

/**
 * ✅ Classify query type for better retrieval strategy with fallback
 */
export async function classifyQuery(query: string): Promise<string> {
  const prompt = `Classify this question into ONE category:

Question: "${query}"

Categories:
- narrative: questions about characters, plot, events, story (who, what happens)
- analytical: questions about themes, symbolism, literary devices (why, how, analyze)
- factual: questions about specific facts, dates, places (when, where)
- thematic: questions about meaning, interpretation, lessons
- comparative: questions comparing or finding commonalities between documents

Return ONLY the category name:`;

  let lastError: Error | null = null;

  // ✅ Try each fallback model
  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const classification = result.response.text().trim().toLowerCase();
      
      if (classification && classification.length > 0) {
        return classification;
      }
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`   ⚠️ Classification failed with ${modelName}:`, error instanceof Error ? error.message : 'Unknown error');
      
      // Continue to next model
      continue;
    }
  }

  // ✅ All models failed - return default
  console.error('❌ All classification models failed, using default: thematic');
  if (lastError) {
    console.error('Last error:', lastError.message);
  }
  
  return 'thematic';
}

/**
 * ✅ Expand query with synonyms and related terms with fallback
 */
export async function expandQuery(query: string, lang: 'ar' | 'en'): Promise<string[]> {
  const prompt = lang === 'ar'
    ? `لهذا السؤال، استخرج الكلمات المفتاحية الأساسية (3-8 كلمات فقط).
أعطني فقط الكلمات العربية المهمة، بدون رموز أو ترقيم أو شرح.

السؤال: "${query}"

الكلمات المفتاحية (كلمات عربية فقط):`
    : `For this question, extract the core keywords (3-8 words only).
Give me only the important English words, no symbols, numbering, or explanations.

Question: "${query}"

Keywords (words only):`;

  let lastError: Error | null = null;

  // ✅ Try each fallback model
  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const rawKeywords = result.response
        .text()
        .split(/[,،\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

      if (rawKeywords.length > 0) {
        // Clean the keywords before returning
        const cleaned = cleanKeywords(rawKeywords, lang);
        
        if (cleaned.length > 0) {
          return cleaned;
        }
      }
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`   ⚠️ Keyword expansion failed with ${modelName}:`, error instanceof Error ? error.message : 'Unknown error');
      
      // Continue to next model
      continue;
    }
  }

  // ✅ All models failed - extract keywords directly from query
  console.error('❌ All keyword expansion models failed, using direct extraction');
  if (lastError) {
    console.error('Last error:', lastError.message);
  }
  
  // Fallback: extract keywords based on language
  if (lang === 'ar') {
    return extractArabicKeywords(query);
  } else {
    return extractEnglishKeywords(query);
  }
}

/**
 * ✅ Detect if query is comparative/multi-document
 */
function isComparativeQuery(query: string): boolean {
  const comparativePatterns = [
    /\b(common|similar|shared|both|difference|differ|compare|contrast|versus|vs)\b/i,
    /\b(between|across|among)\b.*\b(document|text|book|source)/i,
    /مشترك|تشابه|فرق|مقارنة|كلاهما|بين/,
  ];
  
  return comparativePatterns.some(pattern => pattern.test(query));
}

/**
 * ✅ Complete query analysis pipeline with full fallback support
 */
export async function analyzeQuery(
  query: string,
  documentLanguage: 'ar' | 'en'
): Promise<QueryAnalysis> {
  console.log('🔍 Analyzing query...');

  const queryLang = detectLanguage(query);
  console.log(`   Query language: ${queryLang}, Document language: ${documentLanguage}`);

  // ✅ NEW: Detect page references FIRST (including ranges)
  const pageReference = detectPageReference(query);
  if (pageReference) {
    if (pageReference.isRange && pageReference.endPageNumber) {
      console.log(`   📄 Page RANGE detected: Pages ${pageReference.pageNumber} to ${pageReference.endPageNumber}`);
    } else {
      console.log(`   📄 Page reference detected: Page ${pageReference.pageNumber} (${pageReference.isExact ? 'exact' : 'approximate'}, context: ${pageReference.context})`);
    }
  }

  // Translate if languages don't match
  let translatedQuery: string | undefined;
  let searchQuery = query;

  if (queryLang !== documentLanguage && queryLang !== 'mixed') {
    console.log(`   🔄 Translating query to ${documentLanguage}...`);
    try {
      translatedQuery = await translateQuery(query, documentLanguage);
      searchQuery = translatedQuery;
      console.log(`   ✅ Translated: "${translatedQuery}"`);
    } catch {
      console.error('   ❌ Translation failed, using original query');
      searchQuery = query;
    }
  }

  // ✅ Detect comparative nature FIRST
  const isComparative = isComparativeQuery(query);

  // Classify query type
  let queryType: string;
  try {
    queryType = await classifyQuery(query);
  } catch {
    console.error('   ❌ Classification failed, using default: thematic');
    queryType = 'thematic';
  }
  
  // ✅ Override with 'comparative' if detected
  if (isComparative && queryType !== 'comparative') {
    queryType = 'comparative';
  }
  
  console.log(`   📋 Query type: ${queryType}${isComparative ? ' (comparative detected)' : ''}`);

  // Expand query with keywords
  let keywords: string[];
  try {
    keywords = await expandQuery(searchQuery, documentLanguage);
    
    // ✅ Final validation: ensure we have valid keywords
    if (keywords.length === 0) {
      console.warn('   ⚠️ No keywords after expansion, extracting from query...');
      keywords = documentLanguage === 'ar' 
        ? extractArabicKeywords(searchQuery)
        : extractEnglishKeywords(searchQuery);
    }
    
    console.log(`   🔑 Keywords: ${keywords.join(', ')}`);
  } catch {
    console.error('   ❌ Keyword expansion failed, using direct extraction');
    keywords = documentLanguage === 'ar'
      ? extractArabicKeywords(searchQuery)
      : extractEnglishKeywords(searchQuery);
  }

  // Build expanded query for embedding
  const expandedQuery = `${searchQuery} ${keywords.join(' ')}`;

  return {
    originalQuery: query,
    translatedQuery,
    detectedLanguage: queryLang,
    expandedQuery,
    queryType: queryType as any,
    keywords,
    isMultiDocumentQuery: isComparative,
    // ✅ Follow-up fields will be populated by the chat routes
    isFollowUp: undefined,
    followUpConfidence: undefined,
    needsNewRetrieval: undefined,
    // ✅ NEW: Page reference
    pageReference: pageReference || undefined,
  };
}