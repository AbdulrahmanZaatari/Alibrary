'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSwipeable } from 'react-swipeable';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React from 'react';
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
  Settings,
  Copy,
  Check,
  Upload,
  BookOpen,
  Home,
  Clock,
  Trash2
} from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Best)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  modelUsed?: string;
}

interface Book {
  id: string;
  title: string;
  author: string;
  file_path: string;
  uploaded_at: string;
  filename: string;
  page_count: number;
  current_page: number;
  last_read: string;
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

interface ChatSession {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface MobileReaderModeProps {
  onClose: () => void;
}

export default function MobileReaderMode({ onClose }: MobileReaderModeProps) {
  // Book Selection State
  const [showBookSelection, setShowBookSelection] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // PDF State
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pdfError, setPdfError] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'pdf' | 'chat'>('pdf');
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
  const [currentStreamingModel, setCurrentStreamingModel] = useState<string>('');
  
  // Session State
  const [bookSessions, setBookSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);
  
  // Settings State
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [selectedCorpus, setSelectedCorpus] = useState<string[]>([]);
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [useReranking, setUseReranking] = useState(true);
  const [useKeywordSearch, setUseKeywordSearch] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // ==================== EFFECTS ====================

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (chatEndRef.current && chatContainerRef.current) {
      const container = chatContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      if (isNearBottom || isStreaming) {
        chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  }, [messages, streamingContent, isStreaming]);

  useEffect(() => {
    fetchBooks();
    fetchCorpusDocuments();
    fetchCustomPrompts();
  }, []);

  useEffect(() => {
    if (selectedBook) {
      loadBookSessions(selectedBook.id);
    }
  }, [selectedBook?.id]);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  // ==================== BOOK FUNCTIONS ====================

  async function fetchBooks() {
    setLoadingBooks(true);
    try {
      const res = await fetch('/api/books');
      if (!res.ok) {
        throw new Error('Failed to fetch books');
      }
      const data = await res.json();
      setBooks(data.books || []);
    } catch (error) {
      console.error('Error fetching books:', error);
      setBooks([]);
    } finally {
      setLoadingBooks(false);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a PDF file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/books/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        await fetchBooks();
        alert('✅ Book uploaded successfully!');
      } else {
        const error = await res.json();
        alert(`❌ Upload failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload book');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function selectBook(book: Book) {
    setSelectedBook(book);
    setShowBookSelection(false);
    setCurrentPage(book.current_page || 1);
    setPdfError(false);
    setExtractedText('');
    setMessages([]);
    setCurrentSessionId(null);
    
    await loadBookPdf(book);
  }

  async function loadBookPdf(book: Book) {
    try {
      setLoading(true);
      
      const res = await fetch(`/api/books/${book.id}/pdf`);
      
      if (!res.ok) {
        throw new Error(`Failed to load PDF: ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      setPdfUrl(url);
    } catch (error) {
      console.error('Error loading PDF:', error);
      setPdfError(true);
      setPdfUrl(null);
    } finally {
      setLoading(false);
    }
  }

  async function updateReadingPosition(bookId: string, page: number) {
    try {
      await fetch('/api/books/reading-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, currentPage: page }),
      });
    } catch (error) {
      console.error('Error updating reading position:', error);
    }
  }

  useEffect(() => {
    if (selectedBook?.id && currentPage > 0) {
      updateReadingPosition(selectedBook.id, currentPage);
    }
  }, [currentPage, selectedBook?.id]);

  // ==================== API FUNCTIONS ====================

  async function fetchCorpusDocuments() {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) {
        console.error('Failed to fetch corpus documents:', res.status);
        setCorpusDocuments([]);
        setSelectedCorpus([]);
        return;
      }
      
      const data = await res.json();
      
      if (!data || !Array.isArray(data.documents)) {
        console.warn('Invalid documents response:', data);
        setCorpusDocuments([]);
        setSelectedCorpus([]);
        return;
      }
      
