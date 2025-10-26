import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'data.db');
const db = new Database(dbPath);

console.log('🔄 Adding document_names column...\n');

try {
  const tableInfo = db.pragma('table_info(chat_messages)') as { name: string }[];
  const hasColumn = tableInfo.some((col) => col.name === 'document_names');
  
  if (!hasColumn) {
    console.log('📝 Adding document_names column to chat_messages...');
    db.exec('ALTER TABLE chat_messages ADD COLUMN document_names TEXT;');
    console.log('✅ Successfully added document_names column');
  } else {
    console.log('✅ document_names column already exists');
  }
} catch (error: any) {
  console.error('❌ Error:', error.message);
}

db.close();
console.log('\n✅ Migration complete!\n');
process.exit(0);