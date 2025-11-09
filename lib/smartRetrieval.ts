import { embedText } from './gemini';
import { searchSimilarChunks } from './vectorStore';
import { createClient } from '@supabase/supabase-js';
import { rerankChunks } from './gemini';
import { retrieveBalancedCorpus, assessRetrievalQuality } from './multiDocRetrieval';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const FALLBACK_MODELS = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

interface RetrievalResult {
  chunks: any[];
  strategy: string;
  confidence: number;
  metadata?: {
    totalCandidates: number;
    uniquePages: number;
    docCoverage: Map<string, number>;
    qualityScore: number;
  };
}

interface RetrievalConfig {
  minSimilarity: number;
  maxChunks: number;
  diversityWeight: number;
  recencyBias: boolean;
}

/**
 * ✅ AI-POWERED FOLLOW-UP DETECTION
 * Uses Gemini to intelligently determine if a query is a follow-up
 */
export async function detectFollowUpWithAI(
  currentQuery: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{
  isFollowUp: boolean;
  confidence: number;
  reason: string;
  needsNewRetrieval: boolean;
}> {
  if (!conversationHistory || conversationHistory.length === 0) {
    return {
      isFollowUp: false,
      confidence: 1.0,
      reason: 'No conversation history',
      needsNewRetrieval: true,
    };
  }

  // Build context from last 2 exchanges (4 messages max)
  const recentHistory = conversationHistory.slice(-4);
  const historyText = recentHistory
    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n\n');

  const prompt = `You are an expert at analyzing conversation flow and query intent.

**Task:** Determine if the current query is a follow-up question to the previous conversation.

**Conversation History:**
${historyText}

**Current Query:**
${currentQuery}

**Analysis Instructions:**
1. A query is a FOLLOW-UP if it:
   - References information from previous messages ("هذه", "this", "السابق", "mentioned")
   - Asks for elaboration/analysis of previous answers ("حلل", "analyze", "اشرح")
   - Continues the same topic without re-establishing context
   - Uses pronouns referring to previous content

2. A query is NOT a follow-up if it:
   - Introduces a completely new topic
   - Provides full context independently
   - Asks about different aspects unrelated to previous answers
   - Could be understood without reading previous messages

3. Determine if NEW RETRIEVAL is needed:
   - If follow-up asks for analysis/explanation of previous answer → NO retrieval (use existing context)
   - If follow-up introduces new keywords/aspects → YES retrieval (expand context)
   - If not a follow-up → YES retrieval (always retrieve for new topics)

**Response Format (JSON only, no markdown):**
{
  "isFollowUp": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation in English",
  "needsNewRetrieval": true/false
}`;

  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300,
        },
      });

      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();

      // Clean response
      response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(response);

      // Validate response structure
      if (
        typeof parsed.isFollowUp === 'boolean' &&
        typeof parsed.confidence === 'number' &&
        typeof parsed.reason === 'string' &&
        typeof parsed.needsNewRetrieval === 'boolean'
      ) {
        console.log(`✅ Follow-up detection (${modelName}):`, parsed);
        return parsed;
      } else {
        console.warn(`⚠️ Invalid response structure from ${modelName}, trying next model`);
        continue;
      }
    } catch (error) {
      console.warn(
        `⚠️ Follow-up detection failed with ${modelName}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      continue;
    }
  }

  // ✅ FALLBACK TO HEURISTICS if all AI models fail
  console.log('⚠️ All AI models failed, using heuristic fallback');
  return heuristicFollowUpDetection(currentQuery, conversationHistory);
}

/**
 * ✅ HEURISTIC FALLBACK (only used if AI fails)
 */
function heuristicFollowUpDetection(
  query: string,
  history: Array<{ role: string; content: string }>
): {
  isFollowUp: boolean;
  confidence: number;
  reason: string;
  needsNewRetrieval: boolean;
} {
  const q = query.toLowerCase();

  // Strong indicators (explicit references)
  const strongIndicators = [
    /\b(هذه|هذا|ذلك|تلك)\b/,
    /\b(السابق|المذكور|المذكورة)\b/,
    /\b(this|that|these|those)\b/,
    /\b(previous|mentioned|above)\b/,
    /^(حلل|احلل|اشرح|وضح|فصّل)/,
    /^(analyze|explain|elaborate)/,
  ];

  const hasStrongIndicator = strongIndicators.some((pattern) => pattern.test(q));

  if (hasStrongIndicator) {
    return {
      isFollowUp: true,
      confidence: 0.7,
      reason: 'Heuristic: Contains explicit reference to previous content',
      needsNewRetrieval: false,
    };
  }

  // Very short queries likely follow-up
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /^(هل|لماذا|كيف|ماذا|why|how|what)/.test(q)) {
    return {
      isFollowUp: true,
      confidence: 0.6,
      reason: 'Heuristic: Short question likely referencing context',
      needsNewRetrieval: false,
    };
  }

  // Check lexical overlap with last assistant response
  if (history.length > 0) {
    const lastAssistant = history
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant')?.content;
    if (lastAssistant) {
      const lastWords = new Set(
        lastAssistant
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
      );
      const overlap = words.filter((w) => lastWords.has(w)).length;

      if (overlap >= Math.max(2, Math.round(words.length / 3))) {
        return {
          isFollowUp: true,
          confidence: 0.5,
          reason: 'Heuristic: High lexical overlap with previous response',
          needsNewRetrieval: true, // Might need more context
        };
      }
    }
  }

  // Default: not a follow-up
  return {
    isFollowUp: false,
    confidence: 0.8,
    reason: 'Heuristic: Independent query',
    needsNewRetrieval: true,
  };
}

/**
 * ✅ EXHAUSTIVE KEYWORD SEARCH - Bypasses embeddings completely
 */
async function exhaustiveKeywordSearch(
  keywords: string[],
  documentIds: string[]
): Promise<any[]> {
  console.log(`🔍 EXHAUSTIVE KEYWORD SEARCH MODE`);
  console.log(`   Keywords:`, keywords);
  console.log(`   Documents:`, documentIds.length);

  const allResults = new Map<string, any>();

  // Clean keywords
  const cleanedKeywords = keywords
    .map((k) => k.trim())
    .filter((k) => {
      if (/^[*:#\-،]/.test(k)) return false;
      if (k.length < 2) return false;
      if (/^[a-zA-Z\s:]+$/.test(k)) return false;
      return true;
    })
    .map((k) => {
      const match = k.match(/[\u0600-\u06FF]+/g);
      return match ? match[0] : k;
    })
    .filter((k, i, arr) => arr.indexOf(k) === i);

  console.log(`   ✅ Cleaned keywords:`, cleanedKeywords);

  for (const keyword of cleanedKeywords) {
    console.log(`   📍 Searching for: "${keyword}"`);

    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .order('page_number', { ascending: true })
      .limit(300);

    if (error) {
      console.error(`   ❌ Error searching for "${keyword}":`, error);
      continue;
    }

    if (data && data.length > 0) {
      console.log(`   ✅ Found ${data.length} matches for "${keyword}"`);

      data.forEach((chunk) => {
        const key = `${chunk.id}-${chunk.chunk_text.substring(0, 50)}`;

        if (!allResults.has(key)) {
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          allResults.set(key, {
            ...chunk,
            matched_keyword: keyword,
            source: 'exhaustive_keyword',
            similarity: 0.75,
            keyword_count: (
              chunk.chunk_text.match(new RegExp(escapedKeyword, 'gi')) || []
            ).length,
          });
        } else {
          const existing = allResults.get(key);
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          existing.keyword_count =
            (existing.keyword_count || 0) +
            (chunk.chunk_text.match(new RegExp(escapedKeyword, 'gi')) || [])
              .length;
        }
      });
    } else {
      console.log(`   ⚠️ No matches found for "${keyword}"`);
    }
  }

  const results = Array.from(allResults.values());
  console.log(`\n📊 TOTAL UNIQUE CHUNKS FOUND: ${results.length}`);

  return results
    .sort((a, b) => {
      if (a.document_id !== b.document_id) {
        return a.document_id.localeCompare(b.document_id);
      }
      return a.page_number - b.page_number;
    })
    .slice(0, 150);
}

/**
 * ✅ Enhanced retrieve context with keyword-first search
 */
export async function retrieveSmartContext(
  queryAnalysis: any,
  documentIds: string[],
  useReranking: boolean = true,
  useKeywordSearch: boolean = false
): Promise<RetrievalResult> {
  const {
    expandedQuery,
    queryType,
    keywords,
    isMultiDocumentQuery,
    originalQuery,
  } = queryAnalysis;

  console.log(
    `🎯 Advanced retrieval for "${queryType}" query across ${documentIds.length} document(s)`
  );
  console.log(`   Reranking: ${useReranking ? 'enabled' : 'disabled'}`);
  console.log(`   Keyword Search: ${useKeywordSearch ? 'enabled' : 'disabled'}`);

  // PRIORITY 0: Keyword-first search
  if (useKeywordSearch && keywords && keywords.length > 0) {
    console.log('🔑 Using KEYWORD-FIRST search strategy');

    const keywordResults = await exhaustiveKeywordSearch(keywords, documentIds);

    if (keywordResults.length > 0) {
      const metadata = buildRetrievalMetadata(
        keywordResults,
        documentIds,
        keywordResults.length
      );

      return {
        chunks: keywordResults,
        strategy: 'keyword_exhaustive',
        confidence: 0.95,
        metadata,
      };
    } else {
      console.log('⚠️ No keyword matches found, falling back to vector search');
    }
  }

  const embedding = await embedText(expandedQuery);
  const isMultiDoc = documentIds.length > 1;

  // PRIORITY 1: Comparative multi-document
  if (isMultiDoc && isMultiDocumentQuery) {
    return await comparativeMultiDocRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType,
      useReranking
    );
  }

  // PRIORITY 2: Multi-document comprehensive
  if (isMultiDoc) {
    return await multiDocumentRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType,
      useReranking
    );
  }

  // PRIORITY 3: Single document deep retrieval
  return await singleDocumentRetrieval(
    embedding,
    documentIds,
    originalQuery,
    queryType,
    keywords,
    useReranking
  );
}

/**
 * ✅ Comparative multi-document retrieval
 */
async function comparativeMultiDocRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  useReranking: boolean = true
): Promise<RetrievalResult> {
  console.log('🔄 COMPARATIVE multi-document strategy');

  const balancedChunks = await retrieveBalancedCorpus(embedding, documentIds, {
    chunksPerDoc: useReranking ? 20 : 30,
    totalChunks: useReranking ? 80 : 120,
    ensureAllDocs: true,
  });

  const enhancedChunks = await enrichWithDocumentSpecificContent(
    balancedChunks,
    embedding,
    documentIds,
    queryType
  );

  let finalChunks: any[];
  let strategy: string;

  if (useReranking) {
    console.log(`🔄 Reranking ${enhancedChunks.length} chunks...`);
    const rerankedChunks = await rerankChunks(query, enhancedChunks, 50);
    finalChunks = ensureCrossDocumentBalance(rerankedChunks, documentIds, 50);
    strategy = 'comparative_balanced_reranked';
  } else {
    console.log('📋 Using direct results (no reranking)');
    finalChunks = ensureCrossDocumentBalance(enhancedChunks, documentIds, 80);
    strategy = 'comparative_balanced_direct';
  }

  const metrics = assessRetrievalQuality(finalChunks, documentIds);
  const metadata = buildRetrievalMetadata(
    finalChunks,
    documentIds,
    enhancedChunks.length
  );

  return {
    chunks: finalChunks,
    strategy,
    confidence: calculateConfidence(metrics, finalChunks),
    metadata,
  };
}

/**
 * ✅ Multi-document retrieval
 */
async function multiDocumentRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  useReranking: boolean = true
): Promise<RetrievalResult> {
  console.log('🔄 Multi-document comprehensive strategy');

  const initialChunks = await retrieveBalancedCorpus(embedding, documentIds, {
    chunksPerDoc: useReranking ? 15 : 25,
    totalChunks: useReranking ? 60 : 100,
    ensureAllDocs: true,
  });

  const enhancedChunks = await applyQueryTypeEnhancement(
    initialChunks,
    embedding,
    documentIds,
    queryType
  );

  let finalChunks: any[];
  let strategy: string;

  if (useReranking) {
    console.log(`🔄 Reranking ${enhancedChunks.length} chunks...`);
    finalChunks = await rerankChunks(query, enhancedChunks, 35);
    strategy = 'multi_document_comprehensive_reranked';
  } else {
    console.log('📋 Using direct results (no reranking)');
    finalChunks = enhancedChunks
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, 60);
    strategy = 'multi_document_comprehensive_direct';
  }

  const metrics = assessRetrievalQuality(finalChunks, documentIds);
  const metadata = buildRetrievalMetadata(
    finalChunks,
    documentIds,
    enhancedChunks.length
  );

  return {
    chunks: finalChunks,
    strategy,
    confidence:
      calculateConfidence(metrics, finalChunks) * (useReranking ? 0.85 : 0.75),
    metadata,
  };
}

/**
 * ✅ Single document deep retrieval
 */
async function singleDocumentRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  keywords: string[],
  useReranking: boolean = true
): Promise<RetrievalResult> {
  console.log(`📄 Single document strategy: ${queryType}`);

  let chunks: any[] = [];
  let strategy = 'hybrid';

  switch (queryType) {
    case 'narrative':
      chunks = await narrativeRetrieval(
        embedding,
        documentIds,
        keywords,
        useReranking
      );
      strategy = 'narrative_contextual';
      break;

    case 'analytical':
      chunks = await analyticalRetrieval(embedding, documentIds, useReranking);
      strategy = 'analytical_diverse';
      break;

    case 'factual':
      chunks = await factualRetrieval(
        embedding,
        documentIds,
        keywords,
        useReranking
      );
      strategy = 'factual_precision';
      break;

    case 'thematic':
      chunks = await thematicRetrieval(embedding, documentIds, useReranking);
      strategy = 'thematic_comprehensive';
      break;

    default:
      chunks = await hybridRetrieval(
        embedding,
        documentIds,
        keywords,
        useReranking
      );
      strategy = 'hybrid_adaptive';
  }

  if (useReranking && chunks.length > 15) {
    console.log(`🔍 Reranking ${chunks.length} candidates...`);
    chunks = await rerankChunks(query, chunks, 15);
    strategy += '_reranked';
  } else if (!useReranking) {
    console.log('📋 Using direct results (no reranking)');
    chunks = chunks.slice(0, queryType === 'factual' ? 50 : 40);
    strategy += '_direct';
  }

  const confidence = calculateChunkConfidence(chunks);
  const metadata = buildRetrievalMetadata(chunks, documentIds, chunks.length);

  console.log(
    `   ✅ Final: ${chunks.length} chunks | ${strategy} | confidence: ${(
      confidence * 100
    ).toFixed(1)}%`
  );

  return { chunks, strategy, confidence, metadata };
}

// ... (rest of the retrieval functions remain the same: narrativeRetrieval, analyticalRetrieval, factualRetrieval, etc.)
// I'll include them for completeness:

async function narrativeRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  const { data: earlyChunks } = await supabaseAdmin
    .from('embeddings')
    .select('*')
    .in('document_id', documentIds)
    .lte('page_number', 25)
    .order('page_number', { ascending: true })
    .limit(useReranking ? 12 : 20);

  if (earlyChunks) {
    earlyChunks.forEach((c) => {
      chunkMap.set(c.chunk_text, {
        ...c,
        source: 'narrative_foundation',
        similarity: 0.65,
        boost: 'early_content',
      });
    });
  }

  const vectorResults = await searchSimilarChunks(
    embedding,
    documentIds,
    useReranking ? 100 : 150
  );

  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, useReranking ? 30 : 50)
    .forEach((c) => {
      if (
        !chunkMap.has(c.chunk_text) ||
        c.similarity > (chunkMap.get(c.chunk_text)?.similarity || 0)
      ) {
        chunkMap.set(c.chunk_text, { ...c, source: 'vector_match' });
      }
    });

  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 10 : 15);

  for (const chunk of topChunks) {
    const { data: neighbors } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', chunk.page_number - 1)
      .lte('page_number', chunk.page_number + 1)
      .neq('chunk_text', chunk.chunk_text)
      .limit(useReranking ? 4 : 6);

    if (neighbors) {
      neighbors.forEach((n) => {
        if (!chunkMap.has(n.chunk_text)) {
          chunkMap.set(n.chunk_text, {
            ...n,
            source: 'sequential_context',
            similarity: (chunk.similarity || 0) * 0.8,
          });
        }
      });
    }
  }

  for (const keyword of keywords.slice(0, useReranking ? 4 : 6)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 8 : 12);

    if (keywordChunks) {
      keywordChunks.forEach((c) => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, {
            ...c,
            source: 'keyword_match',
            similarity: 0.5,
          });
        }
      });
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 50 : 80);
}

async function analyticalRetrieval(
  embedding: number[],
  documentIds: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const vectorResults = await searchSimilarChunks(
    embedding,
    documentIds,
    useReranking ? 150 : 200
  );

  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.3);

  const pageGroups = new Map<number, any[]>();
  for (const chunk of relevant) {
    const pageGroup = Math.floor(chunk.page_number / 8) * 8;
    if (!pageGroups.has(pageGroup)) {
      pageGroups.set(pageGroup, []);
    }
    pageGroups.get(pageGroup)!.push(chunk);
  }

  const diverseChunks: any[] = [];
  for (const chunks of pageGroups.values()) {
    diverseChunks.push(...chunks.slice(0, useReranking ? 2 : 3));
  }

  const highConfidence = relevant
    .filter((r: any) => (r.similarity || 0) >= 0.65)
    .slice(0, useReranking ? 15 : 25);

  const chunkMap = new Map<string, any>();
  [...diverseChunks, ...highConfidence].forEach((c) => {
    if (
      !chunkMap.has(c.chunk_text) ||
      (c.similarity || 0) > (chunkMap.get(c.chunk_text)?.similarity || 0)
    ) {
      chunkMap.set(c.chunk_text, c);
    }
  });

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 45 : 70);
}

async function factualRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  const vectorResults = await searchSimilarChunks(
    embedding,
    documentIds,
    useReranking ? 80 : 150
  );

  vectorResults
    .filter((r: any) =>
      (r.similarity || 0) >= (useReranking ? 0.4 : 0.3)
    )
    .forEach((c) => chunkMap.set(c.chunk_text, c));

  for (const keyword of keywords.slice(0, useReranking ? 5 : 10)) {
    const { data: exactMatches } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 10 : 30);

    if (exactMatches) {
      exactMatches.forEach((c) => {
        const existing = chunkMap.get(c.chunk_text);
        if (!existing || (c.similarity || 0) > (existing.similarity || 0)) {
          chunkMap.set(c.chunk_text, {
            ...c,
            source: 'keyword_exact',
            similarity: Math.max(c.similarity || 0, 0.55),
          });
        }
      });
    }
  }

  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 8 : 15);

  for (const chunk of topChunks) {
    const { data: relatedChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', Math.max(1, chunk.page_number - 2))
      .lte('page_number', chunk.page_number + 2)
      .neq('chunk_text', chunk.chunk_text)
      .limit(useReranking ? 3 : 5);

    if (relatedChunks) {
      relatedChunks.forEach((c) => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, {
            ...c,
            source: 'factual_support',
            similarity: (chunk.similarity || 0) * 0.75,
          });
        }
      });
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 40 : 100);
}

async function thematicRetrieval(
  embedding: number[],
  documentIds: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  const vectorResults = await searchSimilarChunks(
    embedding,
    documentIds,
    useReranking ? 120 : 180
  );

  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.32)
    .forEach((c) => chunkMap.set(c.chunk_text, c));

  const { data: maxPageData } = await supabaseAdmin
    .from('embeddings')
    .select('page_number')
    .in('document_id', documentIds)
    .order('page_number', { ascending: false })
    .limit(1);

  if (maxPageData && maxPageData.length > 0) {
    const maxPage = maxPageData[0].page_number;
    const sections = [
      { start: 1, end: Math.floor(maxPage * 0.15), label: 'introduction' },
      {
        start: Math.floor(maxPage * 0.25),
        end: Math.floor(maxPage * 0.35),
        label: 'early_development',
      },
      {
        start: Math.floor(maxPage * 0.45),
        end: Math.floor(maxPage * 0.55),
        label: 'core_content',
      },
      {
        start: Math.floor(maxPage * 0.65),
        end: Math.floor(maxPage * 0.75),
        label: 'late_development',
      },
      { start: Math.floor(maxPage * 0.85), end: maxPage, label: 'conclusion' },
    ];

    for (const section of sections) {
      const { data: sectionChunks } = await supabaseAdmin
        .from('embeddings')
        .select('*')
        .in('document_id', documentIds)
        .gte('page_number', section.start)
        .lte('page_number', section.end)
        .order('page_number', { ascending: true })
        .limit(useReranking ? 6 : 10);

      if (sectionChunks) {
        sectionChunks.forEach((c) => {
          if (!chunkMap.has(c.chunk_text)) {
            chunkMap.set(c.chunk_text, {
              ...c,
              source: `thematic_${section.label}`,
              similarity: 0.45,
            });
          }
        });
      }
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 50 : 80);
}

async function hybridRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  const vectorResults = await searchSimilarChunks(
    embedding,
    documentIds,
    useReranking ? 100 : 150
  );

  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, useReranking ? 35 : 55)
    .forEach((c) => chunkMap.set(c.chunk_text, c));

  for (const keyword of keywords.slice(0, useReranking ? 3 : 5)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 8 : 15);

    if (keywordChunks) {
      keywordChunks.forEach((c) => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, {
            ...c,
            source: 'keyword',
            similarity: 0.5,
          });
        }
      });
    }
  }

  const diverse = applyDiversitySampling(
    Array.from(chunkMap.values()),
    useReranking ? 15 : 25
  );
  diverse.forEach((c) => chunkMap.set(c.chunk_text, c));

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 45 : 70);
}

async function enrichWithDocumentSpecificContent(
  baseChunks: any[],
  embedding: number[],
  documentIds: string[],
  queryType: string
): Promise<any[]> {
  const chunkMap = new Map<string, any>();
  baseChunks.forEach((c) => chunkMap.set(c.chunk_text, c));

  for (const docId of documentIds) {
    const docSpecific = await searchSimilarChunks(embedding, [docId], 15);
    docSpecific
      .filter((c: any) => (c.similarity || 0) >= 0.4)
      .slice(0, 8)
      .forEach((c) => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, { ...c, source: 'doc_specific' });
        }
      });
  }

  return Array.from(chunkMap.values());
}

async function applyQueryTypeEnhancement(
  chunks: any[],
  embedding: number[],
  documentIds: string[],
  queryType: string
): Promise<any[]> {
  const chunkMap = new Map<string, any>();
  chunks.forEach((c) => chunkMap.set(c.chunk_text, c));

  const expansionLimit = queryType === 'thematic' ? 20 : 15;

  const additional = await searchSimilarChunks(embedding, documentIds, 50);
  additional
    .filter((c: any) => (c.similarity || 0) >= 0.35)
    .slice(0, expansionLimit)
    .forEach((c) => {
      if (!chunkMap.has(c.chunk_text)) {
        chunkMap.set(c.chunk_text, c);
      }
    });

  return Array.from(chunkMap.values());
}

function ensureCrossDocumentBalance(
  chunks: any[],
  documentIds: string[],
  targetCount: number
): any[] {
  const minPerDoc = Math.floor(targetCount / documentIds.length);
  const docGroups = new Map<string, any[]>();

  documentIds.forEach((id) => docGroups.set(id, []));
  chunks.forEach((c) => {
    const group = docGroups.get(c.document_id);
    if (group) group.push(c);
  });

  const balanced: any[] = [];

  for (const [docId, docChunks] of docGroups.entries()) {
    balanced.push(...docChunks.slice(0, minPerDoc));
  }

  const remaining = chunks.filter((c) => !balanced.includes(c));
  balanced.push(...remaining.slice(0, targetCount - balanced.length));

  return balanced.slice(0, targetCount);
}

function applyDiversitySampling(chunks: any[], sampleSize: number): any[] {
  const pageGroups = new Map<number, any[]>();

  chunks.forEach((chunk) => {
    const pageGroup = Math.floor(chunk.page_number / 5) * 5;
    if (!pageGroups.has(pageGroup)) {
      pageGroups.set(pageGroup, []);
    }
    pageGroups.get(pageGroup)!.push(chunk);
  });

  const diverse: any[] = [];
  for (const group of pageGroups.values()) {
    diverse.push(group[0]);
    if (diverse.length >= sampleSize) break;
  }

  return diverse;
}

function buildRetrievalMetadata(
  chunks: any[],
  documentIds: string[],
  totalCandidates: number
): RetrievalResult['metadata'] {
  const uniquePages = new Set(
    chunks.map((c) => `${c.document_id}-${c.page_number}`)
  ).size;
  const docCoverage = new Map<string, number>();

  documentIds.forEach((id) => {
    const count = chunks.filter((c) => c.document_id === id).length;
    docCoverage.set(id, count);
  });

  const avgSimilarity =
    chunks.reduce((sum, c) => sum + (c.similarity || 0), 0) / chunks.length;
  const qualityScore = avgSimilarity * (uniquePages / Math.max(chunks.length, 1));

  return {
    totalCandidates,
    uniquePages,
    docCoverage,
    qualityScore,
  };
}

function calculateConfidence(metrics: any, chunks: any[]): number {
  const coverageScore = metrics.coverageRatio || 0.5;
  const similarityScore =
    chunks.length > 0
      ? chunks
          .slice(0, 5)
          .reduce((sum: number, c: any) => sum + (c.similarity || 0), 0) /
        Math.min(5, chunks.length)
      : 0;

  return (coverageScore * 0.4 + similarityScore * 0.6) * 0.9;
}

function calculateChunkConfidence(chunks: any[]): number {
  if (chunks.length === 0) return 0;

  const topScores = chunks.slice(0, 5).map((c) => c.similarity || 0);
  const avgScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;

  return Math.max(avgScore, chunks.length >= 10 ? 0.65 : 0.55);
}