      setCorpusDocuments(data.documents);
      setSelectedCorpus(
        data.documents
          .filter((d: CorpusDocument) => d.is_selected === 1)
          .map((d: CorpusDocument) => d.id)
      );
    } catch (error) {
      console.error('Error fetching corpus:', error);
      setCorpusDocuments([]);
      setSelectedCorpus([]);
    }
  }

  async function fetchCustomPrompts() {
    try {
      const res = await fetch('/api/prompts');
      if (!res.ok) {
        throw new Error('Failed to fetch prompts');
      }
      const data = await res.json();
      setCustomPrompts(data.prompts || []);
    } catch (error) {
      console.error('Error fetching prompts:', error);
      setCustomPrompts([]);
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

  // ==================== SESSION MANAGEMENT ====================

  async function loadBookSessions(bookId: string) {
    try {
      const res = await fetch(`/api/reader-chat/sessions?bookId=${bookId}`);
      if (!res.ok) {
        console.warn('Failed to fetch sessions:', res.status);
        setBookSessions([]);
        return;
      }
      const data = await res.json();
      setBookSessions(data || []);
    } catch (error) {
      console.error('Error loading sessions:', error);
      setBookSessions([]);
    }
  }

  async function loadSessionMessages(sessionId: string) {
    try {
      const res = await fetch(`/api/reader-chat/messages?sessionId=${sessionId}`);
      if (!res.ok) {
        console.warn('Failed to fetch messages:', res.status);
        return;
      }
      const data = await res.json();
      
      const formattedMessages = data.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at)
      }));
      
      setMessages(formattedMessages);
      setCurrentSessionId(sessionId);
      setShowSessionList(false);
      
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  async function startNewSession() {
    if (!selectedBook) return;
    
    try {
      const res = await fetch('/api/reader-chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          bookTitle: selectedBook.title,
        }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to create session');
      }
      
      const { sessionId } = await res.json();
      
      setCurrentSessionId(sessionId);
      setMessages([]);
      await loadBookSessions(selectedBook.id);
      setShowSessionList(false);
    } catch (error) {
      console.error('Error creating session:', error);
    }
  }

  async function deleteSession(sessionId: string) {
    if (!confirm('Delete this chat session?')) return;
    
    try {
      await fetch('/api/reader-chat/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      });
      
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      
      if (selectedBook) {
        await loadBookSessions(selectedBook.id);
      }
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  }

  async function renameSession(sessionId: string, newName: string) {
    try {
      await fetch('/api/reader-chat/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, name: `Chat: ${newName}` }),
      });

      if (selectedBook) {
        await loadBookSessions(selectedBook.id);
      }
    } catch (error) {
      console.error('Error renaming session:', error);
    }
  }

  // ==================== PDF FUNCTIONS ====================

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPdfError(false);
  }

  function onDocumentLoadError(error: Error) {
    console.error('PDF load error:', error);
    setPdfError(true);
  }

  const goToNextPage = useCallback(() => {
    if (currentPage < numPages) {
      setCurrentPage(prev => prev + 1);
      setExtractedText('');
    }
  }, [currentPage, numPages]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
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
    if (!selectedBook) return;
    
    setExtracting(true);
    try {
      const extractRes = await fetch('/api/books/extract-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
          enableAiCorrection: false,
        }),
      });

      const extractData = await extractRes.json();
      
      if (!extractData.success) {
        setExtractedText('❌ Failed to extract text from this page.');
        return;
      }

      const rawText = extractData.text;
      const isArabic = extractData.language === 'ar';

      if (rawText && rawText.length > 20) {
        const fixRes = await fetch('/api/fix-spelling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            text: rawText, 
            useAI: true,
            language: isArabic ? 'ar' : 'en'
          }),
        });

        if (fixRes.ok) {
          const fixData = await fixRes.json();
          if (fixData.success) {
            setExtractedText(fixData.fixed);
          } else {
            setExtractedText(rawText);
          }
        } else {
          setExtractedText(rawText);
        }
      } else {
        setExtractedText(rawText);
      }

    } catch (error) {
      console.error('Extraction error:', error);
      setExtractedText('❌ Error extracting text.');
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
    if (!userInput.trim() || !selectedBook) return;

    const trimmedMessage = userInput.trim();
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: trimmedMessage,
      timestamp: new Date()
    }]);
    setUserInput('');
    setSending(true);

    try {
      if (!currentSessionId) {
        const sessionRes = await fetch('/api/reader-chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookId: selectedBook.id,
            bookTitle: selectedBook.title,
          }),
        });
        
        if (!sessionRes.ok) {
          throw new Error('Failed to create chat session');
        }
        
        const { sessionId } = await sessionRes.json();
        setCurrentSessionId(sessionId);
        
        await sendMessageWithSession(sessionId, trimmedMessage, true);
        await loadBookSessions(selectedBook.id);
      } else {
        await sendMessageWithSession(currentSessionId, trimmedMessage, false);
      }
      
    } catch (error) {
      console.error('Chat error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
      const isQuotaError = errorMessage.toLowerCase().includes('quota');
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: isQuotaError 
          ? '⚠️ All AI models are currently at capacity. Please try again in a few moments.'
          : `❌ ${errorMessage}`,
        timestamp: new Date()
      }]);
    } finally {
      setSending(false);
    }
  };

  async function sendMessageWithSession(sessionId: string, userMessage: string, isNewSession: boolean) {
    const selectedPrompt = selectedPromptId 
      ? customPrompts.find(p => p.id === selectedPromptId)?.template 
      : '';

    setModelError(null);
    setUsedModel(null);
    setIsStreaming(true);
    setStreamingContent('');
    setCurrentStreamingModel('');

    const res = await fetch('/api/reader-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMessage,
        sessionId: sessionId,
        documentIds: selectedCorpus,
        bookId: selectedBook?.id,
        bookTitle: selectedBook?.title,
        bookPage: currentPage,
        extractedText: extractedText || undefined,
        preferredModel: selectedModel,
        customPrompt: selectedPrompt || '',
        useReranking: useKeywordSearch ? false : useReranking,
        useKeywordSearch: useKeywordSearch,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      setIsStreaming(false);
      
      if (errorText.includes('All models failed') || errorText.includes('quota')) {
        setModelError(errorText);
        throw new Error(`Model Error: ${errorText}`);
      }
      
      throw new Error(`API error: ${res.status}`);
    }

    const modelUsedHeader = res.headers.get('X-Model-Used');
    if (modelUsedHeader) {
      setUsedModel(modelUsedHeader);
      setCurrentStreamingModel(modelUsedHeader);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No streaming reader available');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        setStreamingContent(fullResponse);
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      setIsStreaming(false);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: fullResponse,
        timestamp: new Date(),
        modelUsed: modelUsedHeader || selectedModel
      }]);
      setStreamingContent('');
      setCurrentStreamingModel('');
      
    } catch (streamError) {
      console.error('Stream reading error:', streamError);
      setIsStreaming(false);
      setStreamingContent('');
      throw streamError;
    }

    try {
      await fetch('/api/reader-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          userMessage,
          assistantMessage: fullResponse,
          customPromptName: selectedPromptId 
            ? customPrompts.find(p => p.id === selectedPromptId)?.name 
            : null,
        }),
      });
    } catch (error) {
      console.error('Failed to save messages:', error);
    }

    if (isNewSession) {
      const words = userMessage.trim().split(/\s+/).slice(0, 5).join(' ');
      const autoName = words.length > 40 ? words.substring(0, 40) + '...' : words;
      await renameSession(sessionId, autoName);
      
      if (selectedBook) {
        await loadBookSessions(selectedBook.id);
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ==================== COMPONENTS ====================

  const MessageBubble = React.memo(({ msg }: { msg: Message }) => {
    const [msgCopied, setMsgCopied] = React.useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(msg.content);
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 2000);
    };

    return (
      <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-lg ${
          msg.role === 'user' 
            ? 'bg-blue-600 text-white p-3' 
            : 'bg-slate-50 border border-slate-200'
        }`}>
          {msg.role === 'assistant' ? (
            <div className="relative">
              <div className="flex justify-end mb-1">
                <button
                  onClick={handleCopy}
                  className="p-1 bg-slate-100 rounded hover:bg-slate-200 text-xs"
                >
                  {msgCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <div 
                className="prose prose-sm max-w-none p-3"
                dir={msg.content.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
              {msg.modelUsed && (
                <p className="text-xs text-slate-400 px-3 pb-2">
                  🤖 {msg.modelUsed}
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <p className="text-xs opacity-70 mt-1">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </>
          )}
        </div>
      </div>
    );
  });

  MessageBubble.displayName = 'MessageBubble';

  const StreamingMessage = React.memo(({ content, model }: { content: string; model?: string }) => {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-lg bg-slate-50 border border-slate-200 border-blue-400">
          <div className="relative p-3">
            <div 
              className="prose prose-sm max-w-none"
              dir={content.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
            <div className="flex items-center justify-between mt-2">
              <Loader2 className="animate-spin text-blue-600" size={14} />
              {model && (
                <span className="text-xs text-slate-500">🤖 {model}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  });

  StreamingMessage.displayName = 'StreamingMessage';

  // ==================== RENDER ====================

  // Book Selection Screen
  if (showBookSelection) {
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="bg-white border-b shadow-sm">
          <div className="flex items-center justify-between p-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              📚 Book Reader
            </h1>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-4 bg-white border-b">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={20} />
                Upload New PDF
              </>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loadingBooks ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-blue-600" size={48} />
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <BookOpen size={64} className="mb-4 opacity-50" />
              <p className="text-lg font-medium">No books yet</p>
              <p className="text-sm mt-2">Upload your first PDF to get started</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {books.map((book) => (
                <button
                  key={book.id}
                  onClick={() => selectBook(book)}
                  className="p-4 bg-white rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg">
                      <BookOpen size={24} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {book.title}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {book.author || 'Unknown Author'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Page {book.current_page || 1} of {book.page_count || '?'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(book.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Reader Screen
  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="flex items-center justify-between p-3">
          <button
            onClick={() => setShowBookSelection(true)}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <Home size={20} />
          </button>
          
          <div className="flex-1 text-center px-4">
            <h2 className="font-semibold text-sm truncate">
              {selectedBook?.title}
            </h2>
            <p className="text-xs opacity-90">
              Page {currentPage} of {numPages}
            </p>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg transition-colors ${
              showSettings ? 'bg-white/30' : 'hover:bg-white/20'
            }`}
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Tab Switcher for Mobile */}
        {isMobile && (
          <div className="flex border-t border-white/20">
            <button
              onClick={() => setActiveTab('pdf')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'pdf'
                  ? 'bg-white/20 border-b-2 border-white'
                  : 'hover:bg-white/10'
              }`}
            >
              📄 PDF
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'chat'
                  ? 'bg-white/20 border-b-2 border-white'
                  : 'hover:bg-white/10'
              }`}
            >
              💬 Chat
            </button>
          </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 border-b bg-gray-50 max-h-64 overflow-y-auto">
          <div className="space-y-3">
            {/* Model Selection */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                AI Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  setModelError(null);
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ fontSize: '16px' }}
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

            {/* Corpus Selection */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                References ({selectedCorpus.length})
              </label>
              <div className="max-h-24 overflow-y-auto border rounded-lg p-2 bg-white">
                {corpusDocuments.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-2">
                    No documents available
                  </p>
                ) : (
                  corpusDocuments.map((doc) => (
                    <label key={doc.id} className="flex items-center gap-2 p-1 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedCorpus.includes(doc.id)}
                        onChange={() => toggleCorpusDocument(doc.id)}
                        className="rounded"
                      />
                      <span className="truncate">{doc.display_name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Custom Prompt */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Prompt Template
              </label>
              <select
                value={selectedPromptId || ''}
                onChange={(e) => setSelectedPromptId(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
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

            {/* Toggles */}
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-between p-2 bg-purple-50 rounded border text-xs">
                <span>Reranking</span>
                <input
                  type="checkbox"
                  checked={useReranking}
                  onChange={(e) => setUseReranking(e.target.checked)}
                  className="rounded"
                />
              </label>
              <label className="flex-1 flex items-center justify-between p-2 bg-amber-50 rounded border text-xs">
                <span>Keyword</span>
                <input
                  type="checkbox"
                  checked={useKeywordSearch}
                  onChange={(e) => setUseKeywordSearch(e.target.checked)}
                  className="rounded"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - Split or Tabbed */}
      <div className={`flex-1 overflow-hidden ${isMobile ? '' : 'flex'}`}>
        {/* PDF View */}
        <div className={`${
          isMobile 
            ? activeTab === 'pdf' ? 'flex flex-col h-full' : 'hidden'
            : 'flex-1 flex flex-col border-r'
        }`}>
          {/* PDF Controls */}
          <div className="flex items-center justify-between p-2 border-b bg-gray-50">
            <button
              onClick={goToPreviousPage}
              disabled={currentPage <= 1}
              className="p-2 bg-white border rounded-lg disabled:opacity-50"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="p-2 bg-white border rounded-lg"
              >
                <ZoomOut size={16} />
              </button>
              <span className="text-xs font-medium min-w-[50px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(z => Math.min(2, z + 0.25))}
                className="p-2 bg-white border rounded-lg"
              >
                <ZoomIn size={16} />
              </button>
            </div>

            <button
              onClick={goToNextPage}
              disabled={currentPage >= numPages}
              className="p-2 bg-white border rounded-lg disabled:opacity-50"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Extract Button */}
          <div className="p-2 border-b">
            <button
              onClick={extractPageText}
              disabled={extracting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-400"
            >
              {extracting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <FileText size={16} />
                  Extract Text
                </>
              )}
            </button>

            {extractedText && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    Extracted:
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="text-xs px-2 py-1 bg-gray-100 rounded flex items-center gap-1"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs max-h-20 overflow-auto">
                  {extractedText}
                </div>
              </div>
            )}
          </div>

          {/* PDF Viewer */}
          <div
            {...swipeHandlers}
            ref={containerRef}
            className="flex-1 overflow-auto bg-gray-100 p-2"
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="animate-spin text-blue-600" size={40} />
              </div>
            ) : pdfError ? (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <FileText size={48} className="text-red-600 mb-2" />
                <p className="text-red-600 font-medium">Failed to load PDF</p>
                <p className="text-sm text-gray-600 mt-2">
                  Please try another book or re-upload
                </p>
                <button
                  onClick={() => setShowBookSelection(true)}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
                >
                  Choose Another Book
                </button>
              </div>
            ) : selectedBook && pdfUrl ? (
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="animate-spin text-blue-600" size={40} />
                  </div>
                }
              >
                <div className="flex justify-center">
                  <Page
                    pageNumber={currentPage}
                    scale={zoom}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    className="shadow-lg"
                  />
                </div>
              </Document>
            ) : null}
          </div>
        </div>

        {/* Chat View */}
        <div className={`${
          isMobile 
            ? activeTab === 'chat' ? 'flex flex-col h-full' : 'hidden'
            : 'w-full md:w-96 flex flex-col'
        }`}>
          {/* Session Header */}
          <div className="p-2 border-b bg-white flex items-center justify-between">
            <button
              onClick={() => setShowSessionList(!showSessionList)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-xs hover:bg-slate-200"
            >
              <Clock size={14} />
              History
            </button>
            <button
              onClick={startNewSession}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
            >
              New Chat
            </button>
          </div>

          {/* Session List */}
          {showSessionList && (
            <div className="p-2 border-b bg-gray-50 max-h-48 overflow-y-auto">
              {bookSessions.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">No sessions yet</p>
              ) : (
                <div className="space-y-1">
                  {bookSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`p-2 rounded border cursor-pointer group ${
                        currentSessionId === session.id
                          ? 'bg-blue-50 border-blue-300'
                          : 'bg-white border-gray-200 hover:border-blue-200'
                      }`}
                      onClick={() => loadSessionMessages(session.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {session.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(session.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(session.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50"
          >
            {messages.length === 0 && !isStreaming ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                <MessageSquare size={40} className="mb-3 opacity-50" />
                <p className="text-sm">Ask me anything!</p>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <MessageBubble key={i} msg={msg} />
                ))}
                
                {isStreaming && streamingContent && (
                  <StreamingMessage 
                    content={streamingContent}
                    model={currentStreamingModel}
                  />
                )}
                
                {isStreaming && !streamingContent && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Loader2 className="animate-spin" size={16} />
                    <span>Receiving response...</span>
                  </div>
                )}
                
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t bg-white">
            {(sending || isStreaming) && (
              <div className="mb-2 flex items-center gap-2 text-xs text-blue-600">
                <Loader2 className="animate-spin" size={14} />
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
                className="flex-1 px-3 py-2 border rounded-lg resize-none text-sm"
                rows={2}
                style={{ fontSize: '16px' }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || isStreaming || !userInput.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400"
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
    </div>
  );
}