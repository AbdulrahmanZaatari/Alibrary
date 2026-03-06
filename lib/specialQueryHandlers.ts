/**
 * Special Query Handlers
 * 
 * Detects and handles special query patterns:
 * 1. Word Analysis: "حلّل إستخدام كلمة X" - Analyze word usage in book (AI response)
 * 2. Word List: "اذكر استخدامات كلمة X" - List word occurrences (CSV only)
 * 3. De-Jargon: "Define X in context of Page Y" - Find definitions before page
 * 4. Glossary: "Generate glossary for pages X-Y" - Create glossary for range
 * 5. Term Follow-up: Questions about previously analyzed terminology
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface SpecialQueryResult {
  type: 'word-analysis' | 'word-list' | 'de-jargon' | 'glossary' | 'term-followup' | 'none';
  detected: boolean;
  params: {
    word?: string;
    term?: string;
    pageNumber?: number;
    pageStart?: number;
    pageEnd?: number;
  };
  context?: string;
  chunks?: any[];
  totalOccurrences?: number;
  pagesFound?: number[];
}

/**
 * Detect if query is a word ANALYSIS request (needs AI response)
 * Patterns: "حلّل استخدام كلمة X", "analyze usage of word X", "كيف يستخدم المؤلف كلمة X"
 */
