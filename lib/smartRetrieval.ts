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
 * ✅ EXHAUSTIVE KEYWORD SEARCH - Bypasses embeddings completely
 * Uses PostgreSQL full-text search for exact matches
 */
async function exhaustiveKeywordSearch(
  keywords: string[],
  documentIds: string[]
): Promise<any[]> {
  console.log(`🔍 EXHAUSTIVE KEYWORD SEARCH MODE`);
  console.log(`   Keywords:`, keywords);
  console.log(`   Documents:`, documentIds.length);
  
  const allResults = new Map<string, any>();
  
  // ✅ Search for EACH keyword variant
  for (const keyword of keywords) {
    if (keyword.length < 2) continue; // Skip very short keywords
    
    console.log(`   📍 Searching for: "${keyword}"`);
    
    // ✅ Use ILIKE for case-insensitive, Arabic-friendly search
    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .order('page_number', { ascending: true })
      .limit(300); // Very high limit
    
    if (error) {
      console.error(`   ❌ Error searching for "${keyword}":`, error);
      continue;
    }
    
    if (data && data.length > 0) {
      console.log(`   ✅ Found ${data.length} matches for "${keyword}"`);
      
      data.forEach(chunk => {
        // Use chunk ID + text as unique key to avoid duplicates
        const key = `${chunk.id}-${chunk.chunk_text.substring(0, 50)}`;
        
        if (!allResults.has(key)) {
          allResults.set(key, {
            ...chunk,
            matched_keyword: keyword,
            source: 'exhaustive_keyword',
            similarity: 0.75, // Assign good similarity score
            keyword_count: (chunk.chunk_text.match(new RegExp(keyword, 'gi')) || []).length
          });
        } else {
          // If already exists, update keyword count
          const existing = allResults.get(key);
          existing.keyword_count = (existing.keyword_count || 0) + 
            (chunk.chunk_text.match(new RegExp(keyword, 'gi')) || []).length;
        }
      });
    } else {
      console.log(`   ⚠️ No matches found for "${keyword}"`);
    }
  }
  
  const results = Array.from(allResults.values());
  console.log(`\n📊 TOTAL UNIQUE CHUNKS FOUND: ${results.length}`);
  
  // ✅ Sort by page number for chronological order
  return results
    .sort((a, b) => {
      // First by document, then by page
      if (a.document_id !== b.document_id) {
        return a.document_id.localeCompare(b.document_id);
      }
      return a.page_number - b.page_number;
    })
    .slice(0, 150); // Return up to 150 chunks
}

/**
 * ✅ Enhanced retrieve context with keyword-first search
 */
export async function retrieveSmartContext(
  queryAnalysis: any,
  documentIds: string[],
  useReranking: boolean = true,
  useKeywordSearch: boolean = false // ✅ NEW PARAMETER
): Promise<RetrievalResult> {
  const { 
    expandedQuery, 
    queryType, 
    keywords, 
    isMultiDocumentQuery, 
    originalQuery 
  } = queryAnalysis;

  console.log(`🎯 Advanced retrieval for "${queryType}" query across ${documentIds.length} document(s)`);
  console.log(`   Reranking: ${useReranking ? 'enabled' : 'disabled'}`);
  console.log(`   Keyword Search: ${useKeywordSearch ? 'enabled' : 'disabled'}`);

  // ✅ PRIORITY 0: Keyword-first search (if enabled)
  if (useKeywordSearch && keywords && keywords.length > 0) {
    console.log('🔑 Using KEYWORD-FIRST search strategy');
    
    const keywordResults = await exhaustiveKeywordSearch(keywords, documentIds);
    
    if (keywordResults.length > 0) {
      const metadata = buildRetrievalMetadata(keywordResults, documentIds, keywordResults.length);
      
      return {
        chunks: keywordResults,
        strategy: 'keyword_exhaustive',
        confidence: 0.95, // High confidence for exact matches
        metadata
      };
    } else {
      console.log('⚠️ No keyword matches found, falling back to vector search');
    }
  }

  const embedding = await embedText(expandedQuery);
  const isMultiDoc = documentIds.length > 1;

  // ✅ PRIORITY 1: Comparative multi-document research queries
  if (isMultiDoc && isMultiDocumentQuery) {
    return await comparativeMultiDocRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType,
      useReranking
    );
  }

  // ✅ PRIORITY 2: Multi-document comprehensive analysis
  if (isMultiDoc) {
    return await multiDocumentRetrieval(
      embedding,
      documentIds,
      originalQuery,
      queryType,
      useReranking
    );
  }

  // ✅ PRIORITY 3: Single document deep retrieval
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
 * ✅ Comparative multi-document retrieval with optional reranking
 */
