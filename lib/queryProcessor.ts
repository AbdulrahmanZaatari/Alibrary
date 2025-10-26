import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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
 * Translate query to target language using Gemini
 */
export async function translateQuery(
  query: string,
  targetLang: 'ar' | 'en'
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const prompt = targetLang === 'ar'
    ? `Translate this question to Arabic, preserving meaning and nuance. Return ONLY the Arabic translation, no explanations:

${query}

Arabic translation:`
    : `Translate this question to English, preserving meaning and nuance. Return ONLY the English translation, no explanations:

${query}

English translation:`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Classify query type for better retrieval strategy
 */
export async function classifyQuery(query: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const prompt = `Classify this question into ONE category:

Question: "${query}"

Categories:
- narrative: questions about characters, plot, events, story (who, what happens)
- analytical: questions about themes, symbolism, literary devices (why, how, analyze)
- factual: questions about specific facts, dates, places (when, where)
- thematic: questions about meaning, interpretation, lessons
- comparative: questions comparing or finding commonalities between documents

Return ONLY the category name:`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim().toLowerCase();
}

/**
 * Expand query with synonyms and related terms
 */
export async function expandQuery(query: string, lang: 'ar' | 'en'): Promise<string[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const prompt = lang === 'ar'
    ? `لهذا السؤال، أعطني 3-5 كلمات مفتاحية أو مرادفات للبحث. فقط الكلمات، بدون شرح:

السؤال: "${query}"

الكلمات المفتاحية:`
    : `For this question, give me 3-5 keywords or synonyms for search. Just the words, no explanations:

Question: "${query}"

Keywords:`;

  const result = await model.generateContent(prompt);
  const keywords = result.response
    .text()
    .split(/[,،\n]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);

  return keywords;
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
 * Complete query analysis pipeline
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
    translatedQuery = await translateQuery(query, documentLanguage);
    searchQuery = translatedQuery;
    console.log(`   ✅ Translated: "${translatedQuery}"`);
  }

  // ✅ Detect comparative nature FIRST
  const isComparative = isComparativeQuery(query);

  // Classify query type
  let queryType = await classifyQuery(query) as any;
  
  // ✅ Override with 'comparative' if detected
  if (isComparative && queryType !== 'comparative') {
    queryType = 'comparative';
  }
  
  console.log(`   📋 Query type: ${queryType}${isComparative ? ' (comparative detected)' : ''}`);

  // Expand query with keywords
  const keywords = await expandQuery(searchQuery, documentLanguage);
  console.log(`   🔑 Keywords: ${keywords.join(', ')}`);

  // Build expanded query for embedding
  const expandedQuery = `${searchQuery} ${keywords.join(' ')}`;

  return {
    originalQuery: query,
    translatedQuery,
    detectedLanguage: queryLang,
    expandedQuery,
    queryType,
    keywords,
    isMultiDocumentQuery: isComparative,
  };
}