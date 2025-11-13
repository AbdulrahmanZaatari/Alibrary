'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSwipeable } from 'react-swipeable';
import { Document, Page, pdfjs } from 'react-pdf';
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  X, 
  MessageSquare, 
  Send,
  Loader2,
  FileText,
  Sparkles,
  Menu
} from 'lucide-react';

// Remove CSS imports - handle styling directly
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  bookId: string;
  bookTitle: string;
  messages: Message[];
  createdAt: Date;
  lastUpdated: Date;
}

interface MobileReaderModeProps {
  selectedBook: any;
  onClose: () => void;
}

export default function MobileReaderMode({ selectedBook, onClose }: MobileReaderModeProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [extractedText, setExtractedText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-2.0-flash-exp' | 'gemini-exp-1206'>('gemini-2.0-flash-exp');
  
  // Session management
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [showSessions, setShowSessions] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);

  // Load sessions from localStorage on mount
  useEffect(() => {
    const savedSessions = localStorage.getItem('readerSessions');
    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastUpdated: new Date(s.lastUpdated),
          messages: s.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }))
        })));
      } catch (error) {
        console.error('Failed to load sessions:', error);
      }
    }

    const bookSessionId = `session-${selectedBook.id}-${Date.now()}`;
    setCurrentSessionId(bookSessionId);
  }, [selectedBook.id]);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('readerSessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  // Update current session
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setSessions(prev => {
        const existing = prev.find(s => s.id === currentSessionId);
        if (existing) {
          return prev.map(s => 
            s.id === currentSessionId 
              ? { ...s, messages, lastUpdated: new Date() }
              : s
          );
        } else {
          return [...prev, {
            id: currentSessionId,
            bookId: selectedBook.id,
            bookTitle: selectedBook.title,
            messages,
            createdAt: new Date(),
            lastUpdated: new Date()
          }];
        }
      });
    }
  }, [messages, currentSessionId, selectedBook.id, selectedBook.title]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-hide controls on mobile
  useEffect(() => {
    if (!isMobile) return;

    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }

    hideControlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);

    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [currentPage, showControls, isMobile]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const goToNextPage = useCallback(() => {
    if (currentPage < numPages) {
      setCurrentPage(prev => prev + 1);
      setShowControls(true);
      setExtractedText('');
    }
  }, [currentPage, numPages]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
      setShowControls(true);
      setExtractedText('');
    }
  }, [currentPage]);

  // Swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => goToNextPage(),
    onSwipedRight: () => goToPreviousPage(),
    trackMouse: false,
    trackTouch: true,
    preventScrollOnSwipe: true,
    delta: 50,
  });

  // Extract text
  const extractPageText = async () => {
    setExtracting(true);
    try {
      const res = await fetch('/api/books/extract-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
          enableAiCorrection: false
        })
      });

      const data = await res.json();
      if (data.success && data.text) {
        setExtractedText(data.text);
      } else {
        setExtractedText('No text found on this page.');
      }
    } catch (error) {
      console.error('Failed to extract text:', error);
      setExtractedText('Failed to extract text.');
    } finally {
      setExtracting(false);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!userInput.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: userInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          documentIds: [selectedBook.id],
          bookTitle: selectedBook.title,
          bookPage: currentPage,
          extractedText: extractedText || undefined,
          preferredModel: selectedModel,
          conversationHistory: messages.slice(-6).map(m => ({
            role: m.role,
            content: m.content
          }))
        })
      });

      if (!res.ok) throw new Error('Failed to get response');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date()
          };
          return newMessages;
        });
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Failed to get response. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setShowSessions(false);
  };

  const createNewSession = () => {
    const newSessionId = `session-${selectedBook.id}-${Date.now()}`;
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setShowSessions(false);
  };

  const deleteSession = (sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      createNewSession();
    }
  };

  const calculateZoom = () => {
    if (!containerRef.current) return 1;
    const width = containerRef.current.clientWidth;
    return width < 768 ? width / 600 : 1;
  };

  useEffect(() => {
    setZoom(calculateZoom());
    const handleResize = () => setZoom(calculateZoom());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Header */}
      <div 
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent z-10 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between p-3 sm:p-4 text-white">
          <button
            onClick={onClose}
            className="flex items-center gap-2 hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
          >
            <X size={20} />
            <span className="hidden sm:inline">Close</span>
          </button>
          
          <div className="flex-1 text-center px-4">
            <h2 className="font-semibold text-xs sm:text-base truncate">{selectedBook.title}</h2>
            <p className="text-xs text-gray-300">
              Page {currentPage} of {numPages}
            </p>
          </div>

          <button
            onClick={() => {
              setShowChat(!showChat);
              setShowSessions(false);
            }}
            className="flex items-center gap-2 hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
          >
            <MessageSquare size={20} />
            <span className="hidden sm:inline">Chat</span>
          </button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div
        {...swipeHandlers}
        ref={containerRef}
        onClick={() => setShowControls(!showControls)}
        className="flex-1 overflow-auto flex items-center justify-center bg-gray-800"
        style={{ touchAction: 'pan-y pinch-zoom' }}
      >
        <Document
          file={`/api/books/${selectedBook.id}/pdf`}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-full text-white">
              <Loader2 className="animate-spin" size={48} />
            </div>
          }
          error={
            <div className="flex items-center justify-center h-full text-white">
              <p>Failed to load PDF</p>
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={zoom}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="shadow-2xl"
          />
        </Document>
      </div>

      {/* Bottom Controls */}
      <div 
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent z-10 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between p-3 sm:p-4 text-white">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm"
          >
            <ChevronLeft size={20} />
            <span className="hidden sm:inline">Prev</span>
          </button>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-xs sm:text-sm min-w-[50px] text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.25))}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          <button
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={20} />
          </button>
        </div>

        {isMobile && currentPage === 1 && (
          <div className="text-center pb-2 text-white/60 text-xs swipe-hint">
            ← Swipe to navigate →
          </div>
        )}
      </div>

      {/* Chat Panel */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300 z-20 ${
          showChat ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Chat Header */}
          <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
            <div className="flex items-center gap-2">
              <Sparkles size={20} />
              <h3 className="font-semibold">AI Assistant</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSessions(!showSessions)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                title="Sessions"
              >
                <Menu size={18} />
              </button>
              <button
                onClick={() => setShowChat(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="p-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '16px' }}
            >
              <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Fast)</option>
              <option value="gemini-exp-1206">Gemini Exp 1206 (Advanced)</option>
            </select>
          </div>

          {/* Extract Button */}
          <div className="p-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <button
              onClick={extractPageText}
              disabled={extracting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              {extracting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <FileText size={16} />
                  Extract Page {currentPage}
                </>
              )}
            </button>

            {extractedText && (
              <div className="mt-2 p-3 bg-white dark:bg-gray-700 rounded-lg text-xs max-h-32 overflow-auto border dark:border-gray-600">
                <p className="whitespace-pre-wrap">{extractedText}</p>
              </div>
            )}
          </div>

          {/* Sessions Panel */}
          {showSessions && (
            <div className="absolute inset-0 bg-white dark:bg-gray-900 z-10 flex flex-col">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="font-semibold dark:text-white">Chat Sessions</h3>
                <button 
                  onClick={() => setShowSessions(false)} 
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4">
                <button
                  onClick={createNewSession}
                  className="w-full mb-3 px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 font-medium transition-all"
                >
                  + New Session
                </button>

                {sessions
                  .filter(s => s.bookId === selectedBook.id)
                  .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
                  .map(session => (
                    <div
                      key={session.id}
                      className={`mb-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                        session.id === currentSessionId
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => loadSession(session)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium dark:text-white">
                            {session.messages.length} messages
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {session.lastUpdated.toLocaleDateString()} {session.lastUpdated.toLocaleTimeString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(session.id);
                          }}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-600"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}

                {sessions.filter(s => s.bookId === selectedBook.id).length === 0 && (
                  <p className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">
                    No sessions yet. Start chatting to create one!
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                <MessageSquare size={48} className="mb-4 opacity-50" />
                <p className="text-sm">Start a conversation with AI</p>
                <p className="text-xs mt-2">Extract page text for better context</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-4 py-2 ${
                    msg.role === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex gap-2">
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about this page..."
                disabled={sending}
                className="flex-1 px-4 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                rows={2}
                style={{ fontSize: '16px' }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !userInput.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                {sending ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Send size={20} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}