async function comparativeMultiDocRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  useReranking: boolean = true
): Promise<RetrievalResult> {
  console.log('🔄 COMPARATIVE multi-document strategy');

  // Stage 1: Balanced corpus retrieval
  const balancedChunks = await retrieveBalancedCorpus(
    embedding,
    documentIds,
    {
      chunksPerDoc: useReranking ? 20 : 30, // ✅ More without reranking
      totalChunks: useReranking ? 80 : 120,
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

  let finalChunks: any[];
  let strategy: string;

  // ✅ Stage 3: Conditional reranking
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
  const metadata = buildRetrievalMetadata(finalChunks, documentIds, enhancedChunks.length);

  return {
    chunks: finalChunks,
    strategy,
    confidence: calculateConfidence(metrics, finalChunks),
    metadata
  };
}

/**
 * ✅ Multi-document retrieval with optional reranking
 */
async function multiDocumentRetrieval(
  embedding: number[],
  documentIds: string[],
  query: string,
  queryType: string,
  useReranking: boolean = true
): Promise<RetrievalResult> {
  console.log('🔄 Multi-document comprehensive strategy');

  // Stage 1: Initial balanced retrieval
  const initialChunks = await retrieveBalancedCorpus(
    embedding,
    documentIds,
    {
      chunksPerDoc: useReranking ? 15 : 25, // ✅ More without reranking
      totalChunks: useReranking ? 60 : 100,
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

  let finalChunks: any[];
  let strategy: string;

  // ✅ Stage 3: Conditional reranking
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
  const metadata = buildRetrievalMetadata(finalChunks, documentIds, enhancedChunks.length);

  return {
    chunks: finalChunks,
    strategy,
    confidence: calculateConfidence(metrics, finalChunks) * (useReranking ? 0.85 : 0.75),
    metadata
  };
}

/**
 * ✅ Single document deep retrieval with optional reranking
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

  // Stage 1: Strategy-specific retrieval
  switch (queryType) {
    case 'narrative':
      chunks = await narrativeRetrieval(embedding, documentIds, keywords, useReranking);
      strategy = 'narrative_contextual';
      break;

    case 'analytical':
      chunks = await analyticalRetrieval(embedding, documentIds, useReranking);
      strategy = 'analytical_diverse';
      break;

    case 'factual':
      chunks = await factualRetrieval(embedding, documentIds, keywords, useReranking);
      strategy = 'factual_precision';
      break;

    case 'thematic':
      chunks = await thematicRetrieval(embedding, documentIds, useReranking);
      strategy = 'thematic_comprehensive';
      break;

    default:
      chunks = await hybridRetrieval(embedding, documentIds, keywords, useReranking);
      strategy = 'hybrid_adaptive';
  }

  // ✅ Stage 2: Conditional reranking
  if (useReranking && chunks.length > 15) {
    console.log(`🔍 Reranking ${chunks.length} candidates for query: "${query}"`);
    chunks = await rerankChunks(query, chunks, 15);
    strategy += '_reranked';
  } else if (!useReranking) {
    console.log('📋 Using direct results (no reranking)');
    // Keep more chunks without reranking
    chunks = chunks.slice(0, queryType === 'factual' ? 50 : 40);
    strategy += '_direct';
  }

  const confidence = calculateChunkConfidence(chunks);
  const metadata = buildRetrievalMetadata(chunks, documentIds, chunks.length);

  console.log(`   ✅ Final: ${chunks.length} chunks | ${strategy} | confidence: ${(confidence * 100).toFixed(1)}%`);

  return { chunks, strategy, confidence, metadata };
}

/**
 * ✅ NARRATIVE RETRIEVAL with optional reranking support
 */
async function narrativeRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. Critical early content
  const { data: earlyChunks } = await supabaseAdmin
    .from('embeddings')
    .select('*')
    .in('document_id', documentIds)
    .lte('page_number', 25)
    .order('page_number', { ascending: true })
    .limit(useReranking ? 12 : 20); // ✅ More without reranking

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
  const vectorResults = await searchSimilarChunks(
    embedding, 
    documentIds, 
    useReranking ? 100 : 150 // ✅ More without reranking
  );
  
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, useReranking ? 30 : 50) // ✅ More without reranking
    .forEach(c => {
      if (!chunkMap.has(c.chunk_text) || c.similarity > (chunkMap.get(c.chunk_text)?.similarity || 0)) {
        chunkMap.set(c.chunk_text, { ...c, source: 'vector_match' });
      }
    });

  // 3. Sequential context expansion
  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 10 : 15); // ✅ More without reranking

  for (const chunk of topChunks) {
    const { data: neighbors } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', chunk.page_number - 1)
      .lte('page_number', chunk.page_number + 1)
      .neq('chunk_text', chunk.chunk_text)
      .limit(useReranking ? 4 : 6); // ✅ More without reranking

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
  for (const keyword of keywords.slice(0, useReranking ? 4 : 6)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 8 : 12); // ✅ More without reranking

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
    .slice(0, useReranking ? 50 : 80); // ✅ More without reranking
}

/**
 * ✅ ANALYTICAL RETRIEVAL with optional reranking support
 */
async function analyticalRetrieval(
  embedding: number[],
  documentIds: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const vectorResults = await searchSimilarChunks(
    embedding, 
    documentIds, 
    useReranking ? 150 : 200 // ✅ More without reranking
  );
  
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
    diverseChunks.push(...chunks.slice(0, useReranking ? 2 : 3)); // ✅ More without reranking
  }

  // Strategy 2: Add high-confidence chunks
  const highConfidence = relevant
    .filter((r: any) => (r.similarity || 0) >= 0.65)
    .slice(0, useReranking ? 15 : 25); // ✅ More without reranking

  const chunkMap = new Map<string, any>();
  [...diverseChunks, ...highConfidence].forEach(c => {
    if (!chunkMap.has(c.chunk_text) || (c.similarity || 0) > (chunkMap.get(c.chunk_text)?.similarity || 0)) {
      chunkMap.set(c.chunk_text, c);
    }
  });

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 45 : 70); // ✅ More without reranking
}

