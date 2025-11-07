import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== DOCUMENT FUNCTIONS ====================

export const addDocument = async (doc: {
  id: string;
  filename: string;
  displayName: string;
  totalPages: number;
}) => {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      id: doc.id,
      filename: doc.filename,
      display_name: doc.displayName,
      total_pages: doc.totalPages,
      embedding_status: 'pending'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getDocuments = async () => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('uploaded_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

export const getDocumentById = async (id: string) => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
};

export const updateDocumentStatus = async (
  id: string, 
  status: 'pending' | 'processing' | 'completed' | 'failed'
) => {
  const { error } = await supabase
    .from('documents')
    .update({ 
      embedding_status: status,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
};

export const updateDocumentChunksCount = async (id: string, count: number) => {
  const { error } = await supabase
    .from('documents')
    .update({ chunks_count: count })
    .eq('id', id);

  if (error) throw error;
};

export const toggleDocumentSelection = async (id: string, selected: boolean) => {
  const { error } = await supabase
    .from('documents')
    .update({ is_selected: selected })
    .eq('id', id);

  if (error) throw error;
};

export const getSelectedDocuments = async () => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('is_selected', true);

  if (error) throw error;
  return data || [];
};

export const deleteDocument = async (id: string) => {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// ==================== BOOK FUNCTIONS ====================

export const addBook = async (book: {
  filename: string;
  title: string;
  size: number;
  pageCount: number;
  supabasePath: string;
}) => {
  const { data, error } = await supabase
    .from('books')
    .insert({
      filename: book.filename,
      title: book.title,
      size: book.size,
      page_count: book.pageCount,
      supabase_path: book.supabasePath,
      language: 'Arabic',
      current_page: 1
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getBooks = async () => {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('last_read', { ascending: false });

  if (error) throw error;
  return data || [];
};

export const getBookById = async (id: string) => {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
};

export const updateBookReadingPosition = async (id: string, currentPage: number) => {
  const { error } = await supabase
    .from('books')
    .update({ 
      current_page: currentPage,
      last_read: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
};

export const updateBookMetadata = async (
  id: string,
  metadata: {
    title?: string;
    author?: string;
    publisher?: string;
    year?: string;
    isbn?: string;
    edition?: string;
    language?: string;
  }
) => {
  const { error } = await supabase
    .from('books')
    .update({ 
      ...metadata,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
};

export const deleteBook = async (id: string) => {
  const { error } = await supabase
    .from('books')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// ==================== PROMPT FUNCTIONS ====================

export const getPrompts = async () => {
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .order('is_custom', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const getPromptsByCategory = async (category: string) => {
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('category', category)
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const addPrompt = async (prompt: {
  name: string;
  template: string;
  category: string;
  isCustom: boolean;
}) => {
  const { data, error } = await supabase
    .from('prompts')
    .insert({
      name: prompt.name,
      template: prompt.template,
      category: prompt.category,
      is_custom: prompt.isCustom
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const updatePrompt = async (
  id: string,
  updates: {
    name?: string;
    template?: string;
    category?: string;
  }
) => {
  const { error } = await supabase
    .from('prompts')
    .update({
      ...updates,
      modified_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
};

export const deletePrompt = async (id: string) => {
  const { error } = await supabase
    .from('prompts')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// ==================== CHAT SESSION FUNCTIONS ====================

export const createChatSession = async (session: {
  name: string;
  mode?: string;
  bookId?: string;
  bookTitle?: string;
}) => {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      name: session.name,
      mode: session.mode || 'general',
      book_id: session.bookId || null,
      book_title: session.bookTitle || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getChatSessions = async (mode?: string) => {
  let query = supabase
    .from('chat_sessions')
    .select('*')
    .order('updated_at', { ascending: false });

  if (mode) {
    query = query.eq('mode', mode);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
};

export const getRecentChatSessions = async (limit: number = 10) => {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

export const getChatSessionById = async (id: string) => {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
};

export const updateChatSession = async (
  id: string,
  updates: {
    name?: string;
    bookId?: string;
    bookTitle?: string;
  }
) => {
  const { error } = await supabase
    .from('chat_sessions')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;
};

export const getChatSessionsByBook = async (bookId: string) => {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('book_id', bookId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

export const updateSessionTimestamp = async (sessionId: string) => {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;
};

export const deleteChatSession = async (sessionId: string) => {
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) throw error;
};

// ==================== CHAT MESSAGE FUNCTIONS ====================

export const addChatMessage = async (message: {
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
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: message.sessionId,
      role: message.role,
      content: message.content,
      documents_used: message.documentsUsed ? JSON.stringify(message.documentsUsed) : null,
      document_names: message.documentNames?.join(', ') || null,
      mode: message.mode || 'general',
      book_id: message.bookId || null,
      book_title: message.bookTitle || null,
      book_page: message.bookPage || null,
      extracted_text: message.extractedText || null,
      custom_prompt_name: message.customPromptName || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getChatMessages = async (sessionId: string) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const updateChatSessionTimestamp = async (sessionId: string) => {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;
};

// ==================== CONVERSATION CONTEXT FUNCTIONS ====================

export const trackConversationContext = async (context: {
  sessionId: string;
  topic: string;
  keywords: string[];
  entities?: string[];
  relevanceScore?: number;
}) => {
  // Check if context already exists
  const { data: existing } = await supabase
    .from('conversation_contexts')
    .select('*')
    .eq('session_id', context.sessionId)
    .eq('topic', context.topic)
    .single();

  if (existing) {
    // Update existing context
    const { error } = await supabase
      .from('conversation_contexts')
      .update({
        keywords: JSON.stringify(context.keywords),
        entities: context.entities ? JSON.stringify(context.entities) : null,
        relevance_score: context.relevanceScore || 1.0,
        mention_count: existing.mention_count + 1,
        last_mentioned: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    // Insert new context
    const { error } = await supabase
      .from('conversation_contexts')
      .insert({
        session_id: context.sessionId,
        topic: context.topic,
        keywords: JSON.stringify(context.keywords),
        entities: context.entities ? JSON.stringify(context.entities) : null,
        relevance_score: context.relevanceScore || 1.0,
        mention_count: 1
      });

    if (error) throw error;
  }
};

export const getSessionContexts = async (sessionId: string) => {
  const { data, error } = await supabase
    .from('conversation_contexts')
    .select('*')
    .eq('session_id', sessionId)
    .order('relevance_score', { ascending: false })
    .order('last_mentioned', { ascending: false })
    .limit(10);

  if (error) throw error;
  
  return (data || []).map(ctx => ({
    ...ctx,
    keywords: JSON.parse(ctx.keywords),
    entities: ctx.entities ? JSON.parse(ctx.entities) : []
  }));
};

// ==================== SESSION SUMMARY FUNCTIONS ====================

export const createSessionSummary = async (summary: {
  sessionId: string;
  summary: string;
  keyPoints: string[];
  messageCount: number;
}) => {
  const { data: existing } = await supabase
    .from('session_summaries')
    .select('*')
    .eq('session_id', summary.sessionId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('session_summaries')
      .update({
        summary: summary.summary,
        key_points: JSON.stringify(summary.keyPoints),
        message_count: summary.messageCount,
        updated_at: new Date().toISOString()
      })
      .eq('session_id', summary.sessionId);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('session_summaries')
      .insert({
        session_id: summary.sessionId,
        summary: summary.summary,
        key_points: JSON.stringify(summary.keyPoints),
        message_count: summary.messageCount
      });

    if (error) throw error;
  }
};

export const getSessionSummary = async (sessionId: string) => {
  const { data, error } = await supabase
    .from('session_summaries')
    .select('*')
    .eq('session_id', sessionId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // Ignore not found
  
  if (data) {
    return {
      ...data,
      keyPoints: JSON.parse(data.key_points)
    };
  }
  return null;
};

// ==================== GLOBAL MEMORY FUNCTIONS ====================

export const trackGlobalMemory = async (memory: {
  topic: string;
  context: string;
  sessionId: string;
}) => {
  const { data: existing } = await supabase
    .from('global_memory')
    .select('*')
    .eq('topic', memory.topic)
    .single();

  if (existing) {
    const sessions = existing.sessions.split(',');
    if (!sessions.includes(memory.sessionId)) {
      sessions.push(memory.sessionId);
    }

    const { error } = await supabase
      .from('global_memory')
      .update({
        context: memory.context,
        sessions: sessions.join(','),
        frequency: existing.frequency + 1,
        last_seen: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('global_memory')
      .insert({
        topic: memory.topic,
        context: memory.context,
        sessions: memory.sessionId,
        frequency: 1
      });

    if (error) throw error;
  }
};

export const getGlobalMemory = async (limit: number = 10) => {
  const { data, error } = await supabase
    .from('global_memory')
    .select('*')
    .order('frequency', { ascending: false })
    .order('last_seen', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

export const searchGlobalMemory = async (topic: string) => {
  const { data, error } = await supabase
    .from('global_memory')
    .select('*')
    .ilike('topic', `%${topic}%`)
    .order('frequency', { ascending: false })
    .limit(5);

  if (error) throw error;
  return data || [];
};

// ==================== BOOKMARK FUNCTIONS ====================

export const addBookmark = async (bookmark: {
  documentId?: string;
  bookId?: string;
  pageNumber: number;
  note?: string;
}) => {
  const { data, error } = await supabase
    .from('bookmarks')
    .insert({
      document_id: bookmark.documentId || null,
      book_id: bookmark.bookId || null,
      page_number: bookmark.pageNumber,
      note: bookmark.note || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getBookmarks = async (documentId?: string, bookId?: string) => {
  let query = supabase
    .from('bookmarks')
    .select('*')
    .order('page_number', { ascending: true });

  if (documentId) {
    query = query.eq('document_id', documentId);
  } else if (bookId) {
    query = query.eq('book_id', bookId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
};

export const deleteBookmark = async (id: string) => {
  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// ==================== COMMENT FUNCTIONS ====================

export const addComment = async (comment: {
  bookId: string;
  pageNumber: number;
  selectedText?: string;
  comment: string;
}) => {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      book_id: comment.bookId,
      page_number: comment.pageNumber,
      selected_text: comment.selectedText || null,
      comment: comment.comment
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const getComments = async (bookId: string, pageNumber?: number) => {
  let query = supabase
    .from('comments')
    .select('*')
    .eq('book_id', bookId);

  if (pageNumber !== undefined) {
    query = query.eq('page_number', pageNumber);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
};

export const deleteComment = async (id: string) => {
  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

export const updateComment = async (id: string, comment: string) => {
  const { error } = await supabase
    .from('comments')
    .update({ comment })
    .eq('id', id);

  if (error) throw error;
};

// Export a compatibility function for existing code
export const getDb = () => {
  throw new Error('getDb() is deprecated. Use Supabase functions directly.');
};