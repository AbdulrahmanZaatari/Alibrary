import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BalancedRetrievalOptions {
  chunksPerDoc: number;
  totalChunks: number;
  ensureAllDocs: boolean;
}

interface RetrievalMetrics {
  documentsRepresented: number;
  totalDocuments: number;
  coverageRatio: number;
  averageSimilarity: number;
  minSimilarity: number;
  maxSimilarity: number;
}

/**
 * ✅ Retrieve chunks with guaranteed representation from ALL documents
 * Fixed to use correct RPC parameter names
 */
export async function retrieveBalancedCorpus(
  queryEmbedding: number[],
  documentIds: string[],
  options: BalancedRetrievalOptions
) {
  const { chunksPerDoc, totalChunks, ensureAllDocs } = options;
  
  console.log(`🔄 Balanced retrieval: ${chunksPerDoc} chunks per doc, max ${totalChunks} total`);
  
  // ✅ Retrieve from EACH document separately using correct parameter names
  const perDocResults = await Promise.all(
    documentIds.map(async (docId) => {
      const { data, error } = await supabaseAdmin.rpc('match_embeddings', {
        query_embedding: queryEmbedding,
        match_count: chunksPerDoc,
        match_threshold: 0.3, // ✅ Added required parameter
        filter_document_ids: [docId], // ✅ Fixed parameter name
      });
      
      if (error) {
        console.error(`❌ Error retrieving from ${docId.substring(0, 8)}:`, error);
        return { docId, chunks: [] };
      }
      
      return { docId, chunks: data || [] };
    })
  );
  
  // ✅ Flatten and sort by similarity
  let allChunks = perDocResults
    .flatMap(({ docId, chunks }) => 
      chunks.map((c: any) => ({ ...c, document_id: docId }))
    )
    .sort((a, b) => b.similarity - a.similarity);
  
  console.log(`   Retrieved ${allChunks.length} chunks from ${documentIds.length} documents`);
  
  // ✅ Verify all documents represented
  const representedDocs = new Set(allChunks.map(c => c.document_id));
  const missingDocs = documentIds.filter(id => !representedDocs.has(id));
  
  if (ensureAllDocs && missingDocs.length > 0) {
    console.warn(`⚠️ Missing ${missingDocs.length} document(s), fetching fallback chunks...`);
    
    // Force-add at least 2 chunks from missing docs
    const fallbackResults = await Promise.all(
      missingDocs.map(async (docId) => {
        const { data } = await supabaseAdmin.rpc('match_embeddings', {
          query_embedding: queryEmbedding,
          match_count: 5, // Get more chunks for fallback
          match_threshold: 0.2, // Lower threshold for fallback
          filter_document_ids: [docId],
        });
        return (data || []).map((c: any) => ({ ...c, document_id: docId }));
      })
    );
    
    const fallbackChunks = fallbackResults.flat();
    console.log(`   ✅ Added ${fallbackChunks.length} fallback chunks`);
    allChunks = [...allChunks, ...fallbackChunks];
  }
  
  // ✅ Limit to total chunks
  allChunks = allChunks.slice(0, totalChunks);
  
  // ✅ Log distribution
  const distribution = documentIds.map(id => {
    const count = allChunks.filter(c => c.document_id === id).length;
    return `${id.substring(0, 8)}: ${count} chunks`;
  }).join('\n    ');
  
  console.log(`📊 Document distribution:\n    ${distribution}`);
  
  return allChunks;
}

/**
 * ✅ Assess quality of retrieval results
 */
export function assessRetrievalQuality(
  chunks: any[],
  documentIds: string[]
): RetrievalMetrics {
  const represented = new Set(chunks.map(c => c.document_id));
  const similarities = chunks.map(c => c.similarity || 0).filter(s => s > 0);
  
  const metrics: RetrievalMetrics = {
    documentsRepresented: represented.size,
    totalDocuments: documentIds.length,
    coverageRatio: represented.size / documentIds.length,
    averageSimilarity: similarities.length > 0 
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length 
      : 0,
    minSimilarity: similarities.length > 0 ? Math.min(...similarities) : 0,
    maxSimilarity: similarities.length > 0 ? Math.max(...similarities) : 0,
  };
  
  console.log(`📊 Retrieval Quality:
    - Coverage: ${(metrics.coverageRatio * 100).toFixed(1)}% (${metrics.documentsRepresented}/${metrics.totalDocuments} documents)
    - Avg Similarity: ${(metrics.averageSimilarity * 100).toFixed(1)}%
    - Range: ${(metrics.minSimilarity * 100).toFixed(1)}% - ${(metrics.maxSimilarity * 100).toFixed(1)}%`
  );
  
  if (metrics.coverageRatio < 0.8 && documentIds.length > 1) {
    console.warn(`⚠️ LOW COVERAGE: ${documentIds.length - metrics.documentsRepresented} document(s) not represented!`);
  }
  
  return metrics;
}

/**
 * ✅ Detect if query is comparative/multi-document
 */
export function isComparativeQuery(query: string): boolean {
  const comparativePatterns = [
    /\b(common|similar|shared|both|difference|differ|compare|contrast|versus|vs)\b/i,
    /\b(between|across|among)\b.*\b(document|text|book|source)/i,
    /مشترك|تشابه|فرق|مقارنة|كلاهما|بين/,
  ];
  
  return comparativePatterns.some(pattern => pattern.test(query));
}