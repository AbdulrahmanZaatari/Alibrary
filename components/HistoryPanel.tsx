'use client';

import { useState, useEffect } from 'react';
import { Clock, MessageSquare, FileText, Trash2, Calendar, Search, BookOpen, Database, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatSession {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  messageCount?: number;
  mode?: 'general' | 'reader';
  book_id?: string;
  book_title?: string;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  documents_used: string | null;
  document_names: string | null;
  mode: string;
  created_at: string;
  book_page?: number;
  extracted_text?: string;
  custom_prompt?: string; 
  custom_prompt_name?: string; 
}

export default function HistoryPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'general' | 'reader'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession);
    }
  }, [selectedSession]);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      
      const [generalRes, readerRes] = await Promise.all([
        fetch('/api/chat/sessions'),
        fetch('/api/reader-chat/sessions/all')
      ]);
      
      const generalData = await generalRes.json();
      const readerData = await readerRes.json();
      
      const generalSessions = await Promise.all(
        generalData.map(async (session: ChatSession) => {
          const msgRes = await fetch(`/api/chat/messages?sessionId=${session.id}`);
          const messages = await msgRes.json();
          
          return {
            ...session,
            messageCount: messages.length,
            mode: 'general' as const,
          };
        })
      );
      
      const readerSessions = await Promise.all(
        (readerData || []).map(async (session: any) => {
          const msgRes = await fetch(`/api/reader-chat/messages?sessionId=${session.id}`);
          const messages = await msgRes.json();
          
          return {
            ...session,
            messageCount: messages.length,
            mode: 'reader' as const,
            book_id: session.book_id,
            book_title: session.book_title || 'Unknown Book'
          };
        })
      );
      
      const allSessions = [...generalSessions, ...readerSessions].sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      setSessions(allSessions);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      const session = sessions.find(s => s.id === sessionId);
      const endpoint = session?.mode === 'reader' 
        ? `/api/reader-chat/messages?sessionId=${sessionId}`
        : `/api/chat/messages?sessionId=${sessionId}`;
      
      const res = await fetch(endpoint);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const deleteSession = async (sessionId: string, mode: 'general' | 'reader', e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this chat session? This action cannot be undone.')) {
      return;
    }

    try {
      const endpoint = mode === 'reader' 
        ? '/api/reader-chat/sessions'
        : '/api/chat/sessions';
      
      await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId })
      });
      
      if (selectedSession === sessionId) {
        setSelectedSession(null);
        setMessages([]);
      }
      
      await fetchSessions();
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session');
    }
  };

  const renameSession = async (sessionId: string, currentName: string, mode: 'general' | 'reader', e: React.MouseEvent) => {
    e.stopPropagation();
    
    const cleanName = currentName.replace('Chat: ', '');
    const newName = prompt('Enter new name:', cleanName);
    
    if (!newName || newName.trim() === cleanName) return;

    try {
      const endpoint = mode === 'reader'
        ? '/api/reader-chat/sessions'
        : '/api/chat/rename-session';
      
      if (mode === 'reader') {
        await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, name: `Chat: ${newName.trim()}` })
        });
      } else {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, name: newName.trim() })
        });
      }
      
      await fetchSessions();
    } catch (error) {
      console.error('Error renaming session:', error);
      alert('Failed to rename session');
    }
  };

  const clearAllHistory = async () => {
    if (!confirm('Are you sure you want to delete ALL chat history? This action cannot be undone.')) {
      return;
    }

    try {
      await Promise.all(sessions.map(session => {
        const endpoint = session.mode === 'reader'
          ? '/api/reader-chat/sessions'
          : '/api/chat/sessions';
        
        return fetch(endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: session.id })
        });
      }));
      
      setSessions([]);
      setSelectedSession(null);
      setMessages([]);
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Failed to clear history');
    }
  };

  const getDocumentNames = (message: ChatMessage): string[] => {
    if (message.document_names) {
      try {
        return JSON.parse(message.document_names);
      } catch {
        return [];
      }
    }
    return [];
  };

  const filteredSessions = sessions.filter(session => {
    const matchesSearch = session.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          session.book_title?.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (filterMode === 'all') return matchesSearch;
    return matchesSearch && session.mode === filterMode;
  });

  const groupSessionsByDate = (sessions: ChatSession[]) => {
    const grouped: { [key: string]: ChatSession[] } = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    sessions.forEach(session => {
      const sessionDate = new Date(session.updated_at);
      let key: string;

      if (sessionDate.toDateString() === today.toDateString()) {
        key = 'Today';
      } else if (sessionDate.toDateString() === yesterday.toDateString()) {
        key = 'Yesterday';
      } else if (sessionDate > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
        key = 'This Week';
      } else if (sessionDate > new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
        key = 'This Month';
      } else {
        key = 'Older';
      }

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(session);
    });

    return grouped;
  };

  const groupedSessions = groupSessionsByDate(filteredSessions);
  const selectedSessionData = sessions.find(s => s.id === selectedSession);

  return (
    <div className="h-full flex bg-slate-50">
      {/* Sessions List */}
      <div className="w-96 border-r border-slate-200 bg-white flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Clock className="text-emerald-600" size={24} />
              Chat History
            </h2>
            {sessions.length > 0 && (
              <button
                onClick={clearAllHistory}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Clear all history"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <button
              onClick={() => setFilterMode('all')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filterMode === 'all'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterMode('general')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${
                filterMode === 'general'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <MessageSquare size={12} />
              General
            </button>
            <button
              onClick={() => setFilterMode('reader')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${
                filterMode === 'reader'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <BookOpen size={12} />
              Reader
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                <p className="text-sm text-slate-500">Loading history...</p>
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                <Clock className="text-slate-400" size={32} />
              </div>
              <p className="text-slate-600 font-medium mb-1">No chat history yet</p>
              <p className="text-sm text-slate-500">Your conversations will appear here</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-600 font-medium mb-1">No results</p>
              <p className="text-sm text-slate-500">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedSessions).map(([period, periodSessions]) => (
                <div key={period}>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2 px-2 flex items-center gap-2">
                    <Calendar size={12} />
                    {period}
                  </h3>
                  <div className="space-y-2">
                    {periodSessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => setSelectedSession(session.id)}
                        className={`group relative p-4 rounded-lg cursor-pointer transition-all ${
                          selectedSession === session.id
                            ? 'bg-emerald-50 border-2 border-emerald-300 shadow-sm'
                            : 'bg-slate-50 border-2 border-transparent hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        {/* Mode Badge */}
                        <div className="flex items-center gap-2 mb-2">
                          {session.mode === 'reader' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                              <BookOpen size={10} />
                              Reader
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                              <MessageSquare size={10} />
                              General
                            </span>
                          )}
                        </div>

                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 mr-2">
                            <p className="font-medium text-sm text-slate-800 line-clamp-2">
                              {session.name}
                            </p>
                            {session.mode === 'reader' && session.book_title && (
                              <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                                <BookOpen size={10} />
                                {session.book_title}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => renameSession(session.id, session.name, session.mode!, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-blue-100 rounded transition-all"
                              title="Rename"
                            >
                              <Pencil size={14} className="text-blue-600" />
                            </button>
                            <button
                              onClick={(e) => deleteSession(session.id, session.mode!, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                            >
                              <Trash2 size={14} className="text-red-600" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <MessageSquare size={12} />
                            {session.messageCount || 0} messages
                          </span>
                          <span>
                            {new Date(session.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages View */}
      <div className="flex-1 flex flex-col">
        {selectedSession ? (
          <>
            {/* Message Header */}
            <div className="p-4 border-b border-slate-200 bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {selectedSessionData?.name}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {messages.length} messages • Last updated {new Date(selectedSessionData?.updated_at || '').toLocaleString()}
                  </p>
                  
                  {selectedSessionData?.mode === 'reader' && selectedSessionData.book_title && (
                    <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <p className="text-sm font-medium text-purple-900 flex items-center gap-2">
                        <BookOpen size={16} className="text-purple-600" />
                        Reading: {selectedSessionData.book_title}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

                        {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6 max-w-4xl mx-auto">
                {messages.map((message) => {
                  const docNames = getDocumentNames(message);
                  
                  return (
                    <div
                      key={message.id}
                      className={`flex gap-4 ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {message.role === 'assistant' && (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="text-white" size={20} />
                        </div>
                      )}
                      
                      <div
                        className={`max-w-3xl rounded-2xl px-6 py-4 ${
                          message.role === 'user'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        {/* ✅ MARKDOWN RENDERING FOR ASSISTANT */}
                        {message.role === 'assistant' ? (
                          <div 
                            className="prose prose-sm max-w-none"
                            dir={message.content.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
                          >
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({ node, ...props }) => (
                                  <h1 className="text-lg font-bold mb-2 mt-3 text-slate-900" {...props} />
                                ),
                                h2: ({ node, ...props }) => (
                                  <h2 className="text-base font-bold mb-2 mt-2 text-slate-900" {...props} />
                                ),
                                h3: ({ node, ...props }) => (
                                  <h3 className="text-sm font-bold mb-1 mt-2 text-slate-800" {...props} />
                                ),
                                strong: ({ node, ...props }) => (
                                  <strong className="font-bold text-emerald-700" {...props} />
                                ),
                                ul: ({ node, ...props }) => (
                                  <ul className="list-disc mr-5 ml-5 my-2 space-y-1" {...props} />
                                ),
                                ol: ({ node, ...props }) => (
                                  <ol className="list-decimal mr-5 ml-5 my-2 space-y-1" {...props} />
                                ),
                                li: ({ node, ...props }) => (
                                  <li className="leading-relaxed text-slate-700 text-sm" {...props} />
                                ),
                                blockquote: ({ node, ...props }) => (
                                  <blockquote
                                    className="border-l-4 border-r-4 border-emerald-300 pl-3 pr-3 italic my-2 text-slate-600 bg-emerald-50 py-2 rounded-r text-sm"
                                    {...props}
                                  />
                                ),
                                code: ({ node, inline, ...props }: any) =>
                                  inline ? (
                                    <code
                                      className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono"
                                      {...props}
                                    />
                                  ) : (
                                    <code
                                      className="block bg-slate-100 text-slate-800 p-2 rounded my-2 text-xs font-mono overflow-x-auto"
                                      {...props}
                                    />
                                  ),
                                a: ({ node, ...props }) => (
                                  <a
                                    className="text-emerald-600 hover:text-emerald-800 underline"
                                    {...props}
                                  />
                                ),
                                p: ({ node, ...props }) => (
                                  <p className="mb-2 leading-relaxed text-slate-700 text-sm" {...props} />
                                ),
                                em: ({ node, ...props }) => (
                                  <em className="italic text-slate-600" {...props} />
                                ),
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          // User messages remain plain text
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {message.content}
                          </p>
                        )}
                        
                        {/* ✅ CUSTOM PROMPT INDICATOR */}
                        {message.role === 'user' && message.custom_prompt_name && (
                          <div className="mt-3 pt-3 border-t border-white/20">
                            <p className="text-xs flex items-center gap-1 font-medium text-white/80">
                              <FileText size={12} />
                              Custom Prompt Used: {message.custom_prompt_name}
                            </p>
                          </div>
                        )}
                        
                        {message.book_page && (
                          <div className={`mt-3 pt-3 border-t ${message.role === 'user' ? 'border-white/20' : 'border-purple-200'}`}>
                            <p className={`text-xs flex items-center gap-1 font-medium ${message.role === 'user' ? 'text-white/80' : 'text-purple-600'}`}>
                              <BookOpen size={12} />
                              Page {message.book_page}
                            </p>
                          </div>
                        )}
                        
                        {docNames.length > 0 && (
                          <div className={`mt-3 pt-3 border-t ${message.role === 'user' ? 'border-white/20' : 'border-slate-200'}`}>
                            <p className={`text-xs flex items-center gap-1 mb-2 font-medium ${message.role === 'user' ? 'text-white/80' : 'text-slate-600'}`}>
                              <Database size={12} />
                              Corpus Documents Used:
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {docNames.map((name: string, idx: number) => (
                                <span
                                  key={idx}
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    message.role === 'user'
                                      ? 'bg-white/20 text-white'
                                      : 'bg-purple-100 text-purple-700'
                                  }`}
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <p className={`text-xs mt-2 ${message.role === 'user' ? 'text-white/60' : 'text-slate-500'}`}>
                          {new Date(message.created_at).toLocaleString()}
                        </p>
                      </div>

                      {message.role === 'user' && (
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-slate-600 font-semibold text-sm">You</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <div className="w-24 h-24 mx-auto mb-6 bg-slate-100 rounded-full flex items-center justify-center">
                <MessageSquare className="text-slate-400" size={48} />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-3">
                Select a Conversation
              </h3>
              <p className="text-slate-600">
                Choose a chat from the history to view the full conversation
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}