/**
 * ✅ FACTUAL RETRIEVAL with optional reranking support (CRITICAL FOR YOUR USE CASE)
 */
async function factualRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. High-precision vector search
  const vectorResults = await searchSimilarChunks(
    embedding, 
    documentIds, 
    useReranking ? 80 : 150 // ✅ MUCH MORE without reranking
  );
  
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= (useReranking ? 0.40 : 0.30)) // ✅ Lower threshold without reranking
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. ✅ COMPREHENSIVE keyword matching (CRITICAL FOR "FIND ALL" QUERIES)
  for (const keyword of keywords.slice(0, useReranking ? 5 : 10)) {
    const { data: exactMatches } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 10 : 30); // ✅ MANY MORE without reranking

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

  // 3. Cross-reference validation
  const topChunks = Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 8 : 15); // ✅ More without reranking

  for (const chunk of topChunks) {
    const { data: relatedChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', chunk.document_id)
      .gte('page_number', Math.max(1, chunk.page_number - 2))
      .lte('page_number', chunk.page_number + 2)
      .neq('chunk_text', chunk.chunk_text)
      .limit(useReranking ? 3 : 5); // ✅ More without reranking

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
    .slice(0, useReranking ? 40 : 100); // ✅ UP TO 100 CHUNKS without reranking!
}

/**
 * ✅ THEMATIC RETRIEVAL with optional reranking support
 */
async function thematicRetrieval(
  embedding: number[],
  documentIds: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. High-quality vector matches
  const vectorResults = await searchSimilarChunks(
    embedding, 
    documentIds, 
    useReranking ? 120 : 180 // ✅ More without reranking
  );
  
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.32)
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. Strategic document sampling
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
        .limit(useReranking ? 6 : 10); // ✅ More without reranking

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
    .slice(0, useReranking ? 50 : 80); // ✅ More without reranking
}

/**
 * ✅ HYBRID RETRIEVAL with optional reranking support
 */
async function hybridRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[],
  useReranking: boolean = true
): Promise<any[]> {
  const chunkMap = new Map<string, any>();

  // 1. Strong vector search
  const vectorResults = await searchSimilarChunks(
    embedding, 
    documentIds, 
    useReranking ? 100 : 150 // ✅ More without reranking
  );
  
  vectorResults
    .filter((r: any) => (r.similarity || 0) >= 0.35)
    .slice(0, useReranking ? 35 : 55) // ✅ More without reranking
    .forEach(c => chunkMap.set(c.chunk_text, c));

  // 2. Keyword support
  for (const keyword of keywords.slice(0, useReranking ? 3 : 5)) {
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(useReranking ? 8 : 15); // ✅ More without reranking

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
  const diverse = applyDiversitySampling(
    Array.from(chunkMap.values()), 
    useReranking ? 15 : 25 // ✅ More without reranking
  );
  diverse.forEach(c => chunkMap.set(c.chunk_text, c));

  return Array.from(chunkMap.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, useReranking ? 45 : 70); // ✅ More without reranking
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
  
  for (const [docId, docChunks] of docGroups.entries()) {
    balanced.push(...docChunks.slice(0, minPerDoc));
  }

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
    diverse.push(group[0]);
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
  
  return Math.max(avgScore, chunks.length >= 10 ? 0.65 : 0.55);
}