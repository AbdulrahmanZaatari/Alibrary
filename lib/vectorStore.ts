import { supabaseAdmin } from './supabase';
import { embedText } from './gemini';

export interface VectorChunk {
  documentId: string;
  chunkText: string;
  pageNumber: number;
  embedding: number[];
  metadata?: any;
}

/**
 * Insert embeddings into Supabase
 */
export const insertEmbeddings = async (embeddings: Array<{
  document_id: string;
  chunk_text: string;
  page_number: number;
  embedding: number[];
}>) => {
  console.log(`💾 Inserting ${embeddings.length} embeddings into Supabase...`);
  
  const { data, error } = await supabaseAdmin
    .from('embeddings')
    .insert(embeddings);

  if (error) {
    console.error('❌ Error inserting embeddings:', error);
    throw error;
  }

  console.log(`✅ Successfully inserted ${embeddings.length} embeddings`);
  return data;
};

/**
 * ✅ UPDATED: Search similar chunks with correct RPC parameters
 * @param queryEmbedding - The query embedding vector
 * @param documentIds - Array of document IDs to search within
 * @param limit - Maximum number of results to return
 * @param threshold - Minimum similarity threshold (default 0.3)
 */
export const searchSimilarChunks = async (
  queryEmbedding: number[],
  documentIds: string[],
  limit: number = 50,
  threshold: number = 0.3
): Promise<any[]> => {
  console.log('🔍 Vector Search Started:');
  console.log(`  - Searching ${documentIds.length} document(s)`);
  console.log(`  - Query embedding dimension: ${queryEmbedding.length}`);
  console.log(`  - Limit: ${limit}`);
  console.log(`  - Threshold: ${threshold}`);

  try {
    // Check if chunks exist for these documents
    const { data: chunkCheck, error: checkError } = await supabaseAdmin
      .from('embeddings')
      .select('id, document_id, page_number', { count: 'exact' })
      .in('document_id', documentIds)
      .limit(5);

    if (checkError) {
      console.error('❌ Error checking chunks:', checkError);
    } else {
      console.log(`  - Found ${chunkCheck?.length || 0} chunks in database for these documents`);
      if (chunkCheck && chunkCheck.length > 0) {
        console.log(`  - Sample pages: ${chunkCheck.map(c => c.page_number).join(', ')}`);
      }
    }

    // ✅ Call RPC with correct parameter names
    const { data, error } = await supabaseAdmin.rpc('match_embeddings', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      filter_document_ids: documentIds, // ✅ Correct parameter name
    });

    if (error) {
      console.error('❌ Vector search RPC error:', error);
      
      if (error.message?.includes('function match_embeddings does not exist') || 
          error.code === 'PGRST202') {
        console.error('⚠️ Database function missing or has wrong signature!');
        console.error('📝 Run this SQL in Supabase SQL Editor:');
        console.error(`
-- Drop old function if exists
DROP FUNCTION IF EXISTS match_embeddings(vector, float, int, text[]);

-- Create new function with correct signature
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_document_ids text[]
)
RETURNS TABLE (
  id uuid,
  document_id text,
  chunk_text text,
  page_number int,
  similarity float,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    embeddings.id,
    embeddings.document_id,
    embeddings.chunk_text,
    embeddings.page_number,
    1 - (embeddings.embedding <=> query_embedding) AS similarity,
    embeddings.metadata
  FROM embeddings
  WHERE 
    embeddings.document_id = ANY(filter_document_ids)
    AND 1 - (embeddings.embedding <=> query_embedding) >= match_threshold
  ORDER BY embeddings.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
        `);
      }
      
      return [];
    }

    console.log(`  - Results found: ${data?.length || 0}`);
    
    if (data && data.length > 0) {
      console.log(`  - Top result similarity: ${data[0].similarity?.toFixed(3)}`);
      console.log(`  - Lowest result similarity: ${data[data.length - 1].similarity?.toFixed(3)}`);
      console.log(`  - Top result page: ${data[0].page_number}`);
      console.log(`  - Text preview: ${data[0].chunk_text.substring(0, 100)}...`);
      
      // Log similarity distribution
      const highSim = data.filter((r: any) => r.similarity > 0.7).length;
      const medSim = data.filter((r: any) => r.similarity > 0.5 && r.similarity <= 0.7).length;
      const lowSim = data.filter((r: any) => r.similarity > 0.3 && r.similarity <= 0.5).length;
      
      console.log(`  - Similarity distribution:`);
      console.log(`    > 0.7 (high): ${highSim}`);
      console.log(`    0.5-0.7 (medium): ${medSim}`);
      console.log(`    0.3-0.5 (low): ${lowSim}`);
    } else {
      console.warn('⚠️ No results found!');
      console.warn('   Possible reasons:');
      console.warn('   - No chunks exist for these documents');
      console.warn('   - Similarity scores below threshold');
      console.warn('   - Query embedding mismatch');
    }

    return data || [];
  } catch (error) {
    console.error('❌ Search error:', error);
    return [];
  }
};

/**
 * Search embeddings for a single document
 */
export const searchSingleDocument = async (
  queryEmbedding: number[],
  documentId: string,
  limit: number = 30,
  threshold: number = 0.3
): Promise<any[]> => {
  return searchSimilarChunks(queryEmbedding, [documentId], limit, threshold);
};

/**
 * Get all chunks for a document (for browsing/export)
 */
