import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getDb } from '../lib/db';

async function cleanDuplicateMessages() {
  console.log('🧹 Cleaning duplicate messages...\n');
  
  const db = getDb();
  
  // Find duplicates (same content, role, session within 2 seconds)
  const duplicates = db.prepare(`
    SELECT 
      m1.id as keep_id,
      m2.id as delete_id,
      m1.content,
      m1.role,
      m1.session_id
    FROM chat_messages m1
    JOIN chat_messages m2 
      ON m1.session_id = m2.session_id
      AND m1.content = m2.content
      AND m1.role = m2.role
      AND m1.id < m2.id
      AND ABS(strftime('%s', m1.created_at) - strftime('%s', m2.created_at)) < 2
  `).all();
  
  console.log(`Found ${duplicates.length} duplicate messages`);
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicates found!');
    return;
  }
  
  // Delete duplicates
  const deleteIds = duplicates.map((d: any) => d.delete_id);
  const placeholders = deleteIds.map(() => '?').join(',');
  
  db.prepare(`DELETE FROM chat_messages WHERE id IN (${placeholders})`).run(...deleteIds);
  
  console.log(`✅ Deleted ${duplicates.length} duplicate messages`);
}

cleanDuplicateMessages().catch(console.error);