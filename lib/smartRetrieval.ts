import { embedText } from './gemini';
import { searchSimilarChunks } from './vectorStore';
import { createClient } from '@supabase/supabase-js';
import { retrieveBalancedCorpus, assessRetrievalQuality } from './multiDocRetrieval';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RetrievalResult {
  chunks: any[];
  strategy: string;
  confidence: number;
}

/**
 * Retrieve context based on query type with multi-document support
 */
export async function retrieveSmartContext(
  queryAnalysis: any,
  documentIds: string[]
): Promise<RetrievalResult> {
  const { expandedQuery, queryType, keywords, isMultiDocumentQuery } = queryAnalysis;

  console.log(`🎯 Retrieval strategy for "${queryType}" question`);

  // Generate embedding from expanded query
  const embedding = await embedText(expandedQuery);

  const isMultiDoc = documentIds.length > 1;

  // ✅ PRIORITY 1: Comparative multi-document strategy
  if (isMultiDoc && isMultiDocumentQuery) {
    console.log('🔄 Using COMPARATIVE multi-document strategy');
    
    const chunks = await retrieveBalancedCorpus(
      embedding,
      documentIds,
      {
        chunksPerDoc: 15,
        totalChunks: 50,
        ensureAllDocs: true,
      }
    );
    
    const metrics = assessRetrievalQuality(chunks, documentIds);
    
    return {
      chunks,
      strategy: 'comparative_balanced',
      confidence: metrics.coverageRatio * 0.9,
    };
  }

  // ✅ PRIORITY 2: Multi-document (non-comparative)
  if (isMultiDoc) {
    console.log('🔄 Using multi-document balanced strategy');
    
    const chunks = await retrieveBalancedCorpus(
      embedding,
      documentIds,
      {
        chunksPerDoc: 10,
        totalChunks: 35,
        ensureAllDocs: true,
      }
    );
    
    const metrics = assessRetrievalQuality(chunks, documentIds);
    
    return {
      chunks,
      strategy: 'multi_document_balanced',
      confidence: metrics.coverageRatio * 0.85,
    };
  }

  // ✅ Single document strategies
  let chunks: any[] = [];
  let strategy = 'hybrid';
  let confidence = 0;

  switch (queryType) {
    case 'narrative':
      chunks = await narrativeRetrieval(embedding, documentIds, keywords);
      strategy = 'narrative_focused';
      break;

    case 'analytical':
      chunks = await analyticalRetrieval(embedding, documentIds);
      strategy = 'analytical_diverse';
      break;

    case 'factual':
      chunks = await factualRetrieval(embedding, documentIds, keywords);
      strategy = 'factual_precise';
      break;

    case 'thematic':
      chunks = await thematicRetrieval(embedding, documentIds);
      strategy = 'thematic_comprehensive';
      break;

    default:
      chunks = await searchSimilarChunks(embedding, documentIds, 50);
      strategy = 'standard_vector';
  }

  // Calculate confidence based on top similarity scores
  if (chunks.length > 0) {
    const topScores = chunks.slice(0, 5).map(c => c.similarity || 0);
    confidence = topScores.reduce((a, b) => a + b, 0) / topScores.length;
  }

  console.log(`   ✅ Retrieved ${chunks.length} chunks using ${strategy} (confidence: ${(confidence * 100).toFixed(1)}%)`);

  return { chunks, strategy, confidence };
}

/**
 * Narrative retrieval using Supabase
 */
async function narrativeRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[]
): Promise<any[]> {
  const chunks: any[] = [];

  // 1. Get early chapters
  const { data: earlyChunks, error } = await supabaseAdmin
    .from('embeddings')
    .select('*')
    .in('document_id', documentIds)
    .lte('page_number', 20)
    .order('page_number', { ascending: true })
    .limit(15);

  if (!error && earlyChunks) {
    chunks.push(...earlyChunks.map(c => ({ 
      ...c, 
      source: 'early_chapters', 
      similarity: 0.6 
    })));
  }

  // 2. Vector search
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 50);
  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.3);
  chunks.push(...relevant.slice(0, 25));

  // 3. Keyword matching
  for (const keyword of keywords.slice(0, 3)) { // Limit keywords to avoid too many queries
    const { data: keywordChunks } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .in('document_id', documentIds)
      .ilike('chunk_text', `%${keyword}%`)
      .limit(10);

    if (keywordChunks) {
      chunks.push(...keywordChunks.map(c => ({ 
        ...c, 
        source: 'keyword_match', 
        similarity: 0.5 
      })));
    }
  }

  const uniqueChunks = Array.from(
    new Map(chunks.map(c => [c.chunk_text, c])).values()
  );

  return uniqueChunks.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 40);
}

/**
 * Analytical retrieval: diverse chunks
 */
async function analyticalRetrieval(
  embedding: number[],
  documentIds: string[]
): Promise<any[]> {
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 100);
  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.35);

  const pageGroups = new Map<number, any[]>();
  for (const chunk of relevant) {
    const pageGroup = Math.floor(chunk.page_number / 10) * 10;
    if (!pageGroups.has(pageGroup)) {
      pageGroups.set(pageGroup, []);
    }
    pageGroups.get(pageGroup)!.push(chunk);
  }

  const diverse: any[] = [];
  for (const chunks of pageGroups.values()) {
    diverse.push(...chunks.slice(0, 2));
  }

  return diverse.slice(0, 30);
}

/**
 * Factual retrieval: precise matching
 */
async function factualRetrieval(
  embedding: number[],
  documentIds: string[],
  keywords: string[]
): Promise<any[]> {
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 50);
  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.5);

  return relevant.slice(0, 20);
}

/**
 * Thematic retrieval using Supabase
 */
async function thematicRetrieval(
  embedding: number[],
  documentIds: string[]
): Promise<any[]> {
  const chunks: any[] = [];

  // 1. Vector search
  const vectorResults = await searchSimilarChunks(embedding, documentIds, 80);
  const relevant = vectorResults.filter((r: any) => (r.similarity || 0) >= 0.35);
  chunks.push(...relevant);

  // 2. Sample from beginning, middle, end
  const { data: maxPageData } = await supabaseAdmin
    .from('embeddings')
    .select('page_number')
    .in('document_id', documentIds)
    .order('page_number', { ascending: false })
    .limit(1);

  if (maxPageData && maxPageData.length > 0) {
    const maxPage = maxPageData[0].page_number;
    const sections = [
      { start: 1, end: Math.floor(maxPage * 0.2) },
      { start: Math.floor(maxPage * 0.4), end: Math.floor(maxPage * 0.6) },
      { start: Math.floor(maxPage * 0.8), end: maxPage }
    ];

    for (const section of sections) {
      const { data: sectionChunks } = await supabaseAdmin
        .from('embeddings')
        .select('*')
        .in('document_id', documentIds)
        .gte('page_number', section.start)
        .lte('page_number', section.end)
        .limit(5);

      if (sectionChunks) {
        chunks.push(...sectionChunks.map(c => ({ 
          ...c, 
          source: 'section_sample', 
          similarity: 0.4 
        })));
      }
    }
  }

  const uniqueChunks = Array.from(
    new Map(chunks.map(c => [c.chunk_text, c])).values()
  );

  return uniqueChunks.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 35);
}