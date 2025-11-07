import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEFAULT_PROMPTS } from './defaultPrompts';

// ✅ Use persistent volume path on Railway, local path in development
const getDbPath = () => {
  if (process.env.RAILWAY_ENVIRONMENT) {
    // Production on Railway - use persistent volume
    const dbPath = path.join('/data', 'data.db');
    console.log('🚂 Railway environment detected');
    console.log('📁 Database path:', dbPath);
    return dbPath;
  } else {
    // Local development
    const dbDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'data.db');
    console.log('💻 Local environment detected');
    console.log('📁 Database path:', dbPath);
    return dbPath;
  }
};

// ✅ Ensure database directory exists
const dbPath = getDbPath();
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  console.log('📂 Creating database directory:', dbDir);
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

console.log('✅ Database initialized at:', dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    title TEXT NOT NULL,
    size INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    current_page INTEGER DEFAULT 1,
    supabase_path TEXT NOT NULL,
    author TEXT,
    publisher TEXT,
    year TEXT,
    isbn TEXT,
    edition TEXT,
    language TEXT DEFAULT 'Arabic',
    uploaded_at TEXT DEFAULT (datetime('now')),
    last_read TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    book_id TEXT,
    document_id TEXT,
    page_number INTEGER NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    embedding_status TEXT DEFAULT 'pending',
    total_pages INTEGER DEFAULT 0,
    chunks_count INTEGER DEFAULT 0,
    is_selected INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    book_id TEXT,
    book_title TEXT,
    mode TEXT DEFAULT 'general',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    documents_used TEXT,
    document_names TEXT,
    mode TEXT DEFAULT 'general',
    book_id TEXT,
    book_title TEXT,
    book_page INTEGER,
    extracted_text TEXT,
    custom_prompt_name TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    selected_text TEXT,
    comment TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversation_contexts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    keywords TEXT NOT NULL,
    entities TEXT,
    first_mentioned TEXT DEFAULT (datetime('now')),
    last_mentioned TEXT DEFAULT (datetime('now')),
    mention_count INTEGER DEFAULT 1,
    relevance_score REAL DEFAULT 1.0,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_points TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS global_memory (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'default_user',
    topic TEXT NOT NULL,
    context TEXT NOT NULL,
    sessions TEXT NOT NULL,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    frequency INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    is_custom INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    modified_at TEXT DEFAULT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_embeddings_document ON embeddings(document_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_document ON bookmarks(document_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_book ON chat_sessions(book_id);
  CREATE INDEX IF NOT EXISTS idx_contexts_session ON conversation_contexts(session_id);
  CREATE INDEX IF NOT EXISTS idx_contexts_topic ON conversation_contexts(topic);
  CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id);
  CREATE INDEX IF NOT EXISTS idx_global_memory_topic ON global_memory(topic);
  CREATE INDEX IF NOT EXISTS idx_comments_book ON comments(book_id);
  CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(book_id, page_number);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_mode ON chat_sessions(mode);
  CREATE INDEX IF NOT EXISTS idx_books_last_read ON books(last_read DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_book_page ON comments(book_id, page_number);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id, page_number);
  CREATE INDEX IF NOT EXISTS idx_conversation_contexts_session ON conversation_contexts(session_id);
  CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(embedding_status);
`);

// ✅ Add 'mode' column migration
try {
  const chatSessionColumns = db.prepare("PRAGMA table_info(chat_sessions)").all() as Array<{ name: string }>;
  const hasModeColumn = chatSessionColumns.some(col => col.name === 'mode');
  
  if (!hasModeColumn) {
    console.log('🔄 Adding mode column to chat_sessions...');
    db.exec("ALTER TABLE chat_sessions ADD COLUMN mode TEXT DEFAULT 'general'");
    console.log('✅ mode column added');
  }
} catch (error) {
  console.error('Migration error:', error);
}

// ✅ Add modified_at column migration
try {
  const columns = db.prepare("PRAGMA table_info(prompts)").all() as Array<{ name: string }>;
  const hasModifiedAt = columns.some(col => col.name === 'modified_at');
  
  if (!hasModifiedAt) {
    console.log('🔄 Adding modified_at column to prompts...');
    db.exec('ALTER TABLE prompts ADD COLUMN modified_at TEXT DEFAULT NULL');
    console.log('✅ Migration complete');
  }
} catch (error) {
  console.error('Migration error:', error);
}

// ✅ Add book metadata columns migration
try {
  const bookColumns = db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>;
  
  const metadataColumns = ['author', 'publisher', 'year', 'isbn', 'edition', 'language'];
  
  for (const column of metadataColumns) {
    if (!bookColumns.some(col => col.name === column)) {
      console.log(`🔄 Adding ${column} column to books...`);
      const defaultValue = column === 'language' ? " DEFAULT 'Arabic'" : '';
      db.exec(`ALTER TABLE books ADD COLUMN ${column} TEXT${defaultValue}`);
      console.log(`✅ ${column} column added`);
    }
  }
} catch (error) {
  console.error('Books metadata migration error:', error);
}

// ✅ Sync default prompts
console.log('🔄 Syncing default prompts...');

const upsertPrompt = db.prepare(`
  INSERT INTO prompts (id, name, template, category, is_custom, created_at, modified_at)
  VALUES (?, ?, ?, ?, 0, datetime('now'), NULL)
  ON CONFLICT(id) DO UPDATE SET
    name = CASE 
      WHEN modified_at IS NULL THEN excluded.name 
      ELSE name 
    END,
    template = CASE 
      WHEN modified_at IS NULL THEN excluded.template 
      ELSE template 
    END,
    category = CASE 
      WHEN modified_at IS NULL THEN excluded.category 
      ELSE category 
    END
  WHERE is_custom = 0 OR is_custom IS NULL
`);

const syncTransaction = db.transaction((prompts: typeof DEFAULT_PROMPTS) => {
  for (const prompt of prompts) {
    upsertPrompt.run(prompt.id, prompt.name, prompt.template, prompt.category);
  }
});

syncTransaction(DEFAULT_PROMPTS);

const promptCount = db.prepare('SELECT COUNT(*) as count FROM prompts').get() as { count: number };
console.log(`✅ Prompt sync complete: ${promptCount.count} total prompts`);

// ✅ Add custom_prompt_name column migration
try {
  const columns = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  const hasCustomPromptName = columns.some(col => col.name === 'custom_prompt_name');
  
  if (!hasCustomPromptName) {
    console.log('🔄 Adding custom_prompt_name column to chat_messages...');
    db.exec('ALTER TABLE chat_messages ADD COLUMN custom_prompt_name TEXT');
    console.log('✅ Migration complete');
  }
} catch (error) {
  console.error('Migration error:', error);
}

export const getDb = () => db;

// ==================== DOCUMENT FUNCTIONS ====================

export const addDocument = (doc: {
  id: string;
  filename: string;
  displayName: string;
  totalPages: number;
}) => {
  const stmt = db.prepare(`
    INSERT INTO documents (id, filename, display_name, total_pages)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(doc.id, doc.filename, doc.displayName, doc.totalPages);
  return doc.id;
};

export const getDocuments = () => {
  const stmt = db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC');
  return stmt.all();
};

export const getDocumentById = (id: string) => {
  const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
  return stmt.get(id);
};

export const toggleDocumentSelection = (id: string, selected: boolean) => {
  const stmt = db.prepare('UPDATE documents SET is_selected = ? WHERE id = ?');
  return stmt.run(selected ? 1 : 0, id);
};

export const getSelectedDocuments = () => {
  const stmt = db.prepare('SELECT * FROM documents WHERE is_selected = 1');
  return stmt.all();
};

export const updateDocumentName = (id: string, displayName: string) => {
  const stmt = db.prepare('UPDATE documents SET display_name = ?, updated_at = datetime("now") WHERE id = ?');
  return stmt.run(displayName, id);
};

export const updateDocument = (id: string, updates: {
  embedding_status?: string;
  chunks_count?: number;
  display_name?: string;
  [key: string]: string | number | undefined;
}) => {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  
  return db.prepare(`
    UPDATE documents 
    SET ${fields}, updated_at = datetime('now')
    WHERE id = ?
  `).run(...values, id);
};

export const updateDocumentEmbeddingStatus = (
  id: string, 
  status: string, 
  chunksCount: number
) => {
  const stmt = db.prepare(`
    UPDATE documents 
    SET embedding_status = ?, chunks_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(status, chunksCount, id);
};

export const deleteDocument = (id: string) => {
  const stmt = db.prepare('DELETE FROM documents WHERE id = ?');
  return stmt.run(id);
};

// ==================== BOOK FUNCTIONS ====================

export const addBook = (book: {
  id: string;
  filename: string;
  title: string;
  size: number;
  pageCount: number;
  supabasePath: string;
}) => {
  const stmt = db.prepare(`
    INSERT INTO books (id, filename, title, size, page_count, supabase_path, uploaded_at, last_read, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `);
  return stmt.run(
    book.id,
    book.filename,
    book.title,
    book.size,
    book.pageCount,
    book.supabasePath
  );
};

export const getBooks = () => {
  const stmt = db.prepare('SELECT * FROM books ORDER BY last_read DESC, uploaded_at DESC');
  return stmt.all();
};

export const getBookById = (id: string) => {
  const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
  return stmt.get(id);
};

export const updateBookReadingPosition = (id: string, currentPage: number) => {
  const stmt = db.prepare(`
    UPDATE books 
    SET current_page = ?, last_read = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(currentPage, id);
};

export const updateBookMetadata = (id: string, metadata: {
  title?: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  edition?: string;
  language?: string;
}) => {
  const fields = [];
  const values = [];
  
  if (metadata.title !== undefined) {
    fields.push('title = ?');
    values.push(metadata.title);
  }
  if (metadata.author !== undefined) {
    fields.push('author = ?');
    values.push(metadata.author);
  }
  if (metadata.publisher !== undefined) {
    fields.push('publisher = ?');
    values.push(metadata.publisher);
  }
  if (metadata.year !== undefined) {
    fields.push('year = ?');
    values.push(metadata.year);
  }
  if (metadata.isbn !== undefined) {
    fields.push('isbn = ?');
    values.push(metadata.isbn);
  }
  if (metadata.edition !== undefined) {
    fields.push('edition = ?');
    values.push(metadata.edition);
  }
  if (metadata.language !== undefined) {
    fields.push('language = ?');
    values.push(metadata.language);
  }
  
  if (fields.length === 0) return;
  
  fields.push("updated_at = datetime('now')");
  values.push(id);
  
  const stmt = db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
};

export const deleteBook = (id: string) => {
  const stmt = db.prepare('DELETE FROM books WHERE id = ?');
  return stmt.run(id);
};

// ==================== PROMPT FUNCTIONS ====================

export const getPrompts = () => {
  const stmt = db.prepare('SELECT * FROM prompts ORDER BY is_custom DESC, name ASC');
  return stmt.all();
};

export const getPromptsByCategory = (category: string) => {
  const stmt = db.prepare('SELECT * FROM prompts WHERE category = ? ORDER BY name ASC');
  return stmt.all(category);
};

export const addPrompt = (prompt: {
  id: string;
  name: string;
  template: string;
  category: string;
  isCustom: boolean;
}) => {
  const stmt = db.prepare(`
    INSERT INTO prompts (id, name, template, category, is_custom, created_at, modified_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  return stmt.run(
    prompt.id,
    prompt.name,
    prompt.template,
    prompt.category,
    prompt.isCustom ? 1 : 0
  );
};

export const updatePrompt = (id: string, updates: {
  name?: string;
  template?: string;
  category?: string;
}) => {
  const fields = [];
  const values = [];
  
  if (updates.name) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.template) {
    fields.push('template = ?');
    values.push(updates.template);
  }
  if (updates.category) {
    fields.push('category = ?');
    values.push(updates.category);
  }
  
  if (fields.length === 0) return;
  
  fields.push("modified_at = datetime('now')");
  values.push(id);
  
  const stmt = db.prepare(`UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
};

export const deletePrompt = (id: string) => {
  const stmt = db.prepare('DELETE FROM prompts WHERE id = ?');
  return stmt.run(id);
};

// ==================== CHAT HISTORY FUNCTIONS ====================

export const createChatSession = (id: string, name?: string, mode?: string, bookId?: string, bookTitle?: string) => {
  const stmt = db.prepare(`
    INSERT INTO chat_sessions (id, name, mode, book_id, book_title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  return stmt.run(id, name || 'New Chat', mode || 'general', bookId || null, bookTitle || null);
};

export const getChatSessions = (mode?: string) => {
  if (mode) {
    const stmt = db.prepare('SELECT * FROM chat_sessions WHERE mode = ? ORDER BY updated_at DESC');
    return stmt.all(mode);
  } else {
    const stmt = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
    return stmt.all();
  }
};

export const renameChatSession = (id: string, name: string) => {
  const stmt = db.prepare(`
    UPDATE chat_sessions 
    SET name = ?, updated_at = datetime('now') 
    WHERE id = ?
  `);
  return stmt.run(name, id);
};

export const addChatMessage = (message: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  documentsUsed?: string[];
  documentNames?: string[];
  mode?: string;
  bookId?: string;
  bookTitle?: string;
  bookPage?: number;
  extractedText?: string;
  customPromptName?: string;
}) => {
  const stmt = db.prepare(`
    INSERT INTO chat_messages (
      id, session_id, role, content, documents_used, document_names, mode, 
      book_id, book_title, book_page, extracted_text, custom_prompt_name, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  return stmt.run(
    message.id,
    message.sessionId,
    message.role,
    message.content,
    message.documentsUsed ? JSON.stringify(message.documentsUsed) : null,
    message.documentNames ? JSON.stringify(message.documentNames) : null,
    message.mode || 'general',
    message.bookId || null,
    message.bookTitle || null,
    message.bookPage || null,
    message.extractedText || null,
    message.customPromptName || null
  );
};

export const getChatMessages = (sessionId: string) => {
  const stmt = db.prepare(`
    SELECT * FROM chat_messages 
    WHERE session_id = ? 
    ORDER BY created_at ASC
  `);
  return stmt.all(sessionId);
};

export const updateChatSessionTimestamp = (sessionId: string) => {
  const stmt = db.prepare(`
    UPDATE chat_sessions 
    SET updated_at = datetime('now') 
    WHERE id = ?
  `);
  return stmt.run(sessionId);
};

export const deleteChatSession = (sessionId: string) => {
  const stmt = db.prepare('DELETE FROM chat_sessions WHERE id = ?');
  return stmt.run(sessionId);
};

// ==================== CONVERSATION CONTEXT FUNCTIONS ====================

export const trackConversationContext = (context: {
  id: string;
  sessionId: string;
  topic: string;
  keywords: string[];
  entities?: string[];
  relevanceScore?: number;
}) => {
  const existing = db.prepare(`
    SELECT id, mention_count FROM conversation_contexts 
    WHERE session_id = ? AND topic = ?
  `).get(context.sessionId, context.topic) as { id: string; mention_count: number } | undefined;

  if (existing) {
    const stmt = db.prepare(`
      UPDATE conversation_contexts 
      SET mention_count = ?,
          last_mentioned = datetime('now'),
          relevance_score = ?,
          keywords = ?,
          entities = ?
      WHERE id = ?
    `);
    return stmt.run(
      existing.mention_count + 1,
      context.relevanceScore || 1.0,
      JSON.stringify(context.keywords),
      context.entities ? JSON.stringify(context.entities) : null,
      existing.id
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO conversation_contexts (
        id, session_id, topic, keywords, entities, relevance_score, 
        first_mentioned, last_mentioned, mention_count
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `);
    return stmt.run(
      context.id,
      context.sessionId,
      context.topic,
      JSON.stringify(context.keywords),
      context.entities ? JSON.stringify(context.entities) : null,
      context.relevanceScore || 1.0
    );
  }
};

export const getSessionContexts = (sessionId: string) => {
  const stmt = db.prepare(`
    SELECT * FROM conversation_contexts 
    WHERE session_id = ? 
    ORDER BY relevance_score DESC, last_mentioned DESC
    LIMIT 10
  `);
  return stmt.all(sessionId);
};

export const createSessionSummary = (summary: {
  id: string;
  sessionId: string;
  summary: string;
  keyPoints: string[];
  messageCount: number;
}) => {
  const existing = db.prepare(`
    SELECT id FROM session_summaries WHERE session_id = ?
  `).get(summary.sessionId) as { id: string } | undefined;

  if (existing) {
    const stmt = db.prepare(`
      UPDATE session_summaries 
      SET summary = ?, key_points = ?, message_count = ?, updated_at = datetime('now')
      WHERE session_id = ?
    `);
    return stmt.run(
      summary.summary,
      JSON.stringify(summary.keyPoints),
      summary.messageCount,
      summary.sessionId
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO session_summaries (
        id, session_id, summary, key_points, message_count, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    return stmt.run(
      summary.id,
      summary.sessionId,
      summary.summary,
      JSON.stringify(summary.keyPoints),
      summary.messageCount
    );
  }
};

export const getSessionSummary = (sessionId: string) => {
  const stmt = db.prepare(`
    SELECT * FROM session_summaries WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1
  `);
  return stmt.get(sessionId);
};

export const trackGlobalMemory = (memory: {
  id: string;
  topic: string;
  context: string;
  sessionId: string;
}) => {
  const existing = db.prepare(`
    SELECT id, frequency, sessions FROM global_memory WHERE topic = ?
  `).get(memory.topic) as { id: string; frequency: number; sessions: string } | undefined;

  if (existing) {
    const sessions = JSON.parse(existing.sessions);
    if (!sessions.includes(memory.sessionId)) {
      sessions.push(memory.sessionId);
    }
    
    const stmt = db.prepare(`
      UPDATE global_memory 
      SET context = ?, sessions = ?, frequency = ?, last_seen = datetime('now')
      WHERE id = ?
    `);
    return stmt.run(
      memory.context,
      JSON.stringify(sessions),
      existing.frequency + 1,
      existing.id
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO global_memory (id, topic, context, sessions, first_seen, last_seen, frequency)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `);
    return stmt.run(
      memory.id,
      memory.topic,
      memory.context,
      JSON.stringify([memory.sessionId])
    );
  }
};

export const getGlobalMemory = (limit: number = 10) => {
  const stmt = db.prepare(`
    SELECT * FROM global_memory 
    ORDER BY frequency DESC, last_seen DESC
    LIMIT ?
  `);
  return stmt.all(limit);
};

export const searchGlobalMemory = (topic: string) => {
  const stmt = db.prepare(`
    SELECT * FROM global_memory 
    WHERE topic LIKE ? 
    ORDER BY frequency DESC
    LIMIT 5
  `);
  return stmt.all(`%${topic}%`);
};

// ==================== BOOKMARK FUNCTIONS ====================

export const addBookmark = (bookmark: {
  id: string;
  documentId?: string;
  bookId?: string;
  pageNumber: number;
  note?: string;
}) => {
  const stmt = db.prepare(`
    INSERT INTO bookmarks (id, document_id, book_id, page_number, note, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  return stmt.run(
    bookmark.id,
    bookmark.documentId || null,
    bookmark.bookId || null,
    bookmark.pageNumber,
    bookmark.note || null
  );
};

export const getBookmarks = (documentId?: string, bookId?: string) => {
  if (documentId) {
    const stmt = db.prepare('SELECT * FROM bookmarks WHERE document_id = ? ORDER BY page_number ASC');
    return stmt.all(documentId);
  } else if (bookId) {
    const stmt = db.prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page_number ASC');
    return stmt.all(bookId);
  }
  return [];
};

export const deleteBookmark = (id: string) => {
  const stmt = db.prepare('DELETE FROM bookmarks WHERE id = ?');
  return stmt.run(id);
};

// ==================== COMMENT FUNCTIONS ====================

export const addComment = (comment: {
  id: string;
  bookId: string;
  pageNumber: number;
  selectedText?: string;
  comment: string;
}) => {
  const stmt = db.prepare(`
    INSERT INTO comments (id, book_id, page_number, selected_text, comment, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  return stmt.run(
    comment.id,
    comment.bookId,
    comment.pageNumber,
    comment.selectedText || null,
    comment.comment
  );
};

export const getComments = (bookId: string, pageNumber?: number) => {
  if (pageNumber !== undefined) {
    const stmt = db.prepare('SELECT * FROM comments WHERE book_id = ? AND page_number = ? ORDER BY created_at DESC');
    return stmt.all(bookId, pageNumber);
  } else {
    const stmt = db.prepare('SELECT * FROM comments WHERE book_id = ? ORDER BY page_number ASC, created_at DESC');
    return stmt.all(bookId);
  }
};

export const deleteComment = (id: string) => {
  const stmt = db.prepare('DELETE FROM comments WHERE id = ?');
  return stmt.run(id);
};

export const updateComment = (id: string, comment: string) => {
  const stmt = db.prepare('UPDATE comments SET comment = ? WHERE id = ?');
  return stmt.run(comment, id);
};

// ==================== READER MODE CHAT FUNCTIONS ====================

export const createReaderChatSession = (bookId: string, bookTitle: string) => {
  const id = `reader-${bookId}-${Date.now()}`;
  const stmt = db.prepare(`
    INSERT INTO chat_sessions (id, name, book_id, book_title, mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'reader', datetime('now'), datetime('now'))
  `);
  stmt.run(id, `Chat: ${bookTitle}`, bookId, bookTitle);
  return id;
};

export const getReaderChatSessions = (bookId: string) => {
  const stmt = db.prepare(`
    SELECT * FROM chat_sessions 
    WHERE book_id = ? 
    ORDER BY updated_at DESC
  `);
  return stmt.all(bookId);
};

export const updateSessionTimestamp = (sessionId: string) => {
  const stmt = db.prepare(`
    UPDATE chat_sessions 
    SET updated_at = datetime('now') 
    WHERE id = ?
  `);
  return stmt.run(sessionId);
};

export default db;