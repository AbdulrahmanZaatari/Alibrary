'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Sparkles, BookOpen, FileText, Trash2, Plus, Settings, X, Copy, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  documentsUsed?: string[];
}

interface ChatSession {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ChatPanelProps {
  selectedDocuments: string[];
}

export default function ChatPanel({ selectedDocuments }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [mode, setMode] = useState<'corpus' | 'general'>('corpus');
  const [showSettings, setShowSettings] = useState(false);
  const [enableMultiHop, setEnableMultiHop] = useState(false);
  
  // ✅ NEW: Model Selection State
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [modelError, setModelError] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Best Quality)', tier: 'premium' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast & Smart)', tier: 'premium' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', tier: 'standard' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'standard' }
  ];

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (currentSession) {
      fetchMessages(currentSession);
    }
  }, [currentSession]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      const data = await res.json();
      setSessions(data);
      
      if (data.length > 0 && !currentSession) {
        setCurrentSession(data[0].id);
      } else if (data.length === 0) {
        createNewSession();
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}`);
      const data = await res.json();
      setMessages(data.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.created_at,
        documentsUsed: msg.documents_used ? JSON.parse(msg.documents_used) : undefined
      })));
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const createNewSession = async () => {
    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `New Chat` })
      });
      const data = await res.json();
      setCurrentSession(data.id);
      setMessages([]);
      await fetchSessions();
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this chat session?')) return;

    try {
      await fetch('/api/chat/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId })
      });
      
      if (currentSession === sessionId) {
        setCurrentSession(null);
        setMessages([]);
      }
      
      await fetchSessions();
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const renameSession = async (sessionId: string) => {
    const currentSession = sessions.find(s => s.id === sessionId);
    if (!currentSession) return;

    const newName = prompt('Enter new session name:', currentSession.name);
    if (!newName || newName.trim() === '' || newName === currentSession.name) return;

    try {
      const res = await fetch('/api/chat/rename-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name: newName.trim() })
      });

      if (res.ok) {
        await fetchSessions();
      } else {
        alert('Failed to rename session');
      }
    } catch (error) {
      console.error('Error renaming session:', error);
      alert('Failed to rename session');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !currentSession) return;

    if (mode === 'corpus' && selectedDocuments.length === 0) {
      alert('Please select at least one document from the corpus');
      return;
    }

    const isNewSession = messages.length === 0;
    const userMessageContent = input.trim();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setModelError(null); // ✅ Clear previous errors

    try {
      const endpoint = mode === 'corpus' ? '/api/query' : '/api/chat';
      const body = mode === 'corpus' 
        ? { 
            query: userMessageContent, 
            documentIds: selectedDocuments,
            enableMultiHop,
            preferredModel: selectedModel // ✅ Pass selected model
          }
        : { 
            message: userMessageContent, 
            sessionId: currentSession,
            documentIds: selectedDocuments.length > 0 ? selectedDocuments : undefined,
            enableMultiHop,
            preferredModel: selectedModel // ✅ Pass selected model
          };

      console.log('🔄 Sending request:', { endpoint, mode, enableMultiHop, model: selectedModel, hasDocuments: selectedDocuments.length > 0 });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      // ✅ Check for model errors
      if (!res.ok) {
        const errorText = await res.text();
        if (errorText.includes('All models failed') || errorText.includes('quota')) {
          setModelError(errorText);
          throw new Error(`Model Error: ${errorText}`);
        }
        throw new Error(`API error: ${res.status}`);
      }

      // ✅ Capture which model was actually used
      const modelUsedHeader = res.headers.get('X-Model-Used');
      if (modelUsedHeader) {
        setUsedModel(modelUsedHeader);
        console.log(`✅ Response generated using: ${modelUsedHeader}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        documentsUsed: mode === 'corpus' || selectedDocuments.length > 0 ? selectedDocuments : undefined
      };

      setMessages(prev => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        fullResponse += chunk;

        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, content: fullResponse }
            : msg
        ));
      }

      // Save messages to database
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession,
          userMessage: userMessageContent,
          assistantMessage: fullResponse,
          documentsUsed: mode === 'corpus' || selectedDocuments.length > 0 ? selectedDocuments : undefined,
          mode
        })
      });

      // Auto-name session based on first prompt
      if (isNewSession) {
        try {
          const words = userMessageContent.split(/\s+/).slice(0, 5).join(' ');
          const autoName = words.length > 40 ? words.substring(0, 40) + '...' : words;
          
          await fetch('/api/chat/rename-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              sessionId: currentSession, 
              name: autoName 
            }),
          });
          
          await fetchSessions();
        } catch (error) {
          console.error('Failed to auto-name session:', error);
        }
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, an error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex bg-slate-50">
      {/* Sessions Sidebar */}
      <div className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Plus size={18} />
            <span className="font-medium">New Chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2 px-2">
            Recent Chats
          </h3>
          {sessions.map(session => (
            <div
              key={session.id}
              className={`group relative mb-2 p-3 rounded-lg cursor-pointer transition-all ${
                currentSession === session.id
                  ? 'bg-emerald-50 border-2 border-emerald-300'
                  : 'bg-slate-50 border-2 border-transparent hover:border-slate-300'
              }`}
              onClick={() => setCurrentSession(session.id)}
            >
              <p className="text-sm font-medium text-slate-800 truncate mb-1">
                {session.name}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(session.updated_at).toLocaleDateString()}
              </p>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    renameSession(session.id);
                  }}
                  className="p-1 hover:bg-blue-100 rounded transition-all"
                  title="Rename session"
                >
                  <Pencil size={14} className="text-blue-600" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                  className="p-1 hover:bg-red-100 rounded transition-all"
                  title="Delete session"
                >
                  <Trash2 size={14} className="text-red-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-slate-800">AI Research Assistant</h2>
            <div className="flex items-center gap-2">
              <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => setMode('corpus')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    mode === 'corpus'
                      ? 'bg-white text-emerald-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <BookOpen size={16} />
                  Corpus
                </button>
                <button
                  onClick={() => setMode('general')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    mode === 'general'
                      ? 'bg-white text-emerald-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Sparkles size={16} />
                  General
                </button>
              </div>

              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-slate-100'
                }`}
                title="Chat Settings"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>

          {/* ✅ UPDATED: Settings Panel with Model Selection */}
          {showSettings && (
            <div className="mb-3 p-4 bg-slate-50 rounded-lg space-y-4">
              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  AI Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    setModelError(null);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                >
                  {AVAILABLE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                {usedModel && (
                  <p className="text-xs text-green-600 mt-1">
                    ✓ Last used: {usedModel}
                  </p>
                )}
                {modelError && (
                  <p className="text-xs text-red-600 mt-1">
                    ⚠ {modelError}
                  </p>
                )}
              </div>

              {/* Multi-Hop Reasoning */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-slate-700">Multi-Hop Reasoning</label>
                  <p className="text-xs text-slate-500 mt-0.5">For complex analysis questions</p>
                </div>
                <button
                  onClick={() => setEnableMultiHop(!enableMultiHop)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    enableMultiHop 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {enableMultiHop ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {mode === 'corpus' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <FileText size={16} className="text-emerald-600" />
              <span className="text-sm text-emerald-800">
                {selectedDocuments.length === 0 
                  ? 'No corpus selected - please select documents'
                  : `Searching ${selectedDocuments.length} document${selectedDocuments.length > 1 ? 's' : ''}`
                }
              </span>
              {enableMultiHop && selectedDocuments.length > 0 && (
                <span className="ml-auto text-xs text-blue-600 font-medium">
                  🧠 Multi-hop enabled
                </span>
              )}
            </div>
          )}

          {mode === 'general' && selectedDocuments.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <FileText size={16} className="text-blue-600" />
              <span className="text-sm text-blue-800">
                Using {selectedDocuments.length} document{selectedDocuments.length > 1 ? 's' : ''} as context
              </span>
              {enableMultiHop && (
                <span className="ml-auto text-xs text-blue-600 font-medium">
                  🧠 Multi-hop enabled
                </span>
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-full flex items-center justify-center">
                  <Sparkles className="text-emerald-600" size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                  Start a Conversation
                </h3>
                <p className="text-slate-600 mb-4">
                  {mode === 'corpus' 
                    ? 'Ask questions about your selected documents and get AI-powered insights.'
                    : 'Have a general conversation with the AI assistant.'
                  }
                </p>
                {mode === 'corpus' && selectedDocuments.length === 0 && (
                  <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    ⚠️ Please select documents from the corpus library first
                  </p>
                )}
                {enableMultiHop && selectedDocuments.length > 0 && (
                  <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
                    🧠 Multi-hop reasoning is enabled for complex queries
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-4 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="text-white" size={20} />
                    </div>
                  )}
                  
                  <div
                    className={`max-w-3xl rounded-2xl px-6 py-4 ${
                      message.role === 'user'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-800'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <div className="relative">
                        <div className="flex justify-end">
                          <button
                            className="mb-1 mr-1 p-1 bg-slate-100 rounded hover:bg-slate-200 transition-colors text-xs"
                            title="Copy response"
                            onClick={() => {
                              navigator.clipboard.writeText(message.content);
                            }}
                          >
                            <Copy size={16} className="inline mr-1" />
                            Copy
                          </button>
                        </div>
                        <div 
                          className="prose prose-sm max-w-none dark:prose-invert"
                          dir={message.content.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              h1: ({ node, ...props }) => (
                                <h1 className="text-xl font-bold mb-3 mt-4 text-slate-900" {...props} />
                              ),
                              h2: ({ node, ...props }) => (
                                <h2 className="text-lg font-bold mb-2 mt-3 text-slate-900" {...props} />
                              ),
                              h3: ({ node, ...props }) => (
                                <h3 className="text-base font-bold mb-2 mt-2 text-slate-800" {...props} />
                              ),
                              strong: ({ node, ...props }) => (
                                <strong className="font-bold text-emerald-700" {...props} />
                              ),
                              ul: ({ node, ...props }) => (
                                <ul className="list-disc mr-6 ml-6 my-2 space-y-1" {...props} />
                              ),
                              ol: ({ node, ...props }) => (
                                <ol className="list-decimal mr-6 ml-6 my-2 space-y-1" {...props} />
                              ),
                              li: ({ node, ...props }) => (
                                <li className="leading-relaxed text-slate-700" {...props} />
                              ),
                              blockquote: ({ node, ...props }) => (
                                <blockquote
                                  className="border-l-4 border-r-4 border-emerald-300 pl-4 pr-4 italic my-2 text-slate-600 bg-emerald-50 py-2 rounded-r"
                                  {...props}
                                />
                              ),
                              code: ({ node, inline, ...props }: any) =>
                                inline ? (
                                  <code
                                    className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono"
                                    {...props}
                                  />
                                ) : (
                                  <code
                                    className="block bg-slate-100 text-slate-800 p-3 rounded my-2 text-sm font-mono overflow-x-auto"
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
                                <p className="mb-2 leading-relaxed text-slate-700" {...props} />
                              ),
                              em: ({ node, ...props }) => (
                                <em className="italic text-slate-600" {...props} />
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>
                    )}
                    
                    {message.documentsUsed && message.documentsUsed.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <FileText size={12} />
                          Referenced {message.documentsUsed.length} document{message.documentsUsed.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    )}
                    
                    <p className="text-xs opacity-60 mt-2">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </p>
                  </div>

                  {message.role === 'user' && (
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-600 font-semibold text-sm">You</span>
                    </div>
                  )}
                </div>
              ))}
              
              {loading && (
                <div className="flex gap-4 justify-start">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="text-white" size={20} />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4">
                    <Loader2 className="animate-spin text-emerald-600" size={20} />
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === 'corpus' 
                    ? selectedDocuments.length === 0
                      ? 'Select documents first...'
                      : 'Ask a question about your documents...'
                    : 'Type your message...'
                }
                disabled={loading || (mode === 'corpus' && selectedDocuments.length === 0)}
                className="flex-1 px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={loading || !input.trim() || (mode === 'corpus' && selectedDocuments.length === 0)}
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Thinking...
                  </>
                ) : (
                  <>
                    <Send size={20} />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}