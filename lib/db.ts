import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'data.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
  -- ==================== CORPUS DOCUMENTS (VECTORIZED) ====================
  -- Stores PDFs that are embedded in Qdrant for RAG queries
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,              -- Original filename
    display_name TEXT NOT NULL,          -- User-friendly name
    total_pages INTEGER NOT NULL,        -- Total page count
    embedding_status TEXT DEFAULT 'pending' CHECK(embedding_status IN ('pending', 'processing', 'completed', 'failed')),
    chunks_count INTEGER DEFAULT 0,      -- Number of vector chunks created
    is_selected INTEGER DEFAULT 0,       -- Selected for RAG queries (0/1)
    uploaded_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- ==================== READER LIBRARY (NON-VECTORIZED) ====================
  -- Stores PDFs for reading mode only (not embedded, stored in Supabase)
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,              -- Stored filename (UUID.pdf)
    title TEXT NOT NULL,                 -- Original book title
    size INTEGER NOT NULL,               -- File size in bytes
    page_count INTEGER,                  -- Total pages
    current_page INTEGER DEFAULT 1,      -- Last page user was reading
    supabase_path TEXT,                  -- Path in Supabase storage bucket
    uploaded_at TEXT DEFAULT (datetime('now')),
    last_read TEXT DEFAULT (datetime('now')),  -- Last time user opened this book
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- ==================== CHAT SESSIONS ====================
  -- Stores chat conversation sessions
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                  -- Session name (e.g., "Hadith Discussion")
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- ==================== CHAT MESSAGES ====================
  -- Stores individual messages within chat sessions
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,               -- Message text
    documents_used TEXT,                 -- JSON array of document IDs used for RAG
    mode TEXT DEFAULT 'general',         -- 'general' or 'corpus' mode
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  -- ==================== READING POSITIONS ====================
  -- Tracks current page for corpus documents (for reference during queries)
  CREATE TABLE IF NOT EXISTS reading_positions (
    document_id TEXT PRIMARY KEY,
    page_number INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  -- ==================== BOOKMARKS ====================
  -- Bookmarks for both corpus documents and reader books
  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    document_id TEXT,                    -- Reference to documents table (can be NULL)
    book_id TEXT,                        -- Reference to books table (can be NULL)
    page_number INTEGER NOT NULL,
    note TEXT DEFAULT '',                -- Optional bookmark note
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    CHECK ((document_id IS NOT NULL AND book_id IS NULL) OR (document_id IS NULL AND book_id IS NOT NULL))
  );

  -- ==================== PROMPT LIBRARY ====================
  -- Stores reusable prompt templates
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                  -- Prompt name
    template TEXT NOT NULL,              -- Template with {text} placeholder
    category TEXT NOT NULL,              -- Category (Analysis, Summary, etc.)
    is_custom INTEGER DEFAULT 0,         -- 1 = user-created, 0 = system default
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(embedding_status);
  CREATE INDEX IF NOT EXISTS idx_documents_selected ON documents(is_selected);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_document ON bookmarks(document_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
  CREATE INDEX IF NOT EXISTS idx_books_last_read ON books(last_read DESC);
`);

console.log('✅ Database initialized at:', dbPath);

// Seed default prompts if empty
const promptCount = db.prepare('SELECT COUNT(*) as count FROM prompts').get() as { count: number };
if (promptCount.count === 0) {
  const defaultPrompts = [
    {
      id: 'explain',
      name: 'Explain Concept',
      template: 'Explain the following concept in detail, citing relevant sources from the corpus:\n\n{text}',
      category: 'Analysis',
      is_custom: 0,
      created_at: new Date().toISOString()
    },
    {
      id: 'summarize',
      name: 'Summarize',
      template: 'Provide a concise summary of the following:\n\n{text}',
      category: 'Summary',
      is_custom: 0,
      created_at: new Date().toISOString()
    },
    {
      id: 'compare',
      name: 'Compare Sources',
      template: 'Compare different perspectives on this topic from the corpus:\n\n{text}',
      category: 'Analysis',
      is_custom: 0,
      created_at: new Date().toISOString()
    },
    {
      id: 'reference',
      name: 'Find References',
      template: 'Find all references and citations related to:\n\n{text}',
      category: 'Research',
      is_custom: 0,
      created_at: new Date().toISOString()
    }
  ];

  const insertPrompt = db.prepare(`
    INSERT INTO prompts (id, name, template, category, is_custom, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const prompt of defaultPrompts) {
    insertPrompt.run(
      prompt.id,
      prompt.name,
      prompt.template,
      prompt.category,
      prompt.is_custom,
      prompt.created_at
    );
  }
  
  console.log('✅ Default prompts seeded');
}

// ==================== DOCUMENT FUNCTIONS (CORPUS - VECTORIZED) ====================

export const getDb = () => db;

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

// ==================== BOOK FUNCTIONS (READER LIBRARY - NON-VECTORIZED) ====================

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
    INSERT INTO prompts (id, name, template, category, is_custom, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
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
  
  values.push(id);
  const stmt = db.prepare(`UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
};

export const deletePrompt = (id: string) => {
  const stmt = db.prepare('DELETE FROM prompts WHERE id = ? AND is_custom = 1');
  return stmt.run(id);
};

// ==================== CHAT HISTORY FUNCTIONS ====================

export const createChatSession = (id: string, name?: string) => {
  const stmt = db.prepare(`
    INSERT INTO chat_sessions (id, name, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `);
  return stmt.run(id, name || 'New Chat');
};

export const getChatSessions = () => {
  const stmt = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
  return stmt.all();
};

export const addChatMessage = (message: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  documentsUsed?: string[];
  mode: string;
}) => {
  const stmt = db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, documents_used, mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  return stmt.run(
    message.id,
    message.sessionId,
    message.role,
    message.content,
    message.documentsUsed ? JSON.stringify(message.documentsUsed) : null,
    message.mode
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

// ==================== BOOKMARK FUNCTIONS ====================

export const addBookmark = (bookmark: {
  id: string;
  documentId?: string;  // For corpus documents
  bookId?: string;      // For reader books
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

// ==================== READING POSITION FUNCTIONS ====================

export const saveReadingPosition = (documentId: string, pageNumber: number) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO reading_positions (document_id, page_number, updated_at)
    VALUES (?, ?, datetime('now'))
  `);
  return stmt.run(documentId, pageNumber);
};

export const getReadingPosition = (documentId: string) => {
  const stmt = db.prepare('SELECT * FROM reading_positions WHERE document_id = ?');
  return stmt.get(documentId);
};

export default db;