'use client';

import { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Bookmark,
  Copy,
  Sparkles,
  Loader2,
  FileText,
  BookmarkPlus,
  X,
  Trash2,
  Upload,
  BookOpen,
  Check,
  MessageSquare,
  Database,
  Send,
  Clock,
  Pencil,
  Menu,
  Settings
} from 'lucide-react';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface Book {
  id: string;
  filename: string;
  title: string;
  size: number;
  page_count: number;
  current_page: number;
  supabase_path: string;
  uploaded_at: string;
  last_read: string;
}

interface BookmarkType {
  id: string;
  page_number: number;
  note: string;
  created_at: string;
}

interface CorpusDocument {
  id: string;
  display_name: string;
  is_selected: number;
}

interface ReaderModeProps {
  persistedBookId?: string | null;
  onBookSelect?: (bookId: string | null) => void;
}

export default function ReaderMode({ persistedBookId, onBookSelect }: ReaderModeProps = {}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enableMultiHop, setEnableMultiHop] = useState(false);
  // Text extraction
  const [extractedText, setExtractedText] = useState('');
  const [showTextPopup, setShowTextPopup] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Bookmarks
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // AI Chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{role: string; content: string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [correctSpelling, setCorrectSpelling] = useState(false);
  const [bookSessions, setBookSessions] = useState<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  
  // Corpus Selector
  const [showCorpus, setShowCorpus] = useState(false);
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [selectedCorpus, setSelectedCorpus] = useState<string[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isLoadingCorpus, setIsLoadingCorpus] = useState(false);

  // Prompts
  const [availablePrompts, setAvailablePrompts] = useState<Array<{
    id: string;
    name: string;
    template: string;
    category: string;
  }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showPromptSelector, setShowPromptSelector] = useState(false);

  // UI State
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);

  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const isMountingRef = useRef(true);

  useEffect(() => {
    fetchBooks();
    fetchCorpusDocuments();
    fetchAvailablePrompts();
    const timer = setTimeout(() => {
      isMountingRef.current = false;
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        console.log('🧹 Cleaning up PDF URL');
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (selectedBook) {
      console.log('📖 Loading book:', selectedBook.title);
      setCurrentPage(selectedBook.current_page);
      setNumPages(0);
      setPdfUrl(null);
      loadBookPdf(selectedBook);
    } else {
      setPdfUrl(null);
      setNumPages(0);
      setCurrentPage(1);
    }
  }, [selectedBook?.id]);

  useEffect(() => {
    if (selectedBook) {
      loadBookSessions(selectedBook.id);
    }
  }, [selectedBook?.id]);

  useEffect(() => {
    if (isMountingRef.current || isRestoringRef.current) {
      return;
    }
    
    if (onBookSelect) {
      console.log('📢 Notifying parent of book selection:', selectedBook?.id || null);
      onBookSelect(selectedBook?.id || null);
    }
  }, [selectedBook?.id, onBookSelect]);

  useEffect(() => {
    if (persistedBookId && books.length > 0 && !hasRestoredRef.current) {
      const book = books.find(b => b.id === persistedBookId);
      if (book) {
        console.log('🔄 Restoring book from persistence:', book.title);
        isRestoringRef.current = true; 
        setSelectedBook(book);
        hasRestoredRef.current = true;
        setTimeout(() => {
          isRestoringRef.current = false;
        }, 0);
      }
    }
  }, [persistedBookId, books]);

  useEffect(() => {
    if (!selectedBook?.id || currentPage <= 0 || currentPage === selectedBook.current_page) {
      return;
    }
    
    const timeoutId = setTimeout(() => {
      updateReadingPosition(selectedBook.id, currentPage);
    }, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [currentPage, selectedBook?.id, selectedBook?.current_page]);

  useEffect(() => {
    const updateWidth = () => {
      const container = document.getElementById('pdf-container');
      if (container) {
        setContainerWidth(container.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [showChat, showBookmarks, showCorpus, libraryCollapsed]);

  useEffect(() => {
    function handleKeyPress(e: KeyboardEvent) {
      if (showTextPopup) {
        if (e.ctrlKey && e.key === 'e') {
          e.preventDefault();
          setShowTextPopup(false);
        }
        return;
      }

      if (!selectedBook) return;

      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        addBookmark();
      }
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        extractPageText();
      }
      if (e.key === 'ArrowLeft') goToPrevPage();
      if (e.key === 'ArrowRight') goToNextPage();
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === '0') resetZoom();
    }

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [showTextPopup, selectedBook, scale]);

  // ==================== API FUNCTIONS ====================

  async function fetchBooks() {
    if (isLoadingBooks) return;
    
    setIsLoadingBooks(true);
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      setBooks(data.books || []);
    } catch (error) {
      console.error('Error fetching books:', error);
    } finally {
      setIsLoadingBooks(false);
    }
  }

  async function fetchCorpusDocuments() {
    if (isLoadingCorpus) return; 
    
    setIsLoadingCorpus(true);
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
    } finally {
      setIsLoadingCorpus(false);
    }
  }

  async function fetchAvailablePrompts() {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      setAvailablePrompts(data.prompts || []);
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

  // ==================== SESSION MANAGEMENT ====================

  async function loadBookSessions(bookId: string) {
    try {
      const res = await fetch(`/api/reader-chat/sessions?bookId=${bookId}`);
      if (!res.ok) {
        console.error('Failed to fetch sessions:', res.status);
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
        console.error('Failed to fetch messages:', res.status);
        return;
      }
      const data = await res.json();
      
      const formattedMessages = data.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      }));
      
      setChatMessages(formattedMessages);
      setCurrentSessionId(sessionId);
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
      const { sessionId } = await res.json();
      
      setCurrentSessionId(sessionId);
      setChatMessages([]);
      await loadBookSessions(selectedBook.id);
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
        setChatMessages([]);
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
      const res = await fetch('/api/reader-chat/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, name: `Chat: ${newName}` }),
      });

      if (!res.ok) {
        throw new Error('Failed to rename session');
      }

      if (selectedBook) {
        await loadBookSessions(selectedBook.id);
      }
    } catch (error) {
      console.error('Error renaming session:', error);
      alert('Failed to rename session');
    }
  }

  async function loadBookPdf(book: Book) {
    try {
      setLoading(true);
      
      const res = await fetch(`/api/books/${book.id}/pdf`);
      
      if (!res.ok) {
        throw new Error(`Failed to load PDF: ${res.status} ${res.statusText}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      console.log('✅ PDF loaded:', url.substring(0, 50) + '...');
      setPdfUrl(url);
    } catch (error) {
      console.error('❌ Error loading PDF:', error);
      alert(`Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setPdfUrl(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
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
      alert('❌ Upload error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteBook(bookId: string) {
    if (!confirm('Delete this book? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/books?id=${bookId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchBooks();
        if (selectedBook?.id === bookId) {
          setSelectedBook(null);
          setPdfUrl(null);
        }
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete book');
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

  async function extractPageText() {
    if (!selectedBook) return;

    setExtracting(true);
    setShowTextPopup(true);
    setExtractedText('🔄 Extracting text from page...\n\nThis may take a few seconds for scanned PDFs.');

    try {
      const res = await fetch('/api/books/extract-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setExtractedText(data.text);
      } else {
        setExtractedText('❌ Failed to extract text from this page.');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      setExtractedText('❌ Error extracting text. Please try again.');
    } finally {
      setExtracting(false);
    }
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || !selectedBook) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    try {
      if (!currentSessionId) {
        console.log('🔄 Creating new session...');
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
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await sendMessageWithSession(sessionId, userMessage, true);
        await loadBookSessions(selectedBook.id);
      } else {
        await sendMessageWithSession(currentSessionId, userMessage, false);
      }
      
    } catch (error) {
      console.error('❌ Chat error:', error);
      
      setChatMessages(prev => {
        const filtered = prev.filter(msg => msg.content !== '');
        return [...filtered, { 
          role: 'assistant', 
          content: `❌ Error: ${error instanceof Error ? error.message : 'Failed to get response'}` 
        }];
      });
    } finally {
      setChatLoading(false);
    }
  }

  async function sendMessageWithSession(sessionId: string, userMessage: string, isNewSession: boolean) {
    const hasCorpus = selectedCorpus.length > 0;
    
    const selectedPrompt = selectedPromptId 
      ? availablePrompts.find(p => p.id === selectedPromptId)?.template 
      : '';
    
    const endpoint = '/api/reader-chat';
    
    const body = {
      message: userMessage,
      sessionId: sessionId,
      documentIds: hasCorpus ? selectedCorpus : [],
      bookId: selectedBook?.id,
      bookTitle: selectedBook?.title,
      bookPage: currentPage,
      extractedText: extractedText || undefined,
      correctSpelling: correctSpelling,
      aggressiveCorrection: false,
      customPrompt: selectedPrompt || '',
      enableMultiHop: enableMultiHop
    };

    console.log('🔄 Sending to:', endpoint, 'Session:', sessionId, 'Has Corpus:', hasCorpus);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`API error: ${res.status} - ${errorText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No streaming reader available');
    }

    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;

      setChatMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > 0) {
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: fullResponse
          };
        }
        return newMessages;
      });
    }

    console.log('✅ Chat response received');
    
    try {
      await fetch('/api/reader-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          userMessage,
          assistantMessage: fullResponse,
          customPromptName: selectedPromptId 
            ? availablePrompts.find(p => p.id === selectedPromptId)?.name 
            : null,
        }),
      });
      console.log('✅ Messages saved to database');
    } catch (error) {
      console.error('❌ Failed to save messages:', error);
    }

    if (isNewSession) {
      try {
        const words = userMessage.trim().split(/\s+/).slice(0, 5).join(' ');
        const autoName = words.length > 40 ? words.substring(0, 40) + '...' : words;
        
        await renameSession(sessionId, autoName);
        
        if (selectedBook) {
          await loadBookSessions(selectedBook.id);
        }
      } catch (error) {
        console.error('Failed to auto-name session:', error);
      }
    }
  }

  // ==================== BOOKMARKS ====================

  async function loadBookmarks() {
    if (!selectedBook) return;

    try {
      const res = await fetch(`/api/bookmarks?bookId=${selectedBook.id}`);
      
      if (!res.ok) {
        console.warn(`Bookmarks fetch failed: ${res.status}`);
        setBookmarks([]);
        return;
      }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Non-JSON response from bookmarks API');
        setBookmarks([]);
        return;
      }

      const data = await res.json();
      setBookmarks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading bookmarks:', error);
      setBookmarks([]);
    }
  }

  async function addBookmark() {
    if (!selectedBook) return;

    const note = prompt('Add a note for this bookmark (optional):');

    try {
      await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
          note: note || '',
        }),
      });
      loadBookmarks();
      alert('✅ Bookmark added!');
    } catch (error) {
      console.error('Error adding bookmark:', error);
      alert('Failed to add bookmark');
    }
  }

  async function deleteBookmark(bookmarkId: string) {
    if (!confirm('Delete this bookmark?')) return;

    try {
      await fetch('/api/bookmarks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookmarkId }),
      });
      loadBookmarks();
    } catch (error) {
      console.error('Error deleting bookmark:', error);
    }
  }

  // ==================== NAVIGATION ====================

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < numPages) setCurrentPage(currentPage + 1);
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3.0));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  const resetZoom = () => {
    setScale(1.0);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ==================== RENDER ====================

  return (
    <div className="h-full flex bg-slate-50">
      {/* Book Library Sidebar - Collapsible */}
      <div className={`bg-white border-r border-slate-200 transition-all duration-300 ${libraryCollapsed ? 'w-14' : 'w-80'} flex flex-col`}>
        {libraryCollapsed ? (
          <div className="p-3 border-b border-slate-200">
            <button
              onClick={() => setLibraryCollapsed(false)}
              className="w-full p-2 hover:bg-slate-100 rounded-lg transition-colors"
              title="Expand Library"
            >
              <Menu size={20} className="mx-auto" />
            </button>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <BookOpen className="text-emerald-600" />
                  My Library
                </h2>
                <button
                  onClick={() => setLibraryCollapsed(true)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Collapse Library"
                >
                  <X size={18} />
                </button>
              </div>

              <label className="block mb-3">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <div
                  className={`w-full px-4 py-3 rounded-lg cursor-pointer text-center font-medium flex items-center justify-center gap-2 transition-colors ${
                    uploading
                      ? 'bg-slate-300 cursor-not-allowed'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {uploading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Upload Book
                    </>
                  )}
                </div>
              </label>

              {books.length > 0 && (
                <select
                  value={selectedBook?.id || ''}
                  onChange={(e) => {
                    const book = books.find(b => b.id === e.target.value);
                    if (book) setSelectedBook(book);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select a book...</option>
                  {books.map(book => (
                    <option key={book.id} value={book.id}>
                      {book.title} (Page {book.current_page}/{book.page_count})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {books.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 text-sm">No books yet</p>
                  <p className="text-slate-400 text-xs mt-1">Upload your first book to start reading</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {books.map((book) => (
                    <div
                      key={book.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedBook?.id === book.id
                          ? 'bg-emerald-50 border-emerald-300'
                          : 'hover:bg-slate-50 border-slate-200'
                      }`}
                      onClick={() => setSelectedBook(book)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{book.title}</p>
                          <p className="text-xs text-slate-500">
                            Page {book.current_page} of {book.page_count}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(book.last_read).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBook(book.id);
                          }}
                          className="p-1 hover:bg-red-100 rounded transition-colors"
                        >
                          <Trash2 size={16} className="text-red-600" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* PDF Viewer Section */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-lg truncate">
            {selectedBook?.title || 'Select a book to read'}
          </h3>
          <div className="flex gap-2">
            {selectedBook && (
              <>
                <button
                  onClick={extractPageText}
                  disabled={extracting}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <FileText size={18} />
                  {extracting ? 'Extracting...' : 'Extract Text'}
                </button>
                
                <button
                  onClick={() => setShowChat(!showChat)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <MessageSquare size={18} />
                  AI Chat
                </button>
              </>
            )}
          </div>
        </div>

        {selectedBook && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <button
                onClick={goToPrevPage}
                disabled={currentPage <= 1}
                className="p-2 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={currentPage}
                  onChange={(e) => {
                    const page = parseInt(e.target.value);
                    if (page >= 1 && page <= numPages) {
                      setCurrentPage(page);
                    }
                  }}
                  className="w-16 px-2 py-1 text-center border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-sm text-slate-600">/ {numPages}</span>
              </div>

              <button
                onClick={goToNextPage}
                disabled={currentPage >= numPages}
                className="p-2 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={zoomOut} className="p-2 rounded-lg hover:bg-white transition-colors" title="Zoom Out (-)">
                <ZoomOut size={20} />
              </button>
              <span className="text-sm font-medium text-slate-700 w-20 text-center">
                {Math.round(scale * 100)}%
              </span>
              <button onClick={zoomIn} className="p-2 rounded-lg hover:bg-white transition-colors" title="Zoom In (+)">
                <ZoomIn size={20} />
              </button>
              <button 
                onClick={resetZoom}
                className="px-3 py-1.5 text-sm rounded-lg hover:bg-white transition-colors"
                title="Reset to 100% (0)"
              >
                Reset
              </button>

              <div className="w-px h-6 bg-slate-300 mx-2"></div>

              <button
                onClick={addBookmark}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <BookmarkPlus size={18} />
                <span className="text-sm font-medium">Bookmark</span>
              </button>

              <button
                onClick={() => {
                  setShowBookmarks(!showBookmarks);
                  if (!showBookmarks) loadBookmarks();
                }}
                className="relative p-2 rounded-lg hover:bg-white transition-colors"
              >
                <Bookmark size={20} />
                {bookmarks.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white text-xs rounded-full flex items-center justify-center">
                    {bookmarks.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}

        <div 
          id="pdf-container"
          className="flex-1 overflow-auto bg-slate-100"
          style={{ 
            display: 'flex', 
            justifyContent: 'center',
            padding: '2rem'
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-emerald-600" size={48} />
            </div>
          ) : pdfUrl ? (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages }) => {
                  console.log('✅ PDF loaded successfully:', numPages, 'pages');
                  setNumPages(numPages);
                  loadBookmarks();
                }}
                onLoadError={(error) => {
                  console.error('❌ PDF load error:', error);
                  alert('Failed to load PDF. Please try uploading again.');
                  setPdfUrl(null);
                  setNumPages(0);
                }}
                loading={
                  <div className="flex items-center justify-center h-96">
                    <Loader2 className="animate-spin text-emerald-600" size={48} />
                  </div>
                }
                className="shadow-2xl"
              >
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadError={(error) => {
                    console.error('❌ Page load error:', error);
                  }}
                  className="shadow-lg"
                />
              </Document>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <BookOpen size={64} className="mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500">Upload a book to start reading</p>
              </div>
            </div>
          )}
        </div>

        {selectedBook && (
          <div className="px-4 py-2 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-600 text-center">
              <span className="font-medium">Shortcuts:</span> ← → (Navigate) | +/- (Zoom) | 0 (Reset) | Ctrl+B (Bookmark) | Ctrl+E (Extract Text)
            </p>
          </div>
        )}
      </div>

      {/* Bookmarks Sidebar */}
      {showBookmarks && selectedBook && (
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Bookmark size={20} className="text-emerald-600" />
              Bookmarks
            </h3>
            <button
              onClick={() => setShowBookmarks(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {bookmarks.length === 0 ? (
              <div className="text-center py-12">
                <Bookmark size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">No bookmarks yet</p>
                <p className="text-slate-400 text-xs mt-1">Press Ctrl+B to bookmark a page</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    className="p-3 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors cursor-pointer group"
                    onClick={() => setCurrentPage(bookmark.page_number)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-medium text-emerald-700">Page {bookmark.page_number}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBookmark(bookmark.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                      >
                        <Trash2 size={14} className="text-red-600" />
                      </button>
                    </div>
                    {bookmark.note && <p className="text-sm text-slate-600">{bookmark.note}</p>}
                    <p className="text-xs text-slate-400 mt-2">
                      {new Date(bookmark.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Chat Sidebar - Enhanced */}
      {showChat && selectedBook && (
        <div className="w-[500px] bg-white border-l border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <MessageSquare size={20} className="text-blue-600" />
                AI Assistant
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowChatSettings(!showChatSettings)}
                  className={`p-2 rounded-lg transition-colors ${showChatSettings ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
                  title="Chat Settings"
                >
                  <Settings size={20} />
                </button>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Chat Settings Panel */}
            {showChatSettings && (
              <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-3">
                {/* Prompt Selector */}
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-2 block">Custom Prompt</label>
                  <select
                    value={selectedPromptId || ''}
                    onChange={(e) => setSelectedPromptId(e.target.value || null)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">No custom prompt</option>
                    {availablePrompts.map(prompt => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name} ({prompt.category})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Corpus Selection */}
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-2 block">Corpus Documents ({selectedCorpus.length} selected)</label>
                  <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {corpusDocuments.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-2">No corpus documents available</p>
                    ) : (
                      corpusDocuments.map((doc) => (
                        <label key={doc.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-100 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCorpus.includes(doc.id)}
                            onChange={() => toggleCorpusDocument(doc.id)}
                            className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                          />
                          <span className="text-xs text-slate-700">{doc.display_name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* ✅ NEW: Multi-Hop Reasoning Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-slate-700">Multi-Hop Reasoning</label>
                    <p className="text-[10px] text-slate-500 mt-0.5">For complex analysis questions</p>
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

                {/* Spelling Correction Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Spelling Correction</label>
                  <button
                    onClick={() => setCorrectSpelling(!correctSpelling)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      correctSpelling 
                        ? 'bg-orange-600 text-white' 
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {correctSpelling ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            )}

            {/* Session Management */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSessionList(!showSessionList)}
                  className="flex-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Clock size={16} />
                  {bookSessions.length > 0 ? `${bookSessions.length} Sessions` : 'No Sessions'}
                </button>
                <button
                  onClick={startNewSession}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                >
                  New Chat
                </button>
              </div>

              {currentSessionId && (
                <div className="px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-600">
                  {bookSessions.find(s => s.id === currentSessionId)?.name || 'Current Session'}
                </div>
              )}
            </div>

            {/* Session List */}
            {showSessionList && bookSessions.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                {bookSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-3 border-b last:border-b-0 group ${
                      currentSessionId === session.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div 
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          loadSessionMessages(session.id);
                          setShowSessionList(false);
                        }}
                      >
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {session.name?.replace('Chat: ', '') || `Session ${new Date(session.created_at).toLocaleDateString()}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(session.updated_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newName = prompt('Enter new name:', session.name?.replace('Chat: ', ''));
                            if (newName && newName.trim()) {
                              renameSession(session.id, newName.trim());
                            }
                          }}
                          className="p-1 hover:bg-blue-100 rounded transition-colors"
                          title="Rename session"
                        >
                          <Pencil size={14} className="text-blue-600" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(session.id);
                          }}
                          className="p-1 hover:bg-red-100 rounded transition-colors"
                        >
                          <Trash2 size={14} className="text-red-600" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="text-center py-12">
                <Sparkles size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">Ask me anything about this book</p>
                <p className="text-slate-400 text-xs mt-1">
                  {selectedCorpus.length > 0 
                    ? `Using ${selectedCorpus.length} corpus document${selectedCorpus.length !== 1 ? 's' : ''}`
                    : 'Configure settings above to enhance responses'}
                </p>
                 {/* ✅ NEW: Multi-hop indicator */}
                {enableMultiHop && selectedCorpus.length > 0 && (
                  <p className="text-blue-600 text-xs mt-2 font-medium">
                    🧠 Multi-hop reasoning enabled
                  </p>
                )}
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={`${currentSessionId}-msg-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white p-3' 
                      : 'bg-slate-50 border border-slate-200'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div 
                        className="prose prose-sm max-w-none p-3"
                        dir={msg.content.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2 mt-3 text-slate-900" {...props} />,
                            h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2 mt-2 text-slate-900" {...props} />,
                            h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1 mt-2 text-slate-800" {...props} />,
                            strong: ({ node, ...props }) => <strong className="font-bold text-blue-700" {...props} />,
                            ul: ({ node, ...props }) => <ul className="list-disc mr-5 ml-5 my-2 space-y-1" {...props} />,
                            ol: ({ node, ...props }) => <ol className="list-decimal mr-5 ml-5 my-2 space-y-1" {...props} />,
                            li: ({ node, ...props }) => <li className="leading-relaxed text-slate-700 text-sm" {...props} />,
                            blockquote: ({ node, ...props }) => (
                              <blockquote className="border-l-4 border-r-4 border-blue-300 pl-3 pr-3 italic my-2 text-slate-600 bg-blue-50 py-2 rounded-r text-sm" {...props} />
                            ),
                            code: (props: any) => {
                              const { inline, ...rest } = props || {};
                              return inline ? (
                                <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono" {...rest} />
                              ) : (
                                <code className="block bg-slate-100 text-slate-800 p-2 rounded my-2 text-xs font-mono overflow-x-auto" {...rest} />
                              );
                            },
                            a: ({ node, ...props }) => <a className="text-blue-600 hover:text-blue-800 underline" {...props} />,
                            p: ({ node, ...props }) => <p className="mb-2 leading-relaxed text-slate-700 text-sm" {...props} />,
                            em: ({ node, ...props }) => <em className="italic text-slate-600" {...props} />,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 p-3 rounded-lg">
                  <Loader2 className="animate-spin text-slate-600" size={20} />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-slate-200">
            <div className="flex gap-2 items-end">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                placeholder="Ask a question... (Shift+Enter for new line)"
                rows={1}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
                style={{ height: 'auto', minHeight: '40px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                }}
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text Extraction Popup */}
      {showTextPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-lg">Extracted Text - Page {currentPage}</h3>
              <div className="flex gap-2">
                <button
                  onClick={copyToClipboard}
                  disabled={extracting || !extractedText}
                  className="p-2 hover:bg-slate-100 rounded disabled:opacity-50 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={20} className="text-green-600" /> : <Copy size={20} />}
                </button>
                <button
                  onClick={() => {
                    if (extractedText && extractedText.trim()) {
                      setChatInput(prev => prev ? `${prev}\n\n${extractedText}` : extractedText);
                      setShowTextPopup(false);
                      setShowChat(true);
                    }
                  }}
                  disabled={extracting || !extractedText}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  title="Add to chat"
                >
                  <MessageSquare size={18} />
                  <span className="text-sm">Add to Chat</span>
                </button>
                <button 
                  onClick={() => setShowTextPopup(false)} 
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <textarea
                value={extractedText}
                onChange={(e) => setExtractedText(e.target.value)}
                disabled={extracting}
                className="w-full h-full min-h-[400px] p-3 font-sans text-sm leading-relaxed border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                placeholder="Extracted text will appear here..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}