import { embedText } from './gemini';
import { searchSimilarChunks } from './vectorStore';
import { createClient } from '@supabase/supabase-js';
import { rerankChunks } from './gemini';
import { retrieveBalancedCorpus, assessRetrievalQuality } from './multiDocRetrieval';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
 * Enhanced retrieve context with advanced multi-stage retrieval
 */
export async function retrieveSmartContext(
  queryAnalysis: any,
  documentIds: string[]
): Promise<RetrievalResult> {
  const { 
    expandedQuery, 
    queryType, 
    keywords, 
    isMultiDocumentQuery, 
    originalQuery 
  } = queryAnalysis;

  console.log(`🎯 Advanced retrieval for "${queryType}" query across ${documentIds.length} document(s)`);

  const embedding = await embedText(expandedQuery);
  const isMultiDoc = documentIds.length > 1;

  // ✅ PRIORITY 1: Comparative multi-document research queries
  if (isMultiDoc && isMultiDocumentQuery) {
    return await comparativeMultiDocRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType
    );
  }

  // ✅ PRIORITY 2: Multi-document comprehensive analysis
  if (isMultiDoc) {
    return await multiDocumentRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType
    );
  }

  // ✅ PRIORITY 3: Single document deep retrieval
  return await singleDocumentRetrieval(
    embedding,
    documentIds,
    originalQuery,
    queryType,
    keywords
  );
}

/**
 * Comparative multi-document retrieval with cross-document analysis
 */
async function comparativeMultiDocRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string
): Promise<RetrievalResult> {
  console.log('🔄 COMPARATIVE multi-document strategy');

  // Stage 1: Balanced corpus retrieval
  const balancedChunks = await retrieveBalancedCorpus(
    embedding,
    documentIds,
    {
      chunksPerDoc: 20,
      totalChunks: 80,
      ensureAllDocs: true,
    }
  );

  // Stage 2: Add document-specific high-value chunks
  const enhancedChunks = await enrichWithDocumentSpecificContent(
    balancedChunks,
    embedding,
    documentIds,
    queryType
  );

  // Stage 3: Rerank for comparative relevance
  const rerankedChunks = await rerankChunks(query, enhancedChunks, 50);

  // Stage 4: Ensure cross-document representation
  const finalChunks = ensureCrossDocumentBalance(rerankedChunks, documentIds, 50);

  const metrics = assessRetrievalQuality(finalChunks, documentIds);
  const metadata = buildRetrievalMetadata(finalChunks, documentIds, enhancedChunks.length);

  return {
    chunks: finalChunks,
    strategy: 'comparative_balanced_enhanced',
    confidence: calculateConfidence(metrics, finalChunks),
    metadata
  };
}

/**
 * Multi-document retrieval for comprehensive analysis
 */
async function multiDocumentRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string
): Promise<RetrievalResult> {
  console.log('🔄 Multi-document comprehensive strategy');

  // Stage 1: Initial balanced retrieval
  const initialChunks = await retrieveBalancedCorpus(
    embedding,
    documentIds,
    {
      chunksPerDoc: 15,
      totalChunks: 60,
      ensureAllDocs: true,
    }
  );

  // Stage 2: Query-type specific enhancement
  const enhancedChunks = await applyQueryTypeEnhancement(
    initialChunks,
    embedding,
    documentIds,
    queryType
  );

  // Stage 3: Rerank with original query
  const rerankedChunks = await rerankChunks(query, enhancedChunks, 35);

  const metrics = assessRetrievalQuality(rerankedChunks, documentIds);
  const metadata = buildRetrievalMetadata(rerankedChunks, documentIds, enhancedChunks.length);

  return {
    chunks: rerankedChunks,
    strategy: 'multi_document_comprehensive',
    confidence: calculateConfidence(metrics, rerankedChunks) * 0.85,
    metadata
  };
}

/**
 * Single document deep retrieval with specialized strategies
 */
