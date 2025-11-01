import { supabaseAdmin } from './supabase';

/**
 * Chunk quality evaluation
 */
interface ChunkQualityMetrics {
  hasSubstantialContent: boolean;
  wordCount: number;
  sentenceCount: number;
  uniquenessScore: number;
}

function evaluateChunkQuality(text: string, allChunks: string[]): ChunkQualityMetrics {
  const trimmed = text.trim();
  
  const wordCount = trimmed.split(/\s+/).length;
  const sentenceCount = (trimmed.match(/[.!?؟]+/g) || []).length;
  
  const uniquenessScore = calculateUniqueness(trimmed, allChunks);
  
  const hasSubstantialContent = 
    trimmed.length >= 150 &&
    wordCount >= 30 &&
    sentenceCount >= 2 &&
    !/^[-_\d\s.]+$/.test(trimmed) &&
    !/^(الباب|الفصل|Chapter|Section)\s+[\u0600-\u06FF\w\s]+$/i.test(trimmed);
  
  return {
    hasSubstantialContent,
    wordCount,
    sentenceCount,
    uniquenessScore
  };
}

function calculateUniqueness(chunk: string, allChunks: string[]): number {
  if (allChunks.length === 0) return 1.0;
  
  const chunkWords = new Set(chunk.toLowerCase().split(/\s+/));
  let maxSimilarity = 0;
  
  for (const other of allChunks) {
    if (other === chunk) continue;
    
    const otherWords = new Set(other.toLowerCase().split(/\s+/));
    const intersection = new Set([...chunkWords].filter(w => otherWords.has(w)));
    const similarity = intersection.size / Math.min(chunkWords.size, otherWords.size);
    
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }
  
  return 1 - maxSimilarity;
}

/**
 * Clean up existing poor-quality embeddings (one-time script)
 * Run this for documents that already have embeddings
 */
export async function cleanupPoorQualityEmbeddings(documentId: string) {
  console.log('🧹 Starting cleanup of poor-quality embeddings...');
  console.log(`   Document ID: ${documentId}`);
  
  // Fetch all chunks for this document
  const { data: chunks, error } = await supabaseAdmin
    .from('embeddings')
    .select('*')
    .eq('document_id', documentId);
  
  if (error || !chunks) {
    console.error('❌ Failed to fetch chunks:', error);
    return { success: false, error };
  }
  
  console.log(`📊 Found ${chunks.length} chunks to analyze`);
  
  const chunkTexts = chunks.map(c => c.chunk_text);
  const toDelete: string[] = [];
  const toKeep: string[] = [];
  
  for (const chunk of chunks) {
    const metrics = evaluateChunkQuality(chunk.chunk_text, chunkTexts);
    
    // Delete if low quality or near-duplicate
    if (!metrics.hasSubstantialContent || metrics.uniquenessScore < 0.3) {
      toDelete.push(chunk.id);
      console.log(`   ✗ Marking for deletion (quality: ${(metrics.uniquenessScore * 100).toFixed(1)}%): "${chunk.chunk_text.substring(0, 50)}..."`);
    } else {
      toKeep.push(chunk.id);
      console.log(`   ✓ Keeping (quality: ${(metrics.uniquenessScore * 100).toFixed(1)}%)`);
    }
  }
  
  console.log('\n📊 Cleanup Summary:');
  console.log(`   - Total chunks analyzed: ${chunks.length}`);
  console.log(`   - Chunks to keep: ${toKeep.length}`);
  console.log(`   - Chunks to delete: ${toDelete.length}`);
  
  if (toDelete.length > 0) {
    console.log('\n🗑️ Deleting poor-quality chunks...');
    
    const { error: deleteError } = await supabaseAdmin
      .from('embeddings')
      .delete()
      .in('id', toDelete);
    
    if (deleteError) {
      console.error('❌ Deletion failed:', deleteError);
      return { success: false, error: deleteError };
    } else {
      console.log(`✅ Successfully deleted ${toDelete.length} poor-quality chunks`);
      console.log(`📊 Remaining high-quality chunks: ${toKeep.length}`);
      
      return { 
        success: true, 
        deleted: toDelete.length, 
        remaining: toKeep.length 
      };
    }
  } else {
    console.log('✅ No poor-quality chunks found - all chunks are good!');
    return { 
      success: true, 
      deleted: 0, 
      remaining: chunks.length 
    };
  }
}

/**
 * Clean up all documents in the database
 */
export async function cleanupAllDocuments() {
  console.log('🧹 Starting cleanup of ALL documents...\n');
  
  // Get all unique document IDs
  const { data: uniqueDocs, error } = await supabaseAdmin
    .from('embeddings')
    .select('document_id')
    .neq('document_id', null);
  
  if (error || !uniqueDocs) {
    console.error('❌ Failed to fetch documents:', error);
    return;
  }
  
  const documentIds = [...new Set(uniqueDocs.map(d => d.document_id))];
  console.log(`📚 Found ${documentIds.length} documents to clean\n`);
  
  const results = [];
  
  for (let i = 0; i < documentIds.length; i++) {
    const docId = documentIds[i];
    console.log(`\n========================================`);
    console.log(`Processing document ${i + 1}/${documentIds.length}`);
    console.log(`========================================`);
    
    const result = await cleanupPoorQualityEmbeddings(docId);
    results.push({ documentId: docId, ...result });
    
    // Add delay between documents to avoid rate limits
    if (i < documentIds.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next document...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final summary
  console.log('\n\n========================================');
  console.log('🎉 CLEANUP COMPLETE');
  console.log('========================================');
  
  const totalDeleted = results.reduce((sum, r) => sum + (r.deleted || 0), 0);
  const totalRemaining = results.reduce((sum, r) => sum + (r.remaining || 0), 0);
  
  console.log(`📊 Final Statistics:`);
  console.log(`   - Documents processed: ${documentIds.length}`);
  console.log(`   - Total chunks deleted: ${totalDeleted}`);
  console.log(`   - Total chunks remaining: ${totalRemaining}`);
  console.log(`   - Quality improvement: ${((totalDeleted / (totalDeleted + totalRemaining)) * 100).toFixed(1)}% removed`);
  
  return results;
}