export function detectWordAnalysisQuery(query: string): { detected: boolean; word?: string; isListOnly: boolean } {
  // List-only verbs (show CSV without AI analysis)
  const listVerbs = [
    /(?:اذكر|أذكر|ذكر)\s*(?:لي\s*)?(?:كل\s*)?(?:إ|ا)?ستخدام(?:ات)?\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /(?:اعرض|أعرض|عرض)\s*(?:لي\s*)?(?:كل\s*)?(?:إ|ا)?ستخدام(?:ات)?\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /(?:أين|اين)\s*(?:تظهر|وردت|ذكرت)\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /(?:list|show|display)\s*(?:all\s*)?(?:occurrences?|usages?|instances?)\s*(?:of\s*)?(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?/i,
    /(?:where|find)\s*(?:does\s*)?(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?\s*(?:appear|occur)/i,
  ];
  
  // Analysis verbs (needs AI response)
  const analysisPatterns = [
    /حل[لّ]\s*(?:لي\s*)?(?:إ|ا)?ستخدام(?:ات)?\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /كيف\s*(?:ي|ت)?ستخدم\s*(?:المؤلف|الكاتب|الكتاب)?\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /ما\s*(?:هو\s*)?معنى\s*كلمة\s*[«"']?([^»"'\s]+)[»"']?\s*(?:في|عند|لدى)\s*(?:المؤلف|الكتاب)/i,
    /تحليل\s*(?:كلمة|مصطلح|مفهوم)\s*[«"']?([^»"'\s]+)[»"']?/i,
    /(?:إ|ا)?شرح\s*(?:لي\s*)?(?:كيف\s*)?(?:ي|ت)?ستخدم\s*(?:المؤلف\s*)?كلمة\s*[«"']?([^»"'\s]+)[»"']?/i,
    /analyze\s*(?:the\s*)?usage\s*(?:of\s*)?(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?/i,
    /how\s*does\s*(?:the\s*)?(?:author|book)\s*use\s*(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?/i,
    /what\s*does\s*(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?\s*mean\s*(?:in\s*)?(?:this\s*)?(?:book|context)/i,
    /explain\s*(?:the\s*)?usage\s*(?:of\s*)?(?:the\s*)?(?:word|term)\s*[«"']?([^»"'\s]+)[»"']?/i,
  ];
  
  // First check for list-only verbs
  for (const pattern of listVerbs) {
    const match = query.match(pattern);
    if (match && match[1]) {
      return { detected: true, word: match[1].trim(), isListOnly: true };
    }
  }
  
  // Then check for analysis verbs
  for (const pattern of analysisPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      return { detected: true, word: match[1].trim(), isListOnly: false };
    }
  }
  
  return { detected: false, isListOnly: false };
}

/**
 * Detect if query is a de-jargon request
 * Patterns: "Define X in context of page Y", "ما معنى X في صفحة Y"
 */
export function detectDeJargonQuery(query: string): { detected: boolean; term?: string; pageNumber?: number } {
  // English patterns
  const englishPatterns = [
    /(?:define|what\s*(?:is|does))\s*[«"']?([^»"'\s]+)[»"']?\s*(?:in\s*)?(?:the\s*)?context\s*(?:of\s*)?(?:page\s*)?(\d+)/i,
    /what\s*does\s*[«"']?([^»"'\s]+)[»"']?\s*mean\s*(?:on|at|in)?\s*page\s*(\d+)/i,
    /explain\s*[«"']?([^»"'\s]+)[»"']?\s*(?:as\s*used\s*)?(?:on|at|in)?\s*page\s*(\d+)/i,
  ];
  
  // Arabic patterns
  const arabicPatterns = [
    /ما\s*(?:هو\s*)?معنى\s*[«"']?([^»"'\s]+)[»"']?\s*(?:في|عند|ب)?\s*صفحة\s*(\d+)/i,
    /(?:إ|ا)?شرح\s*(?:لي\s*)?[«"']?([^»"'\s]+)[»"']?\s*(?:في|عند|ب)?\s*صفحة\s*(\d+)/i,
    /ماذا\s*يقصد\s*(?:ب|بـ)?\s*[«"']?([^»"'\s]+)[»"']?\s*(?:في|عند|ب)?\s*صفحة\s*(\d+)/i,
  ];
  
  for (const pattern of [...englishPatterns, ...arabicPatterns]) {
    const match = query.match(pattern);
    if (match && match[1] && match[2]) {
      return { 
        detected: true, 
        term: match[1].trim(),
        pageNumber: parseInt(match[2])
      };
    }
  }
  
  return { detected: false };
}

/**
 * Detect if query is a glossary request
 * Patterns: "Generate glossary for pages X-Y", "قائمة مصطلحات للصفحات X إلى Y"
 */
export function detectGlossaryQuery(query: string): { detected: boolean; pageStart?: number; pageEnd?: number } {
  // English patterns
  const englishPatterns = [
    /(?:generate|create|make)\s*(?:a\s*)?glossary\s*(?:for|of)?\s*pages?\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i,
    /glossary\s*(?:for|of)?\s*pages?\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i,
    /(?:list|extract)\s*(?:key\s*)?terms?\s*(?:from\s*)?pages?\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i,
  ];
  
  // Arabic patterns
  const arabicPatterns = [
    /(?:أنشئ|إنشاء|اصنع)\s*(?:قائمة\s*)?(?:مصطلحات|قاموس)\s*(?:ل|من)?\s*(?:صفحات?|ص)\s*(\d+)\s*(?:إلى|حتى|-|–)\s*(\d+)/i,
    /قائمة\s*(?:ب)?(?:ال)?مصطلحات\s*(?:ل|من)?\s*(?:صفحات?|ص)\s*(\d+)\s*(?:إلى|حتى|-|–)\s*(\d+)/i,
    /(?:ال)?مصطلحات\s*(?:في|من)?\s*(?:صفحات?|ص)\s*(\d+)\s*(?:إلى|حتى|-|–)\s*(\d+)/i,
  ];
  
  for (const pattern of [...englishPatterns, ...arabicPatterns]) {
    const match = query.match(pattern);
    if (match && match[1] && match[2]) {
      return { 
        detected: true, 
        pageStart: parseInt(match[1]),
        pageEnd: parseInt(match[2])
      };
    }
  }
  
  return { detected: false };
}

/**
 * Search for all occurrences of a word in the book (not semantic - exact/fuzzy match)
 */
export async function searchWordOccurrences(
  documentIds: string[],
  word: string
): Promise<{ chunks: any[]; totalOccurrences: number; pagesFound: number[] }> {
  // Search for the word in embeddings table using ILIKE for case-insensitive match
  const { data: chunks, error } = await supabaseAdmin
    .from('embeddings')
    .select('id, chunk_text, page_number, document_id')
    .in('document_id', documentIds)
    .ilike('chunk_text', `%${word}%`)
    .order('page_number', { ascending: true })
    .limit(100);
  
  if (error || !chunks) {
    console.error('Error searching word occurrences:', error);
    return { chunks: [], totalOccurrences: 0, pagesFound: [] };
  }
  
  console.log(`🔍 Found ${chunks.length} chunks containing "${word}"`);
  
  // Count occurrences and extract pages
  let totalOccurrences = 0;
  const pagesFound: Set<number> = new Set();
  
  for (const chunk of chunks) {
    const regex = new RegExp(word, 'gi');
    const matches = chunk.chunk_text.match(regex);
    if (matches) {
      totalOccurrences += matches.length;
    }
    if (chunk.page_number) {
      pagesFound.add(chunk.page_number);
    }
  }
  
  console.log(`📊 Total occurrences: ${totalOccurrences} in ${pagesFound.size} pages`);
  
  return { 
    chunks, 
    totalOccurrences, 
    pagesFound: Array.from(pagesFound).sort((a, b) => a - b) 
  };
}

/**
 * Search for definitions of a term before a specific page
 */
export async function searchDefinitions(
  documentIds: string[],
  term: string,
  beforePage: number
): Promise<{ chunks: any[]; definitionPatterns: string[] }> {
  // Definition patterns in Arabic
  const arabicPatterns = [
    `${term} هو`,
    `${term} هي`,
    `المقصود ب${term}`,
    `المراد ب${term}`,
    `يعني ${term}`,
    `تعني ${term}`,
    `معنى ${term}`,
    `${term} أي`,
    `${term}: `,
    `نعني ب${term}`,
  ];
  
  // Search chunks before the page in embeddings table
  const { data: chunks, error } = await supabaseAdmin
    .from('embeddings')
    .select('id, chunk_text, page_number, document_id')
    .in('document_id', documentIds)
    .lt('page_number', beforePage)
    .ilike('chunk_text', `%${term}%`)
    .order('page_number', { ascending: true });
  
  if (error || !chunks) {
    console.error('Error searching definitions:', error);
    return { chunks: [], definitionPatterns: [] };
  }
  
  // Find chunks that contain definition patterns
  const definitionChunks: any[] = [];
  const foundPatterns: string[] = [];
  
  for (const chunk of chunks) {
    for (const pattern of arabicPatterns) {
      if (chunk.chunk_text.includes(pattern)) {
        if (!definitionChunks.find(c => c.id === chunk.id)) {
          definitionChunks.push(chunk);
        }
        if (!foundPatterns.includes(pattern)) {
          foundPatterns.push(pattern);
        }
      }
    }
  }
  
  // If no definition patterns found, return chunks that just contain the term
  if (definitionChunks.length === 0) {
    return { 
      chunks: chunks.slice(0, 10), 
      definitionPatterns: ['No explicit definition found, showing first mentions'] 
    };
  }
  
  return { chunks: definitionChunks, definitionPatterns: foundPatterns };
}

/**
 * Build context for word analysis query
 */
export function buildWordAnalysisPrompt(
  word: string,
  chunks: any[],
  totalOccurrences: number,
  pagesFound: number[]
): string {
  const contextText = chunks.slice(0, 15).map(c => 
    `[صفحة ${c.page_number}]: ${c.chunk_text}`
  ).join('\n\n---\n\n');
  
  return `أنت خبير في تحليل النصوص العربية والإسلامية.

طلب المستخدم تحليل استخدام كلمة "${word}" في الكتاب.

إحصائيات:
- عدد مرات الورود: ${totalOccurrences} مرة
- الصفحات التي وردت فيها: ${pagesFound.slice(0, 20).join(', ')}${pagesFound.length > 20 ? '...' : ''}

المقاطع التي تحتوي على الكلمة:

${contextText}

مهمتك:
1. حلّل كيف يستخدم المؤلف هذه الكلمة
2. ما هي المعاني المختلفة أو السياقات التي تظهر فيها؟
3. ما هي الكلمات والمفاهيم المرتبطة بها في النص؟
4. ما هي الأفكار الرئيسية التي يناقشها المؤلف حول هذا المفهوم؟
5. هل هناك تعريف صريح للكلمة في النص؟

قدم تحليلاً شاملاً ومفيداً للباحث.`;
}

/**
 * Build context for de-jargon query
 */
export function buildDeJargonPrompt(
  term: string,
  pageNumber: number,
  chunks: any[],
  definitionPatterns: string[]
): string {
  const contextText = chunks.map(c => 
    `[صفحة ${c.page_number}]: ${c.chunk_text}`
  ).join('\n\n---\n\n');
  
  return `أنت خبير في تحليل النصوص العربية والإسلامية.

طلب المستخدم فهم معنى مصطلح "${term}" كما يستخدمه المؤلف في صفحة ${pageNumber}.

لا تستخدم تعريفاً قاموسياً. ابحث في سياق الكتاب نفسه.

${definitionPatterns.length > 0 && definitionPatterns[0] !== 'No explicit definition found, showing first mentions' 
  ? `أنماط التعريف الموجودة: ${definitionPatterns.join(', ')}`
  : 'لم يُعثر على تعريف صريح، هذه أولى المواضع التي ورد فيها المصطلح:'}

المقاطع من الكتاب (قبل صفحة ${pageNumber}):

${contextText}

مهمتك:
1. إذا وجدت تعريفاً صريحاً من المؤلف، اقتبسه
2. إذا لم يوجد تعريف صريح، استنتج المعنى من السياق
3. اشرح كيف يستخدم المؤلف هذا المصطلح
4. اذكر الصفحة التي وردت فيها أوضح إشارة للمعنى

الهدف: مساعدة الباحث على فهم المصطلح كما يقصده المؤلف، لا كما يُعرَّف في القواميس.`;
}

/**
 * Main handler to detect and process special queries
 */
export async function handleSpecialQuery(
  query: string,
  documentIds: string[]
): Promise<SpecialQueryResult> {
  // 1. Check for word analysis
  const wordAnalysis = detectWordAnalysisQuery(query);
  if (wordAnalysis.detected && wordAnalysis.word) {
    const isListOnly = wordAnalysis.isListOnly || false;
    console.log(`🔍 Detected ${isListOnly ? 'word LIST' : 'word ANALYSIS'} query for: ${wordAnalysis.word}`);
    const { chunks, totalOccurrences, pagesFound } = await searchWordOccurrences(documentIds, wordAnalysis.word);
    
    // For list queries, return without AI context - frontend will show CSV directly
    // For analysis queries, build AI prompt to analyze the occurrences
    if (isListOnly) {
      return {
        type: 'word-list',
        detected: true,
        params: { word: wordAnalysis.word },
        chunks,
        totalOccurrences,
        pagesFound
      };
    }
    
    const context = buildWordAnalysisPrompt(wordAnalysis.word, chunks, totalOccurrences, pagesFound);
    return {
      type: 'word-analysis',
      detected: true,
      params: { word: wordAnalysis.word },
      context,
      chunks,
      totalOccurrences,
      pagesFound
    };
  }
  
  // 2. Check for de-jargon
  const deJargon = detectDeJargonQuery(query);
  if (deJargon.detected && deJargon.term && deJargon.pageNumber) {
    console.log(`📖 Detected de-jargon query for: ${deJargon.term} at page ${deJargon.pageNumber}`);
    const { chunks, definitionPatterns } = await searchDefinitions(documentIds, deJargon.term, deJargon.pageNumber);
    const context = buildDeJargonPrompt(deJargon.term, deJargon.pageNumber, chunks, definitionPatterns);
    return {
      type: 'de-jargon',
      detected: true,
      params: { term: deJargon.term, pageNumber: deJargon.pageNumber },
      context,
      chunks
    };
  }
  
  // 3. Check for glossary request (handled by separate endpoint, but we detect it)
  const glossary = detectGlossaryQuery(query);
  if (glossary.detected && glossary.pageStart && glossary.pageEnd) {
    console.log(`📚 Detected glossary request for pages ${glossary.pageStart}-${glossary.pageEnd}`);
    return {
      type: 'glossary',
      detected: true,
      params: { pageStart: glossary.pageStart, pageEnd: glossary.pageEnd }
    };
  }
  
  return {
    type: 'none',
    detected: false,
    params: {}
  };
}