async function singleDocumentRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  keywords: string[]
): Promise<RetrievalResult> {
  console.log(`📄 Single document strategy: ${queryType}`);

  let chunks: any[] = [];
  let strategy = 'hybrid';

  // Stage 1: Strategy-specific retrieval
  switch (queryType) {
    case 'narrative':
      chunks = await narrativeRetrieval(embedding, documentIds, keywords);
      strategy = 'narrative_contextual';
      break;

    case 'analytical':
      chunks = await analyticalRetrieval(embedding, documentIds);
      strategy = 'analytical_diverse';
      break;

    case 'factual':
      chunks = await factualRetrieval(embedding, documentIds, keywords);
      strategy = 'factual_precision';
      break;

    case 'thematic':
      chunks = await thematicRetrieval(embedding, documentIds);
      strategy = 'thematic_comprehensive';
      break;

    default:
      chunks = await hybridRetrieval(embedding, documentIds, keywords);
      strategy = 'hybrid_adaptive';
  }

  // Stage 2: Rerank for precision
  if (chunks.length > 0) {
    console.log(`🔍 Reranking ${chunks.length} candidates for query: "${query}"`);
    chunks = await rerankChunks(query, chunks, 15);
    strategy += '_reranked';
  }

  const confidence = calculateChunkConfidence(chunks);
  const metadata = buildRetrievalMetadata(chunks, documentIds, chunks.length);

  console.log(`   ✅ Final: ${chunks.length} chunks | ${strategy} | confidence: ${(confidence * 100).toFixed(1)}%`);

  return { chunks, strategy, confidence, metadata };
}

/**
 * NARRATIVE RETRIEVAL: Story flow with context preservation
 */
async function narrativeRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[]
): Promise<any[]> {
  const chunks: any[] = [];
  const chunkMap = new Map<string, any>();

  // 1. Critical early content (setup, characters, themes)
  const { data: earlyChunks } = await supabaseAdmin
    .from('embeddings')
    .select('*')
    .in('document_id', documentIds)
    .lte('page_number', 25)
    .order('page_number', { ascending: true })
    .limit(12);

  if (earlyChunks) {
    earlyChunks.forEach(c => {
      chunkMap.set(c.chunk_text, { 
        ...c, 
        source: 'narrative_foundation', 
        similarity: 0.65,
        boost: 'early_content'
      });
    });
  }

  // 2. High-relevance vector search
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 100);
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, 30)
    .forEach(c => {
      if (!chunkMap.has(c.chunk_text) || c.similarity > (chunkMap.get(c.chunk_text)?.similarity || 0)) {
        chunkMap.set(c.chunk_text, { ...c, source: 'vector_match' });
      }
    });

  // 3. Sequential context expansion (neighbors of high-scoring chunks)
  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 10);

  for (const chunk of topChunks) {
    const { data: neighbors } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', chunk.page_number - 1)
      .lte('page_number', chunk.page_number + 1)
      .neq('chunk_text', chunk.chunk_text)
      .limit(4);

    if (neighbors) {
      neighbors.forEach(n => {
        if (!chunkMap.has(n.chunk_text)) {
          chunkMap.set(n.chunk_text, { 
            ...n, 
            source: 'sequential_context', 
            similarity: (chunk.similarity || 0) * 0.8 
          });
        }
      });
    }
  }

  // 4. Keyword-enhanced retrieval
  for (const keyword of keywords.slice(0, 4)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(8);

    if (keywordChunks) {
      keywordChunks.forEach(c => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, { 
            ...c, 
            source: 'keyword_match', 
            similarity: 0.5 
          });
        }
      });
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 50);
}

/**
 * ANALYTICAL RETRIEVAL: Diverse perspectives with depth
 */
async function analyticalRetrieval(
  embedding: number[],
  documentIds: string[]
): Promise<any[]> {
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 150);
  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.30);

  // Strategy 1: Page-group diversity
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
    // Take top 2 from each page group for diversity
    diverseChunks.push(...chunks.slice(0, 2));
  }

  // Strategy 2: Add high-confidence chunks regardless of page
  const highConfidence = relevant
    .filter((r: any) => (r.similarity || 0) >= 0.65)
    .slice(0, 15);

  const chunkMap = new Map<string, any>();
  [...diverseChunks, ...highConfidence].forEach(c => {
    if (!chunkMap.has(c.chunk_text) || (c.similarity || 0) > (chunkMap.get(c.chunk_text)?.similarity || 0)) {
      chunkMap.set(c.chunk_text, c);
    }
  });

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 45);
}

