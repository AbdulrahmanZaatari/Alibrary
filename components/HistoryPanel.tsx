// components/HistoryPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { Clock, MessageSquare, FileText, Trash2, Calendar, Search, Filter } from 'lucide-react';

interface ChatSession {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  messageCount?: number;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  documents_used: string | null;
  mode: string;
  created_at: string;
}

export default function HistoryPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'corpus' | 'general'>('all');
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
      const res = await fetch('/api/chat/sessions');
      const data = await res.json();
      
      // Fetch message counts for each session
      const sessionsWithCounts = await Promise.all(
        data.map(async (session: ChatSession) => {
          const msgRes = await fetch(`/api/chat/messages?sessionId=${session.id}`);
          const messages = await msgRes.json();
          return {
            ...session,
            messageCount: messages.length
          };
        })
      );
      
      setSessions(sessionsWithCounts);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}`);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this chat session? This action cannot be undone.')) {
      return;
    }

    try {
      await fetch('/api/chat/sessions', {
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

  const clearAllHistory = async () => {
    if (!confirm('Are you sure you want to delete ALL chat history? This action cannot be undone.')) {
      return;
    }

    try {
      await Promise.all(sessions.map(session => 
        fetch('/api/chat/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: session.id })
        })
      ));
      
      setSessions([]);
      setSelectedSession(null);
      setMessages([]);
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Failed to clear history');
    }
  };

  const filteredSessions = sessions.filter(session => {
    // Search filter
    const matchesSearch = session.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Mode filter (would need to check messages for this - simplified here)
    if (filterMode === 'all') return matchesSearch;
    
    return matchesSearch;
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
            {(['all', 'corpus', 'general'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterMode === mode
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
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
                        <div className="flex items-start justify-between mb-2">
                          <p className="font-medium text-sm text-slate-800 line-clamp-2 flex-1 mr-2">
                            {session.name}
                          </p>
                          <button
                            onClick={(e) => deleteSession(session.id, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                          >
                            <Trash2 size={14} className="text-red-600" />
                          </button>
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
              <h3 className="text-lg font-semibold text-slate-800">
                {sessions.find(s => s.id === selectedSession)?.name}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {messages.length} messages • Last updated {new Date(sessions.find(s => s.id === selectedSession)?.updated_at || '').toLocaleString()}
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6">
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
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>
                      
                      {message.documents_used && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-xs text-slate-500 flex items-center gap-1">
                            <FileText size={12} />
                            Corpus Search • {JSON.parse(message.documents_used).length} document(s)
                          </p>
                        </div>
                      )}
                      
                      <p className="text-xs opacity-60 mt-2">
                        {new Date(message.created_at).toLocaleString()}
                      </p>
                    </div>

                    {message.role === 'user' && (
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-slate-600 font-semibold text-sm">You</span>
                      </div>
                    )}
                  </div>
                ))}
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