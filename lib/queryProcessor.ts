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
    ? `لهذا السؤال، أعطني 3-5 كلمات مفتاحية أو مرادفات للبحث. فقط الكلمات، بدون شرح:

السؤال: "${query}"

الكلمات المفتاحية:`
    : `For this question, give me 3-5 keywords or synonyms for search. Just the words, no explanations:

Question: "${query}"

Keywords:`;

  let lastError: Error | null = null;

  // ✅ Try each fallback model
  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const keywords = result.response
        .text()
        .split(/[,،\n]/)
        .map(k => k.trim())
        .filter(k => k.length > 0);

      if (keywords.length > 0) {
        return keywords;
      }
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`   ⚠️ Keyword expansion failed with ${modelName}:`, error instanceof Error ? error.message : 'Unknown error');
      
      // Continue to next model
      continue;
    }
  }

  // ✅ All models failed - extract basic keywords from query
  console.error('❌ All keyword expansion models failed, using basic extraction');
  if (lastError) {
    console.error('Last error:', lastError.message);
  }
  
  // Fallback: simple keyword extraction
  const basicKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .slice(0, 5);
  
  return basicKeywords;
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
    console.log(`   🔑 Keywords: ${keywords.join(', ')}`);
  } catch (error) {
    console.error('   ❌ Keyword expansion failed, using basic extraction');
    keywords = searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 5);
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
  };
}