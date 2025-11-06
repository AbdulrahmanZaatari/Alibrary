'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React from 'react';
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
  Send,
  Clock,
  Pencil,
  Menu,
  Settings,
  RotateCw,
  RotateCcw
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
  // Book & PDF State
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfCache, setPdfCache] = useState<Map<string, string>>(new Map());
  
  // Text Extraction State
  const [extractedText, setExtractedText] = useState('');
  const [showTextPopup, setShowTextPopup] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extractionCorrected, setExtractionCorrected] = useState(false);
  
  // Bookmarks State
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Comments State
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [comments, setComments] = useState<Array<{
    id: string;
    page_number: number;
    selected_text: string | null;
    comment: string;
    created_at: string;
  }>>([]);
  const [showComments, setShowComments] = useState(false);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [selectedTextForComment, setSelectedTextForComment] = useState('');
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);
  const [commentView, setCommentView] = useState<'current' | 'all'>('current');
  // Citation State
  const [showCitationMenu, setShowCitationMenu] = useState(false);
  const [citationPosition, setCitationPosition] = useState<{ 
    x: number; 
    y: number; 
    placement?: 'above' | 'below' | 'fixed-top' 
  }>({ x: 0, y: 0 });
  const [selectedTextForCitation, setSelectedTextForCitation] = useState('');
  const [generatedCitation, setGeneratedCitation] = useState('');
  const [loadingCitation, setLoadingCitation] = useState(false);
  const [showCitationDialog, setShowCitationDialog] = useState(false);
  const [isFixingSpelling, setIsFixingSpelling] = useState(false);

  // AI Chat State
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{role: string; content: string}>>([]);
  const [streamingContent, setStreamingContent] = useState<string>(''); 
  const [isStreaming, setIsStreaming] = useState(false); 
  const [chatLoading, setChatLoading] = useState(false);
  const [enableMultiHop, setEnableMultiHop] = useState(false);
  const [bookSessions, setBookSessions] = useState<Array<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // Corpus State
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [selectedCorpus, setSelectedCorpus] = useState<string[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isLoadingCorpus, setIsLoadingCorpus] = useState(false);

  // Prompts State
  const [availablePrompts, setAvailablePrompts] = useState<Array<{
    id: string;
    name: string;
    template: string;
    category: string;
  }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // UI State
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);

  // Model Selection State
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [modelError, setModelError] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);

  const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Best Quality)', tier: 'premium' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast & Smart)', tier: 'premium' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', tier: 'standard' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'standard' }
  ];

  // Refs
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const isMountingRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // ==================== EFFECTS ====================

  // Auto-scroll effect for chat messages
  useEffect(() => {
    if (messagesEndRef.current && chatContainerRef.current) {
      const container = chatContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      if (isNearBottom || isStreaming) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  }, [chatMessages, streamingContent, isStreaming]);

  // Initial load
  useEffect(() => {
    fetchBooks();
    fetchCorpusDocuments();
    fetchAvailablePrompts();
    const timer = setTimeout(() => {
      isMountingRef.current = false;
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Cleanup PDF URLs
  useEffect(() => {
    return () => {
      if (pdfUrl && !selectedBook?.id) {
        console.log('🧹 Cleaning up PDF URL');
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl, selectedBook?.id]);

  // Load selected book
  useEffect(() => {
    if (selectedBook) {
      console.log('📖 Loading book:', selectedBook.title);
      setCurrentPage(selectedBook.current_page);
      setNumPages(0);
      setRotation(0);
      
      const cachedUrl = pdfCache.get(selectedBook.id);
      if (cachedUrl) {
        console.log('⚡ Using cached PDF');
        setPdfUrl(cachedUrl);
        setLoading(false);
      } else {
        setPdfUrl(null);
        loadBookPdf(selectedBook);
      }
    } else {
      setPdfUrl(null);
      setNumPages(0);
      setCurrentPage(1);
      setRotation(0);
    }
  }, [selectedBook?.id]);

  // Load comments when page changes
  useEffect(() => {
    if (selectedBook) {
      loadComments();
    }
  }, [selectedBook?.id, currentPage]);

  // Load sessions when book changes
  useEffect(() => {
    if (selectedBook) {
      loadBookSessions(selectedBook.id);
    }
  }, [selectedBook?.id]);

  // Notify parent of book selection
  useEffect(() => {
    if (isMountingRef.current || isRestoringRef.current) {
      return;
    }
    
    if (onBookSelect) {
      console.log('📢 Notifying parent of book selection:', selectedBook?.id || null);
      onBookSelect(selectedBook?.id || null);
    }
  }, [selectedBook?.id, onBookSelect]);

  // Text selection handler
  useEffect(() => {
    if (!selectedBook) return;

    const container = document.getElementById('pdf-container');
    if (!container) return;

    const handleTextSelection = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        const range = selection?.getRangeAt(0);
        const pdfContainer = document.getElementById('pdf-container');
        
        if (!pdfContainer || !range) return;
        
        const isInPdfContainer = pdfContainer.contains(range.commonAncestorContainer);
        
        if (!isInPdfContainer) {
          setShowCitationMenu(false);
          return;
        }

        const ancestor = range.commonAncestorContainer;
        const parentElement = ancestor.nodeType === Node.TEXT_NODE 
          ? ancestor.parentElement 
          : ancestor as HTMLElement;

        const isInExcludedElement = parentElement?.closest('button, .bg-purple-600, .bg-emerald-600, [data-citation-menu]');
        
        if (isInExcludedElement) {
          setShowCitationMenu(false);
          return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = pdfContainer.getBoundingClientRect();

        if (rect) {
          setSelectedTextForCitation(selectedText);
          setSelectedTextForComment(selectedText);
          
          const menuHeight = 280;
          const menuWidth = 400;
          const padding = 16;
          
          let x = rect.left + rect.width / 2;
          let y = rect.top - 10;
          
          const minX = padding + menuWidth / 2;
          const maxX = window.innerWidth - menuWidth / 2 - padding;
          x = Math.max(minX, Math.min(x, maxX));
          
          const spaceAbove = rect.top - containerRect.top;
          const spaceBelow = containerRect.bottom - rect.bottom;
          
          if (spaceAbove < menuHeight && spaceBelow > menuHeight) {
            y = rect.bottom + 10;
            setCitationPosition({ x, y, placement: 'below' });
          } else if (spaceAbove < menuHeight && spaceBelow < menuHeight) {
            y = containerRect.top + padding;
            setCitationPosition({ x, y, placement: 'fixed-top' });
          } else {
            setCitationPosition({ x, y, placement: 'above' });
          }
          
          setShowCitationMenu(true);
        }
      } else {
        setShowCitationMenu(false);
      }
    };

    container.addEventListener('mouseup', handleTextSelection);
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const pdfContainer = document.getElementById('pdf-container');
      const citationMenu = document.querySelector('[data-citation-menu]');
      
      if (pdfContainer && !pdfContainer.contains(target) && 
          citationMenu && !citationMenu.contains(target)) {
        setShowCitationMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
        setShowCitationMenu(false);
      }
    });

    return () => {
      container.removeEventListener('mouseup', handleTextSelection);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [selectedBook]);

  // Restore persisted book
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

  // Save reading position
  useEffect(() => {
  if (!selectedBook?.id || currentPage <= 0) {
    return;
  }
  
  // ✅ Save immediately without debounce
  updateReadingPosition(selectedBook.id, currentPage);
  
  // ✅ Update local book state immediately
  setBooks(prevBooks => 
    prevBooks.map(book => 
      book.id === selectedBook.id 
        ? { ...book, current_page: currentPage }
        : book
    )
  );
  
  // ✅ Update selected book state
  setSelectedBook(prev => 
    prev ? { ...prev, current_page: currentPage } : null
  );
}, [currentPage, selectedBook?.id]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyPress(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      if (showTextPopup) {
        if (e.ctrlKey && e.key === 'e') {
          e.preventDefault();
          setShowTextPopup(false);
        }
        return;
      }

      if (isInInput || showChat) {
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
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevPage();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextPage();
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      }
      if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      }
      if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    }

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [showTextPopup, selectedBook, scale, showChat]);

  // Resize handler for chat panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 300 && newWidth <= 1200) {
        setChatPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

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

  const fixSelectedTextSpelling = async () => {
    if (!selectedTextForCitation) return;
    
    setIsFixingSpelling(true);
    try {
      const response = await fetch('/api/fix-spelling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: selectedTextForCitation, 
          useAI: true
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fix spelling');
      }

      const data = await response.json();
      
      if (data.success) {
        const hasChanges = data.changed;
        
        setSelectedTextForCitation(data.fixed);
        setSelectedTextForComment(data.fixed);
        
        await navigator.clipboard.writeText(data.fixed);
        
        const tempDiv = document.createElement('div');
        tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg';
        tempDiv.textContent = hasChanges ? '✅ Fixed & Copied!' : '✅ Copied (No changes needed)';
        document.body.appendChild(tempDiv);
        setTimeout(() => document.body.removeChild(tempDiv), 2000);
      }
    } catch (error) {
      console.error('Fix spelling error:', error);
      const tempDiv = document.createElement('div');
      tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg';
      tempDiv.textContent = '❌ Failed to fix spelling';
      document.body.appendChild(tempDiv);
      setTimeout(() => document.body.removeChild(tempDiv), 2000);
    } finally {
      setIsFixingSpelling(false);
    }
  };

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
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
      
      setPdfCache(prev => {
        const newCache = new Map(prev);
        newCache.set(book.id, url);
        return newCache;
      });
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
        const cachedUrl = pdfCache.get(bookId);
        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          setPdfCache(prev => {
            const newCache = new Map(prev);
            newCache.delete(bookId);
            return newCache;
          });
        }
        
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
    console.log(`✅ Saved reading position: Page ${page}`);
  } catch (error) {
    console.error('Error updating reading position:', error);
  }
}

async function extractPageText() {
  if (!selectedBook) return;

  setExtracting(true);
  setShowTextPopup(true);
  setExtractedText('🔄 Extracting text from page...\n\nApplying AI corrections for best accuracy.');
  setExtractionCorrected(false);

  try {
    // ✅ STEP 1: Extract raw text from page
    const extractRes = await fetch('/api/books/extract-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: selectedBook.id,
        pageNumber: currentPage,
        enableAiCorrection: false, // ✅ Get raw text first
      }),
    });

    const extractData = await extractRes.json();
    
    if (!extractData.success) {
      setExtractedText('❌ Failed to extract text from this page.');
      return;
    }

    const rawText = extractData.text;
    const isArabic = extractData.language === 'ar';

    // ✅ STEP 2: Apply AI correction using fix-spelling endpoint
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
          setExtractionCorrected(fixData.changed || false);
          console.log('✨ AI correction applied via fix-spelling endpoint');
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
    setExtractedText('❌ Error extracting text. Please try again.');
  } finally {
    setExtracting(false);
  }
}

  async function sendChatMessage(userMessage: string) {
    if (!userMessage.trim() || !selectedBook) return;

    const trimmedMessage = userMessage.trim();
    
    setChatMessages(prev => [...prev, { role: 'user', content: trimmedMessage }]);
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
        
        await sendMessageWithSession(sessionId, trimmedMessage, true);
        await loadBookSessions(selectedBook.id);
      } else {
        await sendMessageWithSession(currentSessionId, trimmedMessage, false);
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
      correctSpelling: false, 
      customPrompt: selectedPrompt || '',
      enableMultiHop: enableMultiHop,
      preferredModel: selectedModel,
    };

    console.log('🔄 Sending to:', endpoint, 'Model:', selectedModel);

    setModelError(null);
    setUsedModel(null);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      
      if (errorText.includes('All models failed') || errorText.includes('quota') || errorText.includes('not available')) {
        setModelError(errorText);
        throw new Error(`Model Error: ${errorText}`);
      }
      
      throw new Error(`API error: ${res.status} - ${errorText}`);
    }

    const modelUsedHeader = res.headers.get('X-Model-Used');
    if (modelUsedHeader) {
      setUsedModel(modelUsedHeader);
      console.log(`✅ Response generated using: ${modelUsedHeader}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No streaming reader available');
    }

    setIsStreaming(true);
    setStreamingContent('');

    const decoder = new TextDecoder();
    let fullResponse = '';
    let lastUpdate = Date.now();
    const UPDATE_INTERVAL = 50;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;

      const now = Date.now();
      if (now - lastUpdate > UPDATE_INTERVAL) {
        setStreamingContent(fullResponse);
        lastUpdate = now;
      }
    }

    setStreamingContent(fullResponse);
    
    setIsStreaming(false);
    setChatMessages(prev => [...prev, { role: 'assistant', content: fullResponse }]);
    setStreamingContent('');

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
      console.log('✅ Messages saved to database in correct order');
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

  // ==================== COMMENTS ====================

  async function loadComments() {
    if (!selectedBook) return;

    try {
      const res = await fetch(`/api/comments?bookId=${selectedBook.id}`);
      if (!res.ok) {
        console.warn(`Comments fetch failed: ${res.status}`);
        setComments([]);
        return;
      }
      const data = await res.json();
      setComments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading comments:', error);
      setComments([]);
    }
  }

  async function addComment() {
  if (!selectedBook || !commentDraft.trim()) return;

  setIsAddingComment(true);

  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: selectedBook.id,
        pageNumber: currentPage,
        selectedText: selectedTextForComment || null, // Already corrected
        comment: commentDraft,
      }),
    });
    
    setCommentDraft('');
    setShowCommentDialog(false);
    setSelectedTextForComment('');
    await loadComments();
  } catch (error) {
    console.error('Error adding comment:', error);
    alert('Failed to add comment');
  } finally {
    setIsAddingComment(false);
  }
}

  async function deleteComment(commentId: string) {
    if (!confirm('Delete this comment?')) return;

    try {
      await fetch('/api/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId }),
      });
      await loadComments();
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  }

  // ==================== CITATIONS ====================

  async function generateCitation(style: string) {
    if (!selectedBook || !selectedTextForCitation) return;

    setLoadingCitation(true);
    try {
      const res = await fetch('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          bookTitle: selectedBook.title,
          selectedText: selectedTextForCitation,
          pageNumber: currentPage,
          citationStyle: style,
        }),
      });

      const data = await res.json();
      if (data.citation) {
        setGeneratedCitation(data.citation);
        setShowCitationDialog(true);
        setShowCitationMenu(false);
      } else {
        alert('Failed to generate citation');
      }
    } catch (error) {
      console.error('Error generating citation:', error);
      alert('Failed to generate citation');
    } finally {
      setLoadingCitation(false);
    }
  }

  // ==================== NAVIGATION & MANIPULATION ====================

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

  const rotateClockwise = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const rotateCounterClockwise = () => {
    setRotation((prev) => (prev - 90 + 360) % 360);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ==================== COMPONENTS ====================

  const ChatInput = ({ 
    onSend, 
    disabled
  }: { 
    onSend: (message: string) => void; 
    disabled: boolean;
  }) => {
    const [localDraft, setLocalDraft] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalDraft(e.target.value);
      
      const target = e.target;
      requestAnimationFrame(() => {
        target.style.height = 'auto';
        target.style.height = Math.min(target.scrollHeight, 200) + 'px';
      });
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (localDraft.trim() && !disabled) {
        onSend(localDraft.trim());
        setLocalDraft('');
        
        if (textareaRef.current) {
          textareaRef.current.style.height = '40px';
        }
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    };

    return (
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={localDraft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question... (Shift+Enter for new line)"
          rows={1}
          disabled={disabled}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          style={{ height: '40px', minHeight: '40px', maxHeight: '200px', overflow: 'auto' }}
        />
        <button
          type="submit"
          disabled={!localDraft.trim() || disabled}
          className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          <Send size={20} />
        </button>
      </form>
    );
  };

  const MessageBubble = React.memo(({ msg }: { msg: { role: string; content: string } }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
              <div className="flex justify-end">
                <button
                  className="mb-1 mr-1 p-1 bg-slate-100 rounded hover:bg-slate-200 transition-colors text-xs"
                  title="Copy response"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check size={16} className="inline mr-1 text-green-600" />
                  ) : (
                    <Copy size={16} className="inline mr-1" />
                  )}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
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
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          )}
        </div>
      </div>
    );
  });

  MessageBubble.displayName = 'MessageBubble';

  const StreamingMessage = React.memo(({ content }: { content: string }) => {
    const [displayedContent, setDisplayedContent] = useState(content);

    useEffect(() => {
      setDisplayedContent(content);
    }, [content]);

    if (!displayedContent) return null;

    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-lg bg-slate-50 border border-slate-200 border-blue-400 shadow-sm">
          <div className="relative">
            <div 
              className="prose prose-sm max-w-none p-3"
              dir={displayedContent.match(/[\u0600-\u06FF]/) ? 'rtl' : 'ltr'}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2 mt-3 text-slate-900" {...props} />,
                  h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2 mt-2 text-slate-900" {...props} />,
                  h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1 mt-2 text-slate-800" {...props} />,
                  strong: ({ node, ...props }) => <strong className="font-bold text-blue-700" {...props} />,
                  p: ({ node, ...props }) => <p className="mb-2 leading-relaxed text-slate-700 text-sm" {...props} />,
                  code: (props: any) => {
                    const { inline, ...rest } = props || {};
                    return inline ? (
                      <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono" {...rest} />
                    ) : (
                      <code className="block bg-slate-100 text-slate-800 p-2 rounded my-2 text-xs font-mono overflow-x-auto" {...rest} />
                    );
                  },
                }}
              >
                {displayedContent}
              </ReactMarkdown>
            </div>
            <div className="absolute bottom-2 right-2">
              <Loader2 className="animate-spin text-blue-600" size={14} />
            </div>
          </div>
        </div>
      </div>
    );
  });

  StreamingMessage.displayName = 'StreamingMessage';

  // ==================== RENDER ====================

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">
      {/* 📚 LEFT SIDEBAR - LIBRARY */}
      <div 
        className={`bg-white border-r border-slate-200 flex flex-col transition-all duration-300 ${
          libraryCollapsed ? 'w-12' : 'w-80'
        }`}
      >
        {/* Header */}
        <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          {!libraryCollapsed && (
            <>
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <BookOpen size={20} className="text-blue-600" />
                Library
              </h2>
              <button
                onClick={() => setLibraryCollapsed(true)}
                className="p-1 hover:bg-slate-200 rounded transition-colors"
                title="Collapse library"
              >
                <ChevronLeft size={18} />
              </button>
            </>
          )}
          {libraryCollapsed && (
            <button
              onClick={() => setLibraryCollapsed(false)}
              className="p-1 hover:bg-slate-200 rounded transition-colors mx-auto"
              title="Expand library"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {!libraryCollapsed && (
          <>
            {/* Upload Button */}
            <div className="p-3 border-b border-slate-200">
              <label className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer text-sm font-medium">
                <Upload size={16} />
                {uploading ? 'Uploading...' : 'Upload PDF'}
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>

            {/* Books List */}
            <div className="flex-1 overflow-y-auto p-3">
              {isLoadingBooks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="animate-spin text-blue-600" size={24} />
                </div>
              ) : books.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <FileText className="mx-auto mb-2 text-slate-400" size={32} />
                  <p>No books uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {books.map((book) => (
                    <div
                      key={book.id}
                      className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                        selectedBook?.id === book.id
                          ? 'bg-blue-50 border-blue-300 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-blue-200 hover:shadow-sm'
                      }`}
                      onClick={() => {
                        setSelectedBook(book);
                        if (onBookSelect) {
                          onBookSelect(book.id);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm text-slate-800 truncate">
                            {book.title}
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            Page {book.current_page} of {book.page_count}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(book.last_read).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBook(book.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete book"
                        >
                          <Trash2 size={14} />
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

      {/* 📖 CENTER - PDF VIEWER */}
      <div 
        className="flex-1 flex flex-col overflow-hidden"
        style={{ 
          marginRight: showChat ? `${chatPanelWidth}px` : '0',
          transition: 'margin-right 0.3s ease'
        }}
      >
        {selectedBook ? (
          <>
            {/* Top Toolbar */}
            <div className="bg-white border-b border-slate-200 p-3 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-slate-800 text-sm truncate max-w-xs">
                  {selectedBook.title}
                </h3>
              </div>

              {/* 📄 PAGE NAVIGATION - MOVED TO TOP */}
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage <= 1}
                  className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Previous Page (←)"
                >
                  <ChevronLeft size={18} />
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={numPages || 1}
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value);
                      if (page >= 1 && page <= (numPages || 1)) {
                        setCurrentPage(page);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-500">
                    / {numPages || 0}
                  </span>
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage >= numPages}
                  className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Next Page (→)"
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Rotation Controls */}
                <button
                  onClick={rotateCounterClockwise}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="Rotate Left"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  onClick={rotateClockwise}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="Rotate Right"
                >
                  <RotateCw size={18} />
                </button>

                {/* Zoom Controls */}
                <button
                  onClick={zoomOut}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={18} />
                </button>
                <span className="text-xs text-slate-600 min-w-[3rem] text-center">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={zoomIn}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="Zoom In (+)"
                >
                  <ZoomIn size={18} />
                </button>

                {/* Extract Text */}
                <button
                  onClick={extractPageText}
                  disabled={extracting}
                  className="p-2 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                  title="Extract Text (Ctrl+E)"
                >
                  {extracting ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                </button>

                {/* Add Bookmark */}
                <button
                  onClick={addBookmark}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="Add Bookmark (Ctrl+B)"
                >
                  <BookmarkPlus size={18} />
                </button>

                {/* View Bookmarks */}
                <button
                  onClick={() => {
                    loadBookmarks();
                    setShowBookmarks(true);
                    setShowComments(false);
                  }}
                  className="p-2 hover:bg-slate-100 rounded transition-colors"
                  title="View Bookmarks"
                >
                  <Bookmark size={18} />
                </button>

                <button
                  onClick={() => {
                    setShowComments(!showComments);
                    setShowBookmarks(false);
                    if (!showComments) loadComments();
                  }}
                  className={`p-2 rounded transition-colors relative ${
                    showComments ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100'
                  }`}
                  title="Comments"
                >
                  <MessageSquare size={18} />
                  {/* ✅ ADD BADGE SHOWING COMMENT COUNT */}
                  {comments.filter(c => c.page_number === currentPage).length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium shadow-sm">
                      {comments.filter(c => c.page_number === currentPage).length}
                    </span>
                  )}
                </button>

                {/* AI Chat Toggle */}
                <button
                  onClick={() => setShowChat(!showChat)}
                  className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium text-sm ${
                    showChat
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  title="AI Assistant"
                >
                  <Sparkles size={16} />
                  AI Chat
                </button>
              </div>
            </div>

            {/* PDF Viewer Container */}
            <div className="flex-1 overflow-auto bg-slate-100 p-4 relative" id="pdf-container">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Loader2 className="animate-spin text-blue-600 mx-auto mb-2" size={32} />
                    <p className="text-slate-600">Loading PDF...</p>
                  </div>
                </div>
              ) : pdfUrl ? (
                <div className="flex justify-center">
                  <Document
                    file={pdfUrl}
                    onLoadSuccess={({ numPages }) => {
                      setNumPages(numPages);
                      console.log(`📄 PDF loaded: ${numPages} pages`);
                    }}
                    loading={
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-blue-600" size={32} />
                      </div>
                    }
                    error={
                      <div className="text-center py-8 text-red-600">
                        <p>❌ Failed to load PDF</p>
                      </div>
                    }
                  >
                    <Page
                      pageNumber={currentPage}
                      scale={scale}
                      rotate={rotation}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                    />
                  </Document>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500">
                  <p>Select a book to start reading</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <BookOpen className="mx-auto mb-4 text-slate-400" size={48} />
              <p className="text-lg">No book selected</p>
              <p className="text-sm mt-2">Choose a book from the library to start reading</p>
            </div>
          </div>
        )}
      </div>

      {/* 💬 RIGHT SIDEBAR - AI CHAT PANEL */}
      {showChat && selectedBook && (
        <>
          {/* Resize Handle */}
          <div
            className="fixed top-0 bottom-0 w-1 bg-slate-300 hover:bg-blue-500 cursor-col-resize z-50 transition-colors"
            style={{ left: `calc(100% - ${chatPanelWidth}px)` }}
            onMouseDown={() => setIsResizing(true)}
          />

          {/* Chat Panel */}
          <div
            className="fixed top-0 right-0 bottom-0 bg-white border-l border-slate-200 flex flex-col shadow-xl z-40"
            style={{ width: `${chatPanelWidth}px` }}
          >
            {/* Chat Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50">
              <div className="flex items-center gap-2">
                <Sparkles className="text-blue-600" size={20} />
                <h3 className="font-semibold text-slate-800">AI Research Assistant</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowChatSettings(!showChatSettings)}
                  className={`p-2 rounded-lg transition-colors ${
                    showChatSettings 
                      ? 'bg-blue-100 text-blue-600'  
                      : 'hover:bg-white'
                  }`}
                  title="Settings"
                >
                  <Settings size={18} />
                </button>
                <button
                  onClick={() => setShowSessionList(!showSessionList)}
                  className="p-2 hover:bg-white rounded-lg transition-colors"
                  title="Chat History"
                >
                  <Clock size={18} />
                </button>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-2 hover:bg-white rounded-lg transition-colors"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Settings Panel */}
            {showChatSettings && (
              <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-4">
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Reference Documents ({selectedCorpus.length} selected)
                  </label>
                  {isLoadingCorpus ? (
                    <div className="flex items-center justify-center py-2">
                      <Loader2 className="animate-spin text-blue-600" size={16} />
                    </div>
                  ) : (
                    <div className="max-h-32 overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2 bg-white">
                      {corpusDocuments.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-2">
                          No documents available
                        </p>
                      ) : (
                        corpusDocuments.map((doc) => (
                          <label key={doc.id} className="flex items-center gap-2 p-1 hover:bg-slate-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedCorpus.includes(doc.id)}
                              onChange={() => toggleCorpusDocument(doc.id)}
                              className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs text-slate-700">{doc.display_name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Custom Prompt */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Custom Prompt Template
                  </label>
                  <select
                    value={selectedPromptId || ''}
                    onChange={(e) => setSelectedPromptId(e.target.value || null)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">None (Default)</option>
                    {availablePrompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name} ({prompt.category})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Multi-Hop Reasoning */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableMultiHop}
                    onChange={(e) => setEnableMultiHop(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">Enable Multi-Hop Reasoning</span>
                </label>
              </div>
            )}

            {/* Session List */}
            {showSessionList && (
              <div className="p-4 border-b border-slate-200 bg-slate-50 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-slate-700">Chat History</h4>
                  <button
                    onClick={startNewSession}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    New Chat
                  </button>
                </div>
                {bookSessions.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No sessions yet</p>
                ) : (
                  <div className="space-y-2">
                    {bookSessions.map((session) => (
                      <div
                        key={session.id}
                        className={`p-2 rounded border cursor-pointer group ${
                          currentSessionId === session.id
                            ? 'bg-blue-50 border-blue-300'
                            : 'bg-white border-slate-200 hover:border-blue-200'
                        }`}
                        onClick={() => loadSessionMessages(session.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-800 truncate">
                              {session.name}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {new Date(session.updated_at).toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSession(session.id);
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"
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

            {/* Messages Container */}
            <div 
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {chatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-center">
                  <div>
                    <Sparkles className="mx-auto mb-2 text-slate-400" size={32} />
                    <p className="text-sm">Ask me anything about this book!</p>
                    <p className="text-xs mt-2 text-slate-400">
                      I can help with summaries, analysis, citations, and more.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {chatMessages.map((msg, idx) => (
                    <MessageBubble key={idx} msg={msg} />
                  ))}
                  {isStreaming && streamingContent && (
                    <StreamingMessage content={streamingContent} />
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-slate-200 bg-white">
              {chatLoading && !isStreaming && (
                <div className="mb-2 flex items-center gap-2 text-sm text-blue-600">
                  <Loader2 className="animate-spin" size={16} />
                  Processing...
                </div>
              )}
              <ChatInput 
                onSend={sendChatMessage} 
                disabled={chatLoading}
              />
            </div>
          </div>
        </>
      )}

      {/* 📝 TEXT EXTRACTION POPUP */}
      {showTextPopup && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[100] p-4">        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <FileText size={20} className="text-blue-600" />
                Extracted Text
                {extractionCorrected && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                    ✨ AI Corrected
                  </span>
                )}
              </h3>
              <button
                onClick={() => setShowTextPopup(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-200">
                {extractedText}
              </pre>
            </div>
            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy Text'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔖 BOOKMARKS SIDEBAR */}
      {showBookmarks && (
        <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-slate-200 shadow-xl z-[80] flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Bookmarks</h3>
            <button
              onClick={() => setShowBookmarks(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {bookmarks.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Bookmark className="mx-auto mb-2 text-slate-400" size={32} />
                <p className="text-sm">No bookmarks yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer group"
                    onClick={() => setCurrentPage(bookmark.page_number)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          Page {bookmark.page_number}
                        </p>
                        {bookmark.note && (
                          <p className="text-xs text-slate-600 mt-1">{bookmark.note}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          {new Date(bookmark.created_at).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBookmark(bookmark.id);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
{/* 💬 COMMENTS SIDEBAR */}
{showComments && (
  <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-xl z-[80] flex flex-col">
    <div className="p-4 border-b border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800">Comments</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCommentDialog(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            Add Comment
          </button>
          <button
            onClick={() => setShowComments(false)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      
      {/* ✅ VIEW TOGGLE */}
      <div className="flex gap-2 bg-slate-100 rounded-lg p-1">
        <button
          onClick={() => setCommentView('current')}
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            commentView === 'current'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          This Page ({comments.filter(c => c.page_number === currentPage).length})
        </button>
        <button
          onClick={() => setCommentView('all')}
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            commentView === 'all'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          All ({comments.length})
        </button>
      </div>
    </div>

    <div className="flex-1 overflow-y-auto p-4">
      {/* ✅ CURRENT PAGE VIEW */}
      {commentView === 'current' && (
        <>
          {comments.filter(c => c.page_number === currentPage).length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <MessageSquare className="mx-auto mb-2 text-slate-400" size={32} />
              <p className="text-sm">No comments on this page</p>
            </div>
          ) : (
            <div className="space-y-3">
              {comments
                .filter((c) => c.page_number === currentPage)
                .map((comment) => (
                  <div
                    key={comment.id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200"
                  >
                    {comment.selected_text && (
                      <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs italic text-slate-700">
                        {expandedCommentId === comment.id ? (
                          <>
                            <p className="whitespace-pre-wrap">&quot;{comment.selected_text}&quot;</p>
                            <button
                              onClick={() => setExpandedCommentId(null)}
                              className="text-blue-600 hover:underline mt-1 text-xs"
                            >
                              Show less
                            </button>
                          </>
                        ) : (
                          <>
                            <p>&quot;{comment.selected_text.substring(0, 100)}
                            {comment.selected_text.length > 100 ? '...' : ''}&quot;</p>
                            {comment.selected_text.length > 100 && (
                              <button
                                onClick={() => setExpandedCommentId(comment.id)}
                                className="text-blue-600 hover:underline mt-1 text-xs"
                              >
                                Read more
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">
                      {comment.comment}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-slate-400">
                        {new Date(comment.created_at).toLocaleString()}
                      </p>
                      <button
                        onClick={() => deleteComment(comment.id)}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
      {/* ✅ ALL COMMENTS VIEW */}
      {commentView === 'all' && (
        <>
          {comments.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <MessageSquare className="mx-auto mb-2 text-slate-400" size={32} />
              <p className="text-sm">No comments yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {comments
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((comment) => (
                  <div
                    key={comment.id}
                    onClick={() => {
                      setCurrentPage(comment.page_number);
                      setCommentView('current');
                    }}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer group"
                  >
                    {/* Page Number Badge */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded group-hover:bg-blue-200">
                        Page {comment.page_number}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteComment(comment.id);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Selected Text Preview */}
                    {comment.selected_text && (
                      <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs italic text-slate-700">
                        &quot;{comment.selected_text.substring(0, 80)}
                        {comment.selected_text.length > 80 ? '...' : ''}&quot;
                      </div>
                    )}

                    {/* Comment Text */}
                    <p className="text-sm text-slate-800">
                      {comment.comment.length > 150
                        ? `${comment.comment.substring(0, 150)}...`
                        : comment.comment}
                    </p>

                    {/* Timestamp */}
                    <p className="text-xs text-slate-400 mt-2">
                      {new Date(comment.created_at).toLocaleString()}
                    </p>

                    {/* Click to Navigate Hint */}
                    <div className="mt-2 pt-2 border-t border-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-xs text-blue-600 flex items-center gap-1">
                        <span>→</span> Click to go to page {comment.page_number}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  </div>
)}

{/* 📝 ADD COMMENT DIALOG */}
{showCommentDialog && (
  <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
    <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
      <div className="p-4 border-b border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800">Add Comment</h3>
      </div>
      <div className="p-4 space-y-3">
        {selectedTextForComment && (
          <div className="p-2 bg-blue-50 border border-blue-200 rounded">
            <p className="text-xs font-medium text-slate-600 mb-1">Selected Text:</p>
            <div className="text-xs italic text-slate-700">
              {expandedCommentId === 'draft' ? (
                <>
                  <p className="whitespace-pre-wrap">&quot;{selectedTextForComment}&quot;</p>
                  <button
                    onClick={() => setExpandedCommentId(null)}
                    className="text-blue-600 hover:underline mt-1 text-xs"
                  >
                    Show less
                  </button>
                </>
              ) : (
                <>
                  <p>&quot;{selectedTextForComment.substring(0, 100)}
                  {selectedTextForComment.length > 100 ? '...' : ''}&quot;</p>
                  {selectedTextForComment.length > 100 && (
                    <button
                      onClick={() => setExpandedCommentId('draft')}
                      className="text-blue-600 hover:underline mt-1 text-xs"
                    >
                      Read more
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <textarea
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          placeholder="Enter your comment..."
          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={4}
        />
      </div>
      <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2">
        <button
          onClick={() => {
            setShowCommentDialog(false);
            setCommentDraft('');
            setSelectedTextForComment('');
          }}
          className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={addComment}
          disabled={!commentDraft.trim() || isAddingComment}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isAddingComment ? (
            <>
              <Loader2 className="animate-spin" size={16} />
              Processing...
            </>
          ) : (
            'Add Comment'
          )}
        </button>
      </div>
    </div>
  </div>
)}

{/* 📌 CITATION MENU (On Text Selection) */}
{showCitationMenu && (
  <div
    data-citation-menu
    className={`fixed bg-white rounded-lg shadow-xl border border-slate-200 p-3 z-[9999] ${
      citationPosition.placement === 'fixed-top' ? 'top-4' : ''
    }`}
    style={{
      left: citationPosition.placement === 'fixed-top' 
        ? '50%' 
        : `${citationPosition.x}px`,
      top: citationPosition.placement === 'fixed-top' 
        ? undefined 
        : `${citationPosition.y}px`,
      transform: citationPosition.placement === 'fixed-top'
        ? 'translateX(-50%)'
        : 'translate(-50%, -100%)',
      width: '400px',
      maxWidth: '90vw',
    }}
  >
    <div className="space-y-2">
      <div className="text-xs text-slate-600 mb-2 p-2 bg-slate-50 rounded border border-slate-200 max-h-20 overflow-y-auto">
        &quot;{selectedTextForCitation.substring(0, 150)}
        {selectedTextForCitation.length > 150 ? '...' : ''}&quot;
      </div>
      {/* Direct Copy Button */}
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(selectedTextForCitation);
            const tempDiv = document.createElement('div');
            tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[150] bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg';
            tempDiv.textContent = '✅ Text Copied!';
            document.body.appendChild(tempDiv);
            setTimeout(() => document.body.removeChild(tempDiv), 2000);
          } catch (error) {
            console.error('Copy failed:', error);
          }
        }}
        className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <Copy size={16} />
        Copy Text
      </button>
      {/* Fix Spelling Button */}
      <button
        onClick={fixSelectedTextSpelling}
        disabled={isFixingSpelling}
        className="w-full px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {isFixingSpelling ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            Fixing...
          </>
        ) : (
          <>
            <Sparkles size={16} />
            Fix & Copy
          </>
        )}
      </button>

      {/* Citation Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => generateCitation('APA')}
          disabled={loadingCitation}
          className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm"
        >
          {loadingCitation ? <Loader2 className="animate-spin inline" size={14} /> : 'APA Citation'}
        </button>
        <button
          onClick={() => generateCitation('MLA')}
          disabled={loadingCitation}
          className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm"
        >
          {loadingCitation ? <Loader2 className="animate-spin inline" size={14} /> : 'MLA Citation'}
        </button>
        <button
          onClick={() => generateCitation('Chicago')}
          disabled={loadingCitation}
          className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm"
        >
          {loadingCitation ? <Loader2 className="animate-spin inline" size={14} /> : 'Chicago'}
        </button>
        <button
          onClick={() => generateCitation('Harvard')}
          disabled={loadingCitation}
          className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm"
        >
          {loadingCitation ? <Loader2 className="animate-spin inline" size={14} /> : 'Harvard'}
        </button>
      </div>

      {/* Add Comment Button */}
      <button
        onClick={async () => {
          let textToUse = selectedTextForCitation;
          
          // ✅ FIX: Correct Arabic text BEFORE opening dialog
          if (textToUse && textToUse.length > 20) {
            const isArabic = /[\u0600-\u06FF]/.test(textToUse);
            
            if (isArabic) {
              setIsFixingSpelling(true);
              try {
                const fixRes = await fetch('/api/fix-spelling', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    text: textToUse, 
                    useAI: true,
                    language: 'ar'
                  }),
                });

                if (fixRes.ok) {
                  const fixData = await fixRes.json();
                  if (fixData.success && fixData.fixed) {
                    textToUse = fixData.fixed;
                    console.log('✅ Arabic text corrected before comment dialog');
                  }
                }
              } catch (error) {
                console.warn('Failed to correct text, using original:', error);
              } finally {
                setIsFixingSpelling(false);
              }
            }
          }
          
          setSelectedTextForComment(textToUse);
          setShowCommentDialog(true);
          setShowCitationMenu(false);
        }}
        disabled={isFixingSpelling}
        className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {isFixingSpelling ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            Correcting...
          </>
        ) : (
          <>
            <MessageSquare size={16} />
            Add Comment
          </>
        )}
      </button>
    </div>
  </div>
)}
{/* 📄 CITATION RESULT DIALOG */}
{showCitationDialog && (
  <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[100] p-4">          
    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">Generated Citation</h3>
        <button
          onClick={() => setShowCitationDialog(false)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-4">
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-sm text-slate-700">
          {generatedCitation}
        </div>
      </div>
      <div className="p-4 border-t border-slate-200 flex items-center justify-end">
        <button
          onClick={() => {
            navigator.clipboard.writeText(generatedCitation);
            alert('Citation copied to clipboard!');
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Copy size={16} />
          Copy Citation
        </button>
      </div>
    </div>
  </div>
)}
  </div>
  );
}