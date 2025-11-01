import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Now import everything else
import { getDb } from '../lib/db';
import { supabaseAdmin } from '../lib/supabase';
import { embedDocumentInBatches } from '../lib/embeddingProcessor';

async function reEmbedAllDocuments() {
  console.log('🔄 Starting re-embedding of all documents...\n');
  
  const db = getDb();
  const documents = db.prepare('SELECT * FROM documents WHERE embedding_status = "completed"').all() as any[];
  
  console.log(`📚 Found ${documents.length} completed documents\n`);
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    console.log(`\n========================================`);
    console.log(`Processing ${i + 1}/${documents.length}: ${doc.display_name}`);
    console.log(`========================================`);
    
    try {
      console.log('🗑️ Deleting old embeddings...');
      const { error: deleteError } = await supabaseAdmin
        .from('embeddings')
        .delete()
        .eq('document_id', doc.id);
      
      if (deleteError) {
        console.error('❌ Delete failed:', deleteError);
        continue;
      }
      
      console.log('🔄 Re-embedding with corrected text...');
      const pdfPath = path.join(process.cwd(), 'public', 'books', doc.filename);
      
      await embedDocumentInBatches(doc.id, pdfPath, (current, total) => {
        if (current % 5 === 0 || current === total) {
          console.log(`  Progress: ${current}/${total} pages`);
        }
      });
      
      console.log(`✅ Successfully re-embedded: ${doc.display_name}`);
      
    } catch (error) {
      console.error(`❌ Error re-embedding ${doc.display_name}:`, error);
    }
    
    if (i < documents.length - 1) {
      console.log('\n⏳ Waiting 10 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('\n\n🎉 Re-embedding complete!');
}

reEmbedAllDocuments();