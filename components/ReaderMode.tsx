'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { hasTransliterationIssues } from '@/lib/transliterationMapper';
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
  Database,
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
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enableMultiHop, setEnableMultiHop] = useState(false);
  
  // Text extraction
  const [extractedText, setExtractedText] = useState('');
  const [showTextPopup, setShowTextPopup] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);
  const [isFixingSpelling, setIsFixingSpelling] = useState(false);
  const [extractionCorrected, setExtractionCorrected] = useState(false);
  
  // Bookmarks
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pdfCache, setPdfCache] = useState<Map<string, string>>(new Map());

    // Comments
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

  // Citation
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

  // AI Chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{role: string; content: string}>>([]);
  const [streamingContent, setStreamingContent] = useState<string>(''); 
  const [isStreaming, setIsStreaming] = useState(false); 
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
  const [chatPanelWidth, setChatPanelWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [modelError, setModelError] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);

  const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Best Quality)', tier: 'premium' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast & Smart)', tier: 'premium' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', tier: 'standard' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'standard' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite (Fastest)', tier: 'basic' },
  ];

  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const isMountingRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);


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
      if (pdfUrl && !selectedBook?.id) {
        console.log('🧹 Cleaning up PDF URL');
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl, selectedBook?.id]);

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

  useEffect(() => {
  if (selectedBook) {
    loadComments();
  }
}, [selectedBook?.id, currentPage]);

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
      
      // ✅ Check if selection is inside PDF container
      const isInPdfContainer = pdfContainer.contains(range.commonAncestorContainer);
      
      if (!isInPdfContainer) {
        setShowCitationMenu(false);
        return;
      }

      // ✅ Exclude selections within UI elements
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
        
        // ✅ SMART POSITIONING WITH BOUNDARY DETECTION
        const menuHeight = 280; // Approximate menu height (adjust if needed)
        const menuWidth = 400;
        const padding = 16; // Safety padding from edges
        
        let x = rect.left + rect.width / 2;
        let y = rect.top - 10;
        
        // ✅ Horizontal boundary check (keep menu within viewport)
        const minX = padding + menuWidth / 2;
        const maxX = window.innerWidth - menuWidth / 2 - padding;
        x = Math.max(minX, Math.min(x, maxX));
        
        // ✅ Vertical boundary check (flip menu below text if too close to top)
        const spaceAbove = rect.top - containerRect.top;
        const spaceBelow = containerRect.bottom - rect.bottom;
        
        if (spaceAbove < menuHeight && spaceBelow > menuHeight) {
          // Not enough space above, show below
          y = rect.bottom + 10;
          setCitationPosition({ x, y, placement: 'below' });
        } else if (spaceAbove < menuHeight && spaceBelow < menuHeight) {
          // Not enough space either way, show at top of container
          y = containerRect.top + padding;
          setCitationPosition({ x, y, placement: 'fixed-top' });
        } else {
          // Enough space above (default)
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
  
  // ✅ Add more triggers
  const resizeObserver = new ResizeObserver(updateWidth);
  const container = document.getElementById('pdf-container');
  if (container) {
    resizeObserver.observe(container);
  }

  window.addEventListener('resize', updateWidth);
  
  return () => {
    window.removeEventListener('resize', updateWidth);
    resizeObserver.disconnect();
  };
}, [showChat, showBookmarks, showComments, libraryCollapsed, chatPanelWidth]);

  // Updated keyboard shortcuts - only active when not in input fields
  useEffect(() => {
    function handleKeyPress(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Text popup shortcuts (works even in textarea)
      if (showTextPopup) {
        if (e.ctrlKey && e.key === 'e') {
          e.preventDefault();
          setShowTextPopup(false);
        }
        return;
      }

      // Don't trigger shortcuts when typing in input fields or chat
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
      if (newWidth >= 300 && newWidth <= 2400) { 
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
    // ✅ Call server endpoint instead of client-side function
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
      
      if (hasChanges) {
        await navigator.clipboard.writeText(data.fixed);
        console.log('📝 Original:', selectedTextForCitation.substring(0, 100));
        console.log('✨ Fixed:', data.fixed.substring(0, 100));
      }
      
      const tempDiv = document.createElement('div');
      tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg';
      tempDiv.innerHTML = hasChanges 
        ? '✅ Fixed & copied to clipboard!' 
        : '✓ Text is already clean';
      document.body.appendChild(tempDiv);
      setTimeout(() => document.body.removeChild(tempDiv), 3000);
    }
  } catch (error) {
    console.error('Error:', error);
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
      
      // Scroll to bottom after loading messages
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
    const res = await fetch('/api/books/extract-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: selectedBook.id,
        pageNumber: currentPage,
        enableAiCorrection: true, // ✅ Enable AI validation
      }),
    });

    const data = await res.json();
    if (data.success) {
      setExtractedText(data.text);
      setExtractionCorrected(data.corrected || false);
      
      if (data.corrected) {
        console.log('✨ Corrections applied (Regex + AI)');
      }
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
      correctSpelling: correctSpelling,
      aggressiveCorrection: false,
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

    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedBook.id,
          pageNumber: currentPage,
          selectedText: selectedTextForComment || null,
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

  function handleTextSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length > 0) {
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();

      if (rect) {
        setSelectedTextForCitation(selectedText);
        setSelectedTextForComment(selectedText);
        setCitationPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        });
        setShowCitationMenu(true);
      }
    } else {
      setShowCitationMenu(false);
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

  // ✅ OPTIMIZED ChatInput WITH CUSTOM COMPARISON
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
      <div className="flex-1 flex flex-col bg-white" style={{
          width: showChat 
            ? `calc(100% - ${libraryCollapsed ? '56px' : '320px'} - ${chatPanelWidth}px - 4px)` 
            : showBookmarks || showComments
              ? `calc(100% - ${libraryCollapsed ? '56px' : '320px'} - 384px)`
              : `calc(100% - ${libraryCollapsed ? '56px' : '320px'})`,
          transition: 'width 0.3s ease'
        }}>
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
                  onClick={() => {
                    setShowComments(!showComments);
                    if (!showComments) loadComments();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors relative"
                >
                  <MessageSquare size={18} />
                  Comments
                  {comments.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                      {comments.length}
                    </span>
                  )}
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
                onClick={rotateCounterClockwise}
                className="p-2 rounded-lg hover:bg-white transition-colors"
                title="Rotate Left"
              >
                <RotateCcw size={18} />
              </button>
              <button
                onClick={rotateClockwise}
                className="p-2 rounded-lg hover:bg-white transition-colors"
                title="Rotate Right"
              >
                <RotateCw size={18} />
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
          className="flex-1 overflow-auto bg-slate-100 relative"
          style={{ 
            display: 'flex', 
            justifyContent: 'center',
            padding: '2rem'
          }}
        >
          {selectedBook && comments.filter(c => c.page_number === currentPage).length > 0 && (
          <div className="absolute top-4 right-4 z-10 bg-purple-600 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 select-none pointer-events-none">
            <MessageSquare size={16} />
            <span className="text-sm font-medium">
              {comments.filter(c => c.page_number === currentPage).length} comment(s) on this page
            </span>
          </div>
        )}

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
                  rotate={rotation}
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

            {/* Comments Sidebar */}
      {showComments && selectedBook && (
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <MessageSquare size={20} className="text-purple-600" />
              Comments
            </h3>
            <button
              onClick={() => setShowComments(false)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {comments.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">No comments yet</p>
                <p className="text-slate-400 text-xs mt-1">Select text and click Comment</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Current Page Comments */}
                {comments
                  .filter(c => c.page_number === currentPage)
                  .map((comment) => {
                    const isExpanded = expandedCommentId === comment.id;
                    const needsExpansion = comment.selected_text && comment.selected_text.length > 150;
                    
                    return (
                      <div
                        key={comment.id}
                        className="p-3 border border-purple-200 rounded-lg bg-purple-50/50 hover:bg-purple-50 transition-colors group"
                      >
                        {comment.selected_text && (
                          <div className="text-xs text-slate-600 italic mb-2 bg-white p-2 rounded">
                            <div className={needsExpansion && !isExpanded ? 'line-clamp-3' : ''}>
                              &quot;{comment.selected_text}&quot;
                            </div>
                            {needsExpansion && (
                              <button
                                onClick={() => setExpandedCommentId(isExpanded ? null : comment.id)}
                                className="text-purple-600 hover:text-purple-700 mt-1 text-xs font-medium"
                              >
                                {isExpanded ? 'Show Less' : 'Read More'}
                              </button>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-slate-800">{comment.comment}</p>
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-xs text-slate-400">
                            {new Date(comment.created_at).toLocaleString()}
                          </p>
                          <button
                            onClick={() => deleteComment(comment.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                          >
                            <Trash2 size={14} className="text-red-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                
                {/* Other Pages Comments */}
                {comments.filter(c => c.page_number !== currentPage).length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium text-slate-500 mb-2">Other Pages</p>
                    {comments
                      .filter(c => c.page_number !== currentPage)
                      .map((comment) => {
                        const isExpanded = expandedCommentId === comment.id;
                        const needsExpansion = comment.selected_text && comment.selected_text.length > 150;
                        
                        return (
                          <div
                            key={comment.id}
                            className="p-3 border border-slate-200 rounded-lg mb-2 cursor-pointer hover:border-purple-300 transition-colors group"
                            onClick={() => setCurrentPage(comment.page_number)}
                          >
                            <div className="flex items-start justify-between mb-1">
                              <span className="text-xs font-medium text-purple-600">
                                Page {comment.page_number}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteComment(comment.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                              >
                                <Trash2 size={12} className="text-red-600" />
                              </button>
                            </div>
                            {comment.selected_text && (
                              <div className="text-xs text-slate-600 italic mb-1 bg-slate-50 p-2 rounded">
                                <div className={needsExpansion && !isExpanded ? 'line-clamp-2' : ''}>
                                  &quot;{comment.selected_text}&quot;
                                </div>
                                {needsExpansion && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedCommentId(isExpanded ? null : comment.id);
                                    }}
                                    className="text-purple-600 hover:text-purple-700 mt-1 text-xs font-medium"
                                  >
                                    {isExpanded ? 'Show Less' : 'Read More'}
                                  </button>
                                )}
                              </div>
                            )}
                            <p className="text-xs text-slate-700 line-clamp-2">{comment.comment}</p>
                            <p className="text-xs text-slate-400 mt-1">
                              {new Date(comment.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Chat Sidebar - Resizable */}
      {showChat && selectedBook && (
        <>
          <div
            className="w-1 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors relative group"
            onMouseDown={() => setIsResizing(true)}
            style={{ userSelect: 'none', zIndex: 40 }}
            title="Drag to resize chat panel"
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-1 h-16 bg-blue-600 rounded-full shadow-lg"></div>
            </div>

          {/* Drag hint */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
              ↔️ Drag to resize
            </div>
          </div>
        </div>

          <div 
            className="bg-white border-l border-slate-200 flex flex-col"
            style={{ 
              width: `${chatPanelWidth}px`, 
              minWidth: '300px', 
              maxWidth: '2400px',
              flexShrink: 0 
            }}
          >
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

              {showChatSettings && (
                <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-3">
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

            <div 
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {chatMessages.length === 0 && !isStreaming ? (
                <div className="text-center py-12">
                  <Sparkles size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 text-sm">Ask me anything about this book</p>
                  <p className="text-slate-400 text-xs mt-1">
                    {selectedCorpus.length > 0 
                      ? `Using ${selectedCorpus.length} corpus document${selectedCorpus.length !== 1 ? 's' : ''}`
                      : 'Configure settings above to enhance responses'}
                  </p>
                  {enableMultiHop && selectedCorpus.length > 0 && (
                    <p className="text-blue-600 text-xs mt-2 font-medium">
                      🧠 Multi-hop reasoning enabled
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {chatMessages.map((msg, idx) => (
                    <MessageBubble 
                      key={`${currentSessionId}-msg-${idx}`} 
                      msg={msg} 
                    />
                  ))}
                  {isStreaming && <StreamingMessage content={streamingContent} />}
                  <div ref={messagesEndRef} />
                </>
              )}
              {chatLoading && !isStreaming && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 p-3 rounded-lg">
                    <Loader2 className="animate-spin text-slate-600" size={20} />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-700">AI Model:</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => {
                      setSelectedModel(e.target.value);
                      setModelError(null);
                    }}
                    className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {AVAILABLE_MODELS.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                {usedModel && usedModel !== selectedModel && (
                  <div className="text-[10px] text-amber-600 flex items-center gap-1">
                    <span>⚠️ Fallback: {usedModel}</span>
                  </div>
                )}
              </div>

              {modelError && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-700 font-medium mb-1">⚠️ Model Error</p>
                  <p className="text-[10px] text-red-600">{modelError}</p>
                  <p className="text-[10px] text-red-500 mt-1">
                    Try selecting a different model or wait a few minutes.
                  </p>
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

      {/* Text Extraction Popup */}
            {showTextPopup && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
                <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-lg">Extracted Text - Page {currentPage}</h3>
                    {extractionCorrected && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded flex items-center gap-1">
                        <Sparkles size={12} />
                        Auto-Corrected
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const beforeFix = extractedText;
                        setExtracting(true);
                        
                        try {
                          // ✅ Use server endpoint
                          const response = await fetch('/api/fix-spelling', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                              text: extractedText, 
                              useAI: true 
                            }),
                          });

                          if (!response.ok) {
                            throw new Error('Failed to fix spelling');
                          }

                          const data = await response.json();
                          
                          if (data.success) {
                            const hasChanges = data.changed;
                            
                            setExtractedText(data.fixed);
                            setExtractionCorrected(true);
                            
                            if (hasChanges) {
                              console.log('📝 Corrections applied');
                              
                              const tempDiv = document.createElement('div');
                              tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg';
                              tempDiv.textContent = '✅ AI corrections applied!';
                              document.body.appendChild(tempDiv);
                              setTimeout(() => document.body.removeChild(tempDiv), 2000);
                            } else {
                              const tempDiv = document.createElement('div');
                              tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg';
                              tempDiv.textContent = '✓ Text is already clean';
                              document.body.appendChild(tempDiv);
                              setTimeout(() => document.body.removeChild(tempDiv), 2000);
                            }
                          }
                        } catch (error) {
                          console.error('Error:', error);
                          const tempDiv = document.createElement('div');
                          tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg';
                          tempDiv.textContent = '❌ Failed to fix spelling';
                          document.body.appendChild(tempDiv);
                          setTimeout(() => document.body.removeChild(tempDiv), 2000);
                        } finally {
                          setExtracting(false);
                        }
                      }}
                      disabled={extracting}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      title="Apply AI-powered corrections"
                    >
                      <Sparkles size={18} />
                      <span className="text-sm">Fix Spelling (AI)</span>
                    </button>
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
                          setShowTextPopup(false);
                          setShowChat(true);
                        }
                      }}
                      disabled={extracting || !extractedText}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      title="Open in chat"
                    >
                      <MessageSquare size={18} />
                      <span className="text-sm">Open in Chat</span>
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
                    style={{ fontFamily: 'Georgia, serif' }}
                  />
                </div>
                
                <div className="p-4 border-t bg-slate-50">
                  <p className="text-xs text-slate-600">
                    💡 <strong>Tip:</strong> Click &quot;Fix Spelling&quot; to correct transliteration issues (Shīʿī, Sunnī, Ḥadīth, etc.)
                  </p>
                </div>
              </div>
            </div>
          )}

          {showCitationMenu && selectedBook && (
      <div
        data-citation-menu
        className="fixed z-50 bg-white border border-slate-300 rounded-lg shadow-2xl p-2 flex flex-col gap-2"
        style={{
          left: `${citationPosition.x}px`,
          top: citationPosition.placement === 'below' 
            ? `${citationPosition.y}px` 
            : citationPosition.placement === 'fixed-top'
              ? `${citationPosition.y}px`
              : `${citationPosition.y}px`,
          transform: citationPosition.placement === 'below'
            ? 'translate(-50%, 0)' 
            : citationPosition.placement === 'fixed-top'
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)',
          maxWidth: '400px',
          maxHeight: '90vh', // ✅ Prevent menu from exceeding viewport
          overflowY: 'auto', // ✅ Allow scrolling if content is too tall
        }}
      >
        {/* ✅ Add placement indicator for debugging (optional) */}
        {citationPosition.placement === 'below' && (
          <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white border-t border-l border-slate-300 rotate-45"></div>
        )}
        {citationPosition.placement === 'above' && (
          <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white border-b border-r border-slate-300 rotate-45"></div>
        )}

        {/* Show selected text preview */}
        <div className="px-3 py-2 bg-slate-50 rounded text-xs max-h-32 overflow-y-auto border border-slate-200">
          <p className="font-medium text-slate-600 mb-1">Selected Text:</p>
          <p className="text-slate-700 leading-relaxed">
            {selectedTextForCitation.substring(0, 150)}
            {selectedTextForCitation.length > 150 ? '...' : ''}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={fixSelectedTextSpelling}
            disabled={isFixingSpelling}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 flex-1"
            title="Fix transliteration & copy to clipboard"
          >
            {isFixingSpelling ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Fixing...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Fix & Copy
              </>
            )}
          </button>
          
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(selectedTextForCitation);
              const tempDiv = document.createElement('div');
              tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg';
              tempDiv.textContent = '✅ Copied!';
              document.body.appendChild(tempDiv);
              setTimeout(() => document.body.removeChild(tempDiv), 2000);
            }}
            className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            title="Copy as-is"
          >
            <Copy size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowCommentDialog(true);
              setShowCitationMenu(false);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex-1"
          >
            <MessageSquare size={16} />
            Comment
          </button>
          
          <div className="relative group flex-1">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
            >
              <FileText size={16} />
              Cite
            </button>
            
            {/* ✅ IMPROVED: Citation dropdown now opens upward if near bottom */}
            <div className={`absolute ${
              citationPosition.placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
            } left-0 hidden group-hover:block bg-white border border-slate-300 rounded-lg shadow-xl p-2 w-40 z-10`}>
              {['APA', 'MLA', 'Chicago', 'Harvard'].map((style) => (
                <button
                  key={style}
                  onClick={() => generateCitation(style)}
                  disabled={loadingCitation}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 rounded text-sm transition-colors disabled:opacity-50"
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowCitationMenu(false)}
            className="p-2 hover:bg-slate-100 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    )}

      {/* Comment Dialog */}
      {showCommentDialog && selectedBook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex-shrink-0">
              <h3 className="font-bold text-lg">Add Comment - Page {currentPage}</h3>
              {selectedTextForComment && (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                  <p className="text-xs text-slate-500 mb-1 font-medium">Selected Text:</p>
                  <p className="text-sm text-slate-700 italic leading-relaxed">
                    &quot;{selectedTextForComment}&quot;
                  </p>
                </div>
              )}
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Enter your comment..."
                rows={8}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              />
            </div>

            <div className="p-4 border-t flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => {
                  setShowCommentDialog(false);
                  setCommentDraft('');
                  setSelectedTextForComment('');
                }}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addComment}
                disabled={!commentDraft.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                Add Comment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Citation Dialog */}
      {showCitationDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-lg">Generated Citation</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedCitation);
                  alert('Citation copied!');
                }}
                className="p-2 hover:bg-slate-100 rounded transition-colors"
                title="Copy citation"
              >
                <Copy size={20} />
              </button>
            </div>
            
            <div className="p-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm">
                {generatedCitation}
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCitationDialog(false);
                  setGeneratedCitation('');
                }}
                className="px-4 py-2 bg-slate-200 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedCitation);
                  alert('Citation copied!');
                  setShowCitationDialog(false);
                }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Copy & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}