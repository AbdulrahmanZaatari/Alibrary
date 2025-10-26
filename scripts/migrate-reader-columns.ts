import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'data.db');
const db = new Database(dbPath);

console.log('🔄 Starting database migration for reader mode...\n');
console.log('📁 Database path:', dbPath);

// ✅ FORCE CHECK: Verify tables exist
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('📋 Existing tables:', tables.map((t: any) => t.name).join(', '));
} catch (error: any) {
  console.error('❌ Cannot read database:', error.message);
  process.exit(1);
}

// ✅ Migrate chat_sessions
try {
  const tableInfo = db.pragma('table_info(chat_sessions)') as { name: string }[];
  console.log('📊 Current chat_sessions columns:', tableInfo.map(c => c.name).join(', '));
  
  const hasBookId = tableInfo.some((col) => col.name === 'book_id');
  
  if (hasBookId) {
    console.log('✅ book_id already exists in chat_sessions');
  } else {
    console.log('📝 Adding book_id to chat_sessions...');
    db.exec('ALTER TABLE chat_sessions ADD COLUMN book_id TEXT;');
    console.log('✅ Successfully added book_id');
  }
  
  const hasBookTitle = tableInfo.some((col) => col.name === 'book_title');
  if (!hasBookTitle) {
    console.log('📝 Adding book_title to chat_sessions...');
    db.exec('ALTER TABLE chat_sessions ADD COLUMN book_title TEXT;');
    console.log('✅ Successfully added book_title');
  }
} catch (error: any) {
  console.error('❌ Error migrating chat_sessions:', error.message);
}

// ✅ Migrate chat_messages
try {
  const tableInfo = db.pragma('table_info(chat_messages)') as { name: string }[];
  console.log('\n📊 Current chat_messages columns:', tableInfo.map(c => c.name).join(', '));
  
  const columns = ['book_id', 'book_title', 'book_page', 'extracted_text'];
  
  for (const col of columns) {
    const exists = tableInfo.some((c) => c.name === col);
    if (!exists) {
      const type = col === 'book_page' ? 'INTEGER' : 'TEXT';
      console.log(`📝 Adding ${col} to chat_messages...`);
      db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col} ${type};`);
      console.log(`✅ Successfully added ${col}`);
    } else {
      console.log(`✅ ${col} already exists`);
    }
  }
} catch (error: any) {
  console.error('❌ Error migrating chat_messages:', error.message);
}

console.log('\n✅ Migration complete!\n');

// ✅ VERIFY FINAL STATE
try {
  const sessionsInfo = db.pragma('table_info(chat_sessions)') as { name: string }[];
  const messagesInfo = db.pragma('table_info(chat_messages)') as { name: string }[];
  
  console.log('📋 Final chat_sessions columns:', sessionsInfo.map(c => c.name).join(', '));
  console.log('📋 Final chat_messages columns:', messagesInfo.map(c => c.name).join(', '));
} catch (error: any) {
  console.error('❌ Verification error:', error.message);
}

db.close();
console.log('\n🎯 Restart your dev server now!\n');
process.exit(0);