/**
 * FACTUAL RETRIEVAL: Precision-focused with validation
 */
async function factualRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[]
): Promise<any[]> {
  const chunks: any[] = [];
  const chunkMap = new Map<string, any>();

  // 1. High-precision vector search
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 80);
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.40) // Higher threshold for factual
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. Exact keyword matching for factual accuracy
  for (const keyword of keywords.slice(0, 5)) {
    const { data: exactMatches } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(10);

    if (exactMatches) {
      exactMatches.forEach(c => {
        const existing = chunkMap.get(c.chunk_text);
        if (!existing || (c.similarity || 0) > (existing.similarity || 0)) {
          chunkMap.set(c.chunk_text, { 
            ...c, 
            source: 'keyword_exact',
            similarity: Math.max(c.similarity || 0, 0.55)
          });
        }
      });
    }
  }

  // 3. Cross-reference validation (find supporting chunks)
  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 8);

  for (const chunk of topChunks) {
    const { data: relatedChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', Math.max(1, chunk.page_number - 2))
      .lte('page_number', chunk.page_number + 2)
      .neq('chunk_text', chunk.chunk_text)
      .limit(3);

    if (relatedChunks) {
      relatedChunks.forEach(c => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, { 
            ...c, 
            source: 'factual_support',
            similarity: (chunk.similarity || 0) * 0.75
          });
        }
      });
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 40);
}

/**
 * THEMATIC RETRIEVAL: Comprehensive document understanding
 */
async function thematicRetrieval(
  embedding: number[],
  documentIds: string[]
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. High-quality vector matches
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 120);
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.32)
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. Strategic document sampling (beginning, multiple middle sections, end)
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
      { start: Math.floor(maxPage * 0.25), end: Math.floor(maxPage * 0.35), label: 'early_development' },
      { start: Math.floor(maxPage * 0.45), end: Math.floor(maxPage * 0.55), label: 'core_content' },
      { start: Math.floor(maxPage * 0.65), end: Math.floor(maxPage * 0.75), label: 'late_development' },
      { start: Math.floor(maxPage * 0.85), end: maxPage, label: 'conclusion' }
    ];

    for (const section of sections) {
      const { data: sectionChunks } = await supabaseAdmin
        .from('embeddings')
        .select('*')
        .in('document_id', documentIds)
        .gte('page_number', section.start)
        .lte('page_number', section.end)
        .order('page_number', { ascending: true })
        .limit(6);

      if (sectionChunks) {
        sectionChunks.forEach(c => {
          if (!chunkMap.has(c.chunk_text)) {
            chunkMap.set(c.chunk_text, { 
              ...c, 
              source: `thematic_${section.label}`,
              similarity: 0.45
            });
          }
        });
      }
    }
  }

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 50);
}

/**
 * HYBRID RETRIEVAL: Adaptive multi-strategy approach
 */
async function hybridRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[]
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. Strong vector search
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 100);
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, 35)
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. Keyword support
  for (const keyword of keywords.slice(0, 3)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(8);

    if (keywordChunks) {
      keywordChunks.forEach(c => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, { 
            ...c, 
            source: 'keyword',
            similarity: 0.5 
          });
        }
      });
    }
  }

  // 3. Diversity sampling
  const diverse = applyDiversitySampling(Array.from(chunkMap.values()), 15);
  diverse.forEach(c => chunkMap.set(c.chunk_text, c));

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, 45);
}

/**
 * Helper: Enrich with document-specific high-value content
 */
async function enrichWithDocumentSpecificContent(
  baseChunks: any[],
  embedding: number[],
  documentIds: string[],
  queryType: string
): Promise<any[]> {
  const chunkMap = new Map<string, any>();
  baseChunks.forEach(c => chunkMap.set(c.chunk_text, c));

  // Add high-scoring chunks from each document
  for (const docId of documentIds) {
    const docSpecific = await searchSimilarChunks(embedding, [docId], 15);
    docSpecific
      .filter((c: any) => (c.similarity || 0) >= 0.40)
      .slice(0, 8)
      .forEach(c => {
        if (!chunkMap.has(c.chunk_text)) {
          chunkMap.set(c.chunk_text, { ...c, source: 'doc_specific' });
        }
      });
  }

  return Array.from(chunkMap.values());
}

