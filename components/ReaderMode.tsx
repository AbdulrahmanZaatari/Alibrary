'use client';

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
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
  Send
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

export default function ReaderMode() {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  
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

  // Corpus Selector
  const [showCorpus, setShowCorpus] = useState(false);
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [selectedCorpus, setSelectedCorpus] = useState<string[]>([]);

  useEffect(() => {
    fetchBooks();
    fetchCorpusDocuments();
  }, []);

  useEffect(() => {
    if (selectedBook) {
      setCurrentPage(selectedBook.current_page);
      loadBookPdf(selectedBook);
      loadBookmarks();
    }
  }, [selectedBook]);

  useEffect(() => {
    if (selectedBook && currentPage !== selectedBook.current_page && currentPage > 0) {
      const timeoutId = setTimeout(() => {
        updateReadingPosition(selectedBook.id, currentPage);
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [currentPage, selectedBook]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!selectedBook) return;
      
      if (e.key === 'ArrowLeft') goToPrevPage();
      if (e.key === 'ArrowRight') goToNextPage();
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        addBookmark();
      }
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        extractPageText();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentPage, selectedBook, scale]);

  // ==================== API FUNCTIONS ====================

  async function fetchBooks() {
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      setBooks(data.books || []);
    } catch (error) {
      console.error('Error fetching books:', error);
    }
  }

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
    
    // ✅ Add safety check
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

  async function loadBookPdf(book: Book) {
    try {
      setLoading(true);
      const res = await fetch(`/api/books/download?id=${book.id}`);
      const data = await res.json();
      setPdfUrl(data.url);
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF');
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
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage,
          selectedDocuments: selectedCorpus,
          context: `Current book: ${selectedBook.title}, Page: ${currentPage}`,
        }),
      });

      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer || 'No response' }]);
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: '❌ Error getting response' }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function loadBookmarks() {
    if (!selectedBook) return;

    try {
      const res = await fetch(`/api/bookmarks?bookId=${selectedBook.id}`);
      const data = await res.json();
      setBookmarks(data);
    } catch (error) {
      console.error('Error loading bookmarks:', error);
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
    setScale((prev) => Math.min(prev + 0.2, 2.0));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ==================== RENDER ====================

  return (
    <div className="h-full flex bg-slate-50">
      {/* Book Library Sidebar */}
      <div className="w-80 flex flex-col bg-white border-r border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BookOpen className="text-emerald-600" />
            My Library
          </h2>

          {/* Upload Button */}
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

          {/* Book Dropdown Selector */}
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

        {/* Book List */}
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
      </div>

      {/* PDF Viewer Section */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
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
                <button
                  onClick={() => setShowCorpus(!showCorpus)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <Database size={18} />
                  Corpus ({selectedCorpus.length})
                </button>
              </>
            )}
          </div>
        </div>

        {/* PDF Controls */}
        {selectedBook && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
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
              <button onClick={zoomOut} className="p-2 rounded-lg hover:bg-white transition-colors">
                <ZoomOut size={20} />
              </button>
              <span className="text-sm font-medium text-slate-700 w-16 text-center">
                {Math.round(scale * 100)}%
              </span>
              <button onClick={zoomIn} className="p-2 rounded-lg hover:bg-white transition-colors">
                <ZoomIn size={20} />
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
                onClick={() => setShowBookmarks(!showBookmarks)}
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

        {/* PDF Viewer */}
        <div className="flex-1 overflow-auto bg-slate-100 p-8">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-emerald-600" size={48} />
            </div>
          ) : pdfUrl ? (
            <div className="max-w-5xl mx-auto">
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
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
                  className="mx-auto"
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
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

        {/* Keyboard Shortcuts Help */}
        {selectedBook && (
          <div className="px-4 py-2 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-600 text-center">
              <span className="font-medium">Shortcuts:</span> ← → (Navigate) | +/- (Zoom) | Ctrl+B
              (Bookmark) | Ctrl+E (Extract Text)
            </p>
          </div>
        )}
      </div>

      {/* Bookmarks Sidebar */}
      {showBookmarks && selectedBook && (
        <div className="w-80 bg-white border-l border-slate-200 flex flex-col">
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

      {/* AI Chat Sidebar */}
      {showChat && selectedBook && (
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <MessageSquare size={20} className="text-blue-600" />
              AI Assistant
            </h3>
            <button
              onClick={() => setShowChat(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="text-center py-12">
                <Sparkles size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">Ask me anything about this book</p>
                <p className="text-slate-400 text-xs mt-1">Using {selectedCorpus.length} corpus documents</p>
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-100 text-slate-800'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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

          <div className="p-4 border-t border-slate-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Ask a question..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Corpus Selector Sidebar */}
      {showCorpus && selectedBook && (
        <div className="w-80 bg-white border-l border-slate-200 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Database size={20} className="text-purple-600" />
              Corpus Selection
            </h3>
            <button
              onClick={() => setShowCorpus(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-sm text-slate-600 mb-4">
              Select corpus documents for AI queries ({selectedCorpus.length} selected)
            </p>
            {corpusDocuments.length === 0 ? (
              <div className="text-center py-12">
                <Database size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">No corpus documents</p>
                <p className="text-slate-400 text-xs mt-1">Upload documents in Chat view</p>
              </div>
            ) : (
              <div className="space-y-2">
                {corpusDocuments.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCorpus.includes(doc.id)}
                      onChange={() => toggleCorpusDocument(doc.id)}
                      className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{doc.display_name}</span>
                  </label>
                ))}
              </div>
            )}
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
                  className="p-2 hover:bg-slate-100 rounded disabled:opacity-50"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={20} className="text-green-600" /> : <Copy size={20} />}
                </button>
                <button onClick={() => setShowTextPopup(false)} className="p-2 hover:bg-slate-100 rounded">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {extractedText}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}