export const getAllDocumentChunks = async (documentId: string): Promise<any[]> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });

    if (error) {
      console.error('❌ Error fetching document chunks:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ Exception fetching document chunks:', error);
    return [];
  }
};

/**
 * Delete all embeddings for a document
 */
export const deleteDocumentEmbeddings = async (documentId: string) => {
  console.log(`🗑️ Deleting embeddings for document: ${documentId}`);
  
  const { error } = await supabaseAdmin
    .from('embeddings')
    .delete()
    .eq('document_id', documentId);

  if (error) {
    console.error('❌ Error deleting embeddings:', error);
    throw error;
  }
  
  console.log('✅ Embeddings deleted successfully');
};

/**
 * Get statistics about document embeddings
 */
export const getDocumentEmbeddingStats = async (documentId: string) => {
  const { data, error, count } = await supabaseAdmin
    .from('embeddings')
    .select('page_number', { count: 'exact' })
    .eq('document_id', documentId);

  if (error) throw error;

  const pages = data?.map(d => d.page_number) || [];
  const uniquePages = [...new Set(pages)];

  return {
    totalChunks: count || 0,
    totalPages: uniquePages.length,
    pages: uniquePages.sort((a, b) => a - b)
  };
};

/**
 * Add chunks to vector store
 */
export const addChunksToVectorStore = async (chunks: VectorChunk[]) => {
  console.log(`💾 Storing ${chunks.length} chunks to Supabase...`);
  
  const { data, error } = await supabaseAdmin
    .from('embeddings')
    .insert(chunks.map(chunk => ({
      document_id: chunk.documentId,
      chunk_text: chunk.chunkText,
      page_number: chunk.pageNumber,
      embedding: chunk.embedding,
      metadata: chunk.metadata || {}
    })));

  if (error) {
    console.error('❌ Error storing chunks:', error);
    throw error;
  }
  
  console.log(`✅ Successfully stored ${chunks.length} chunks`);
  return data;
};

/**
 * Process and embed entire document
 */
export const processAndEmbedDocument = async (
  documentId: string,
  pageTexts: { pageNumber: number; text: string }[]
) => {
  const allChunks: VectorChunk[] = [];
  let processedChunks = 0;

  console.log(`📄 Processing ${pageTexts.length} pages for embedding...`);

  for (const page of pageTexts) {
    if (!page.text || page.text.length < 10) {
      console.warn(`⚠️ Skipping page ${page.pageNumber} (insufficient text)`);
      continue;
    }

    const textChunks = chunkText(page.text, 500, 50);

    for (const chunk of textChunks) {
      try {
        const embedding = await embedText(chunk);
        
        allChunks.push({
          documentId,
          chunkText: chunk,
          pageNumber: page.pageNumber,
          embedding,
          metadata: {
            length: chunk.length,
            byteSize: new TextEncoder().encode(chunk).length,
            timestamp: new Date().toISOString()
          }
        });

        processedChunks++;
        
        if (processedChunks % 10 === 0) {
          console.log(`  - Processed ${processedChunks} chunks...`);
        }
      } catch (error) {
        console.error(`❌ Error embedding chunk from page ${page.pageNumber}:`, error);
      }
    }
  }

  if (allChunks.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, Math.min(i + batchSize, allChunks.length));
      await addChunksToVectorStore(batch);
      console.log(`  - Stored batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`);
    }
  }

  console.log(`✅ Embedding complete: ${allChunks.length} chunks stored`);
  return allChunks.length;
};

/**
 * Split text into overlapping chunks
 */
function chunkText(text: string, maxChars: number = 500, overlap: number = 50): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const chunk = text.slice(start, end);
    
    const byteSize = new TextEncoder().encode(chunk).length;
    
    // If chunk is too large (>30KB), split it in half
    if (byteSize > 30000) {
      const halfChunk = text.slice(start, start + Math.floor(maxChars / 2));
      chunks.push(halfChunk.trim());
      start += Math.floor(maxChars / 2) - overlap;
    } else {
      chunks.push(chunk.trim());
      start = end - overlap;
    }
  }

  return chunks.filter(c => c.length > 10);
}

/**
 * ✅ Batch search for multiple queries (useful for re-ranking)
 */
export const batchSearchSimilarChunks = async (
  queryEmbeddings: number[][],
  documentIds: string[],
  limitPerQuery: number = 20
): Promise<any[][]> => {
  console.log(`🔍 Batch vector search: ${queryEmbeddings.length} queries`);
  
  const results = await Promise.all(
    queryEmbeddings.map(embedding => 
      searchSimilarChunks(embedding, documentIds, limitPerQuery)
    )
  );
  
  return results;
};

/**
 * ✅ Get chunks by page range
 */
export const getChunksByPageRange = async (
  documentId: string,
  startPage: number,
  endPage: number
): Promise<any[]> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('embeddings')
      .select('*')
      .eq('document_id', documentId)
      .gte('page_number', startPage)
      .lte('page_number', endPage)
      .order('page_number', { ascending: true });

    if (error) {
      console.error('❌ Error fetching page range:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ Exception in getChunksByPageRange:', error);
    return [];
  }
};

/**
 * ✅ Count embeddings per document
 */
export const countEmbeddingsPerDocument = async (
  documentIds: string[]
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  
  for (const docId of documentIds) {
    const { count, error } = await supabaseAdmin
      .from('embeddings')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', docId);
    
    if (!error) {
      counts.set(docId, count || 0);
    }
  }
  
  return counts;
};