/**
 * Helper: Apply query-type specific enhancements
 */
async function applyQueryTypeEnhancement(
  chunks: any[],
  embedding: number[],
  documentIds: string[],
  queryType: string
): Promise<any[]> {
  const chunkMap = new Map<string, any>();
  chunks.forEach(c => chunkMap.set(c.chunk_text, c));

  // Add targeted expansion based on query type
  const expansionLimit = queryType === 'thematic' ? 20 : 15;
  
  const additional = await searchSimilarChunks(embedding, documentIds, 50);
  additional
    .filter((c: any) => (c.similarity || 0) >= 0.35)
    .slice(0, expansionLimit)
    .forEach(c => {
      if (!chunkMap.has(c.chunk_text)) {
        chunkMap.set(c.chunk_text, c);
      }
    });

  return Array.from(chunkMap.values());
}

/**
 * Helper: Ensure cross-document balance in final results
 */
function ensureCrossDocumentBalance(
  chunks: any[],
  documentIds: string[],
  targetCount: number
): any[] {
  const minPerDoc = Math.floor(targetCount / documentIds.length);
  const docGroups = new Map<string, any[]>();
  
  documentIds.forEach(id => docGroups.set(id, []));
  chunks.forEach(c => {
    const group = docGroups.get(c.document_id);
    if (group) group.push(c);
  });

  const balanced: any[] = [];
  
  // First pass: ensure minimum from each document
  for (const [docId, docChunks] of docGroups.entries()) {
    balanced.push(...docChunks.slice(0, minPerDoc));
  }

  // Second pass: fill remaining slots with highest-scoring chunks
  const remaining = chunks.filter(c => !balanced.includes(c));
  balanced.push(...remaining.slice(0, targetCount - balanced.length));

  return balanced.slice(0, targetCount);
}

/**
 * Helper: Apply diversity sampling to avoid redundancy
 */
function applyDiversitySampling(chunks: any[], sampleSize: number): any[] {
  const pageGroups = new Map<number, any[]>();
  
  chunks.forEach(chunk => {
    const pageGroup = Math.floor(chunk.page_number / 5) * 5;
    if (!pageGroups.has(pageGroup)) {
      pageGroups.set(pageGroup, []);
    }
    pageGroups.get(pageGroup)!.push(chunk);
  });

  const diverse: any[] = [];
  for (const group of pageGroups.values()) {
    diverse.push(group[0]); // Take best from each group
    if (diverse.length >= sampleSize) break;
  }

  return diverse;
}

/**
 * Helper: Build comprehensive retrieval metadata
 */
function buildRetrievalMetadata(
  chunks: any[],
  documentIds: string[],
  totalCandidates: number
): RetrievalResult['metadata'] {
  const uniquePages = new Set(chunks.map(c => `${c.document_id}-${c.page_number}`)).size;
  const docCoverage = new Map<string, number>();
  
  documentIds.forEach(id => {
    const count = chunks.filter(c => c.document_id === id).length;
    docCoverage.set(id, count);
  });

  const avgSimilarity = chunks.reduce((sum, c) => sum + (c.similarity || 0), 0) / chunks.length;
  const qualityScore = avgSimilarity * (uniquePages / Math.max(chunks.length, 1));

  return {
    totalCandidates,
    uniquePages,
    docCoverage,
    qualityScore
  };
}

/**
 * Helper: Calculate confidence score
 */
function calculateConfidence(metrics: any, chunks: any[]): number {
  const coverageScore = metrics.coverageRatio || 0.5;
  const similarityScore = chunks.length > 0
    ? chunks.slice(0, 5).reduce((sum: number, c: any) => sum + (c.similarity || 0), 0) / Math.min(5, chunks.length)
    : 0;
  
  return (coverageScore * 0.4 + similarityScore * 0.6) * 0.9;
}

/**
 * Helper: Calculate chunk-based confidence
 */
function calculateChunkConfidence(chunks: any[]): number {
  if (chunks.length === 0) return 0;
  
  const topScores = chunks.slice(0, 5).map(c => c.similarity || 0);
  const avgScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;
  
  // Boost confidence if we have good chunks
  return Math.max(avgScore, chunks.length >= 10 ? 0.65 : 0.55);
}