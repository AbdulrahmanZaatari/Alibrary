import path from 'path'; 
import { supabaseAdmin } from '../lib/supabase';

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

async function fixCorruptedChunks() {
  console.log('🧹 Finding and fixing corrupted chunks...\n');
  
  const corruptionPatterns = [
   'Ibn-IJazm',
   'Ibn-IIazm',
   'Da\'ftd',
   'Daftd',
   '1).adith', 
   'J:Iadith',
   'Proven<;al',
   '$ufi',
   'Jamali',
   'Jamali-Sunni',
  ];
  
  let totalFixed = 0;
  
  for (const pattern of corruptionPatterns) {
   console.log(`\n🔍 Searching for: "${pattern}"`);
   
   const { data: chunks, error } = await supabaseAdmin
    .from('embeddings')
    .select('id, chunk_text, document_id, page_number')
    .ilike('chunk_text', `%${pattern}%`);
   
   if (error) {
    console.error('❌ Search error:', error);
    continue;
   }
   
   if (!chunks || chunks.length === 0) {
    console.log(' ✓ No corrupted chunks found');
    continue;
   }
   
   console.log(` ⚠️ Found ${chunks.length} corrupted chunks`);
   
   for (const chunk of chunks) {
    let fixed = chunk.chunk_text;
    
    const fixes: Record<string, string> = {
     'Ibn-IJazm': 'Ibn Ḥazm',
     'Ibn-IIazm': 'Ibn Ḥazm',
     'Da\'ftd': 'Dāwūd',
     'Daftd': 'Dāwūd',
     '1).adith': 'Ḥadīth',
     'J:Iadith': 'Ḥadīth',
     'Proven<;al': 'Provençal',
     '$ufi': 'Sufi',
        // ADDED singular 'Jamali' fix
        'Jamali': 'Jama\'i', 
     'Jamali-Sunni': 'Jama\'i-Sunni',
    };
    
    for (const [corrupt, correct] of Object.entries(fixes)) {
     fixed = fixed.replace(new RegExp(escapeRegExp(corrupt), 'gi'), correct);
    }
    
    if (fixed !== chunk.chunk_text) {
     const { error: updateError } = await supabaseAdmin
      .from('embeddings')
      .update({ chunk_text: fixed })
      .eq('id', chunk.id);
     
     if (updateError) {
      console.error(` ❌ Failed to update chunk ${chunk.id}:`, updateError);
     } else {
      totalFixed++;
      console.log(` ✓ Fixed chunk on page ${chunk.page_number}`);
     }
    }
   }
  }
  
  console.log(`\n\n✅ Fixed ${totalFixed} corrupted chunks!`);
}

fixCorruptedChunks();