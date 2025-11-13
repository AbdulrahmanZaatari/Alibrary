'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSwipeable } from 'react-swipeable';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  Menu,
  Settings,
  Copy,
  Check,
  BookOpen
} from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface CorpusDocument {
  id: string;
  display_name: string;
  is_selected: number;
}

interface CustomPrompt {
  id: string;
  name: string;
  template: string;
  category: string;
}

interface MobileReaderModeProps {
  selectedBook: any;
  onClose: () => void;
}

export default function MobileReaderMode({ selectedBook, onClose }: MobileReaderModeProps) {
  // PDF State
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showControls, setShowControls] = useState(true);
  
  // UI State
  const [showChat, setShowChat] = useState(true); // ✅ Chat always visible on mobile
  const [showSettings, setShowSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  // Text Extraction
  const [extractedText, setExtractedText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Settings State
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [selectedCorpus, setSelectedCorpus] = useState<string[]>([]);
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [useReranking, setUseReranking] = useState(true);
  const [useKeywordSearch, setUseKeywordSearch] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);

  // ==================== EFFECTS ====================

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-hide controls
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
  }, [messages, streamingContent]);

  // Load corpus documents
  useEffect(() => {
    fetchCorpusDocuments();
    fetchCustomPrompts();
  }, []);

  // ==================== API FUNCTIONS ====================

  async function fetchCorpusDocuments() {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) return;
      
      const data = await res.json();
      setCorpusDocuments(data.documents || []);
      setSelectedCorpus(
        (data.documents || [])
          .filter((d: CorpusDocument) => d.is_selected === 1)
          .map((d: CorpusDocument) => d.id)
      );
    } catch (error) {
      console.error('Error fetching corpus:', error);
    }
  }

  async function fetchCustomPrompts() {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      setCustomPrompts(data.prompts || []);
    } catch (error) {
      console.error('Error fetching prompts:', error);
    }
  }

  async function toggleCorpusDocument(docId: string) {
    try {
      const isSelected = selectedCorpus.includes(docId);
      await fetch('/api/documents/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, selected: !isSelected }),
      });
      
      if (isSelected) {
        setSelectedCorpus(prev => prev.filter(id => id !== docId));
      } else {
        setSelectedCorpus(prev => [...prev, docId]);
      }
    } catch (error) {
      console.error('Error toggling corpus doc:', error);
    }
  }

  // ==================== PDF FUNCTIONS ====================

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

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => goToNextPage(),
    onSwipedRight: () => goToPreviousPage(),
    trackMouse: false,
    trackTouch: true,
    preventScrollOnSwipe: true,
    delta: 50,
  });

  // ==================== TEXT EXTRACTION ====================

  const extractPageText = async () => {
    setExtracting(true);
    try {
      const res = await fetch('/api/books/extract-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
          enableAiCorrection: true
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

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  // ==================== CHAT FUNCTIONS ====================

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
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const res = await fetch('/api/reader-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          documentIds: selectedCorpus,
          bookId: selectedBook.id,
          bookTitle: selectedBook.title,
          bookPage: currentPage,
          extractedText: extractedText || undefined,
          preferredModel: selectedModel,
          customPrompt: selectedPromptId 
            ? customPrompts.find(p => p.id === selectedPromptId)?.template 
            : '',
          useReranking: useKeywordSearch ? false : useReranking,
          useKeywordSearch: useKeywordSearch,
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

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;
        setStreamingContent(assistantContent);
      }

      setIsStreaming(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date()
      }]);
      setStreamingContent('');

    } catch (error) {
      console.error('Chat error:', error);
      setIsStreaming(false);
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

  // ==================== RENDER ====================

  return (
    <div className="h-screen flex flex-col md:flex-row bg-gray-50">
      {/* 📖 LEFT SIDE - PDF VIEWER */}
      <div className="flex-1 flex flex-col bg-white border-r">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b bg-gradient-to-r from-blue-50 to-purple-50">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-2 hover:bg-white rounded-lg transition-colors"
          >
            <X size={20} />
            <span className="hidden sm:inline">Close</span>
          </button>
          
          <div className="flex-1 text-center px-4">
            <h2 className="font-semibold text-sm truncate">{selectedBook.title}</h2>
            <p className="text-xs text-gray-500">
              Page {currentPage} of {numPages}
            </p>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg transition-colors ${
              showSettings ? 'bg-blue-100 text-blue-600' : 'hover:bg-white'
            }`}
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Page Navigation */}
        <div className="flex items-center justify-between p-3 border-b bg-gray-50">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 px-3 py-2 bg-white border rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            <ChevronLeft size={18} />
            Prev
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              className="p-2 bg-white border rounded-lg hover:bg-gray-100"
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-sm min-w-[60px] text-center font-medium">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.25))}
              className="p-2 bg-white border rounded-lg hover:bg-gray-100"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          <button
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
            className="flex items-center gap-1 px-3 py-2 bg-white border rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            Next
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Extract Text Button */}
        <div className="p-3 border-b bg-white">
          <button
            onClick={extractPageText}
            disabled={extracting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium transition-colors"
          >
            {extracting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <FileText size={16} />
                Extract Page Text
              </>
            )}
          </button>

          {extractedText && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Extracted Text:</span>
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm max-h-40 overflow-auto">
                <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                  {extractedText}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* PDF Viewer */}
        <div
          {...swipeHandlers}
          ref={containerRef}
          onClick={() => setShowControls(!showControls)}
          className="flex-1 overflow-auto bg-gray-100 p-4"
          style={{ touchAction: 'pan-y pinch-zoom' }}
        >
          <Document
            file={`/api/books/${selectedBook.id}/pdf`}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="animate-spin text-blue-600" size={48} />
              </div>
            }
            error={
              <div className="flex items-center justify-center h-full text-red-600">
                <p>Failed to load PDF</p>
              </div>
            }
          >
            <div className="flex justify-center">
              <Page
                pageNumber={currentPage}
                scale={zoom}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="shadow-2xl"
              />
            </div>
          </Document>
        </div>

        {isMobile && currentPage === 1 && (
          <div className="p-2 text-center text-gray-500 text-xs border-t bg-white">
            ← Swipe to navigate →
          </div>
        )}
      </div>

      {/* 💬 RIGHT SIDE - AI CHAT PANEL */}
      <div className="w-full md:w-[420px] flex flex-col bg-white border-l">
        {/* Chat Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <div className="flex items-center gap-2">
            <Sparkles size={20} />
            <h3 className="font-semibold">AI Assistant</h3>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="p-4 border-b bg-gray-50 max-h-96 overflow-y-auto">
            {/* Model Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }}
              >
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash lite</option>
                <option value="gemini-2.0-flash">Gemini 2/0 flash</option>
                                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash lite</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              </select>
            </div>

            {/* Corpus Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference Documents ({selectedCorpus.length})
              </label>
              <div className="max-h-32 overflow-y-auto border rounded-lg p-2 bg-white">
                {corpusDocuments.map((doc) => (
                  <label key={doc.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCorpus.includes(doc.id)}
                      onChange={() => toggleCorpusDocument(doc.id)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-xs">{doc.display_name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Custom Prompt */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Prompt Template
              </label>
              <select
                value={selectedPromptId || ''}
                onChange={(e) => setSelectedPromptId(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }}
              >
                <option value="">Default</option>
                {customPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Options */}
            <div className="space-y-2">
              <label className="flex items-center justify-between p-2 bg-purple-50 rounded border">
                <span className="text-xs font-medium">AI Reranking</span>
                <button
                  onClick={() => setUseReranking(!useReranking)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    useReranking ? 'bg-purple-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      useReranking ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>

              <label className="flex items-center justify-between p-2 bg-amber-50 rounded border">
                <span className="text-xs font-medium">Keyword Search</span>
                <button
                  onClick={() => setUseKeywordSearch(!useKeywordSearch)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    useKeywordSearch ? 'bg-amber-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      useKeywordSearch ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
              <MessageSquare size={48} className="mb-4 opacity-50" />
              <p className="text-sm">Ask me anything about this book!</p>
              <p className="text-xs mt-2">Extract page text for better context</p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-4 py-2 ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white border shadow-sm'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                    <p className="text-xs opacity-70 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              
              {isStreaming && streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg px-4 py-2 bg-white border shadow-sm">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                    <div className="mt-2">
                      <Loader2 className="animate-spin text-blue-600" size={14} />
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t bg-white">
          {(sending || isStreaming) && (
            <div className="mb-2 flex items-center gap-2 text-sm text-blue-600">
              <Loader2 className="animate-spin" size={16} />
              {isStreaming ? 'Receiving...' : 'Sending...'}
            </div>
          )}
          
          <div className="flex gap-2">
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about this page..."
              disabled={sending || isStreaming}
              className="flex-1 px-4 py-2 border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 text-sm"
              rows={2}
              style={{ fontSize: '16px' }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || isStreaming || !userInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {sending || isStreaming ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}