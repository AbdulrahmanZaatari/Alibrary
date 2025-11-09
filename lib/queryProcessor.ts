import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const FALLBACK_MODELS = [
  'gemini-2.0-flash', 
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-exp',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',  
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

  // Translate if languages don't match
  let translatedQuery: string | undefined;
  let searchQuery = query;

  if (queryLang !== documentLanguage && queryLang !== 'mixed') {
    console.log(`   🔄 Translating query to ${documentLanguage}...`);
    try {
      translatedQuery = await translateQuery(query, documentLanguage);
      searchQuery = translatedQuery;
      console.log(`   ✅ Translated: "${translatedQuery}"`);
    } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
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
  };
}