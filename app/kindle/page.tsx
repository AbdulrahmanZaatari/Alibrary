'use client';

import { useState, useRef, useEffect } from 'react';

interface Book {
  id: string;
  title: string;
  author?: string;
  filename: string;
  total_pages?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function KindlePage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageText, setPageText] = useState('');
  const [extracting, setExtracting] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [sending, setSending] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ==================== LOAD BOOKS ON MOUNT ====================
  useEffect(() => {
    loadBooks();
  }, []);

  async function loadBooks() {
    setLoadingBooks(true);
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      
      if (data.books && Array.isArray(data.books)) {
        setBooks(data.books);
      }
    } catch (error) {
      console.error('Failed to load books:', error);
    } finally {
      setLoadingBooks(false);
    }
  }

  // ==================== SELECT BOOK ====================
  function selectBook(book: Book) {
    setSelectedBook(book);
    setCurrentPage(1);
    setPageText('');
    setMessages([]);
  }

  // ==================== TEXT EXTRACTION ====================
  async function extractText() {
    if (!selectedBook) return;

    setExtracting(true);
    setPageText('🔄 Extracting text from page ' + currentPage + '...');

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
        setPageText(data.text);
      } else {
        setPageText('❌ No text found on this page. The page might be an image.');
      }
    } catch (error) {
      setPageText('❌ Error extracting text. Please try again.');
      console.error(error);
    } finally {
      setExtracting(false);
    }
  }

  // ==================== CHAT WITH GEMINI ====================
  async function sendMessage() {
    if (!userInput.trim()) return;

    const userMessage = userInput;
    setUserInput('');
    setSending(true);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const res = await fetch('/api/kindle-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          pageText: pageText || undefined,
          pageNumber: currentPage,
          bookTitle: selectedBook?.title
        })
      });

      if (!res.ok) {
        throw new Error('Failed to get response');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';

      // Add empty assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantMessage += chunk;

        // Update last message
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: assistantMessage
          };
          return newMessages;
        });
      }

      // Scroll to bottom
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Failed to get response. Please check your internet connection and try again.'
      }]);
      console.error(error);
    } finally {
      setSending(false);
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ==================== RENDER ====================
  return (
    <div style={{
      fontFamily: 'Georgia, serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '15px',
      fontSize: '14px'
    }}>
      <h1 style={{
        fontSize: '20px',
        marginBottom: '15px',
        textAlign: 'center',
        borderBottom: '2px solid #333',
        paddingBottom: '10px'
      }}>
        📚 Islamic Research - Kindle Mode
      </h1>

      {/* ==================== BOOK SELECTION ==================== */}
      {!selectedBook ? (
        <div>
          <h2 style={{ fontSize: '16px', marginBottom: '12px' }}>
            Select a Book from Your Library:
          </h2>

          {loadingBooks ? (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              color: '#666'
            }}>
              <div>⏳ Loading your books...</div>
            </div>
          ) : books.length === 0 ? (
            <div style={{
              border: '2px dashed #ccc',
              padding: '30px',
              textAlign: 'center',
              borderRadius: '8px',
              background: '#f9f9f9'
            }}>
              <div style={{ fontSize: '16px', marginBottom: '10px' }}>📚</div>
              <div style={{ color: '#666', marginBottom: '15px' }}>
                No books in your library yet.
              </div>
              <div style={{ fontSize: '13px', color: '#999' }}>
                Upload books from your desktop at:<br />
                <strong>{typeof window !== 'undefined' ? window.location.origin : ''}</strong>
              </div>
            </div>
          ) : (
            <div>
              {books.map(book => (
                <button
                  key={book.id}
                  onClick={() => selectBook(book)}
                  style={{
                    display: 'block',
                    width: '100%',
                    margin: '8px 0',
                    padding: '12px',
                    textAlign: 'left',
                    border: '1px solid #ccc',
                    background: '#f9f9f9',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                    📖 {book.title}
                  </div>
                  {book.author && (
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {book.author}
                    </div>
                  )}
                  {book.total_pages && (
                    <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                      {book.total_pages} pages
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={loadBooks}
            style={{
              marginTop: '15px',
              padding: '10px 15px',
              fontSize: '13px',
              border: '1px solid #ccc',
              background: 'white',
              borderRadius: '5px',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            🔄 Refresh Book List
          </button>
        </div>
      ) : (
        <div>
          {/* ==================== BOOK INFO ==================== */}
          <div style={{
            background: '#f0f0f0',
            padding: '12px',
            borderRadius: '5px',
            marginBottom: '15px',
            border: '1px solid #ddd'
          }}>
            <strong style={{ fontSize: '15px' }}>📖 {selectedBook.title}</strong>
            {selectedBook.author && (
              <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>
                by {selectedBook.author}
              </div>
            )}
            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              Page {currentPage}
              {selectedBook.total_pages && ` of ${selectedBook.total_pages}`}
            </div>
            <button
              onClick={() => {
                setSelectedBook(null);
                setPageText('');
                setMessages([]);
                setCurrentPage(1);
              }}
              style={{
                marginTop: '8px',
                padding: '5px 10px',
                fontSize: '12px',
                border: '1px solid #999',
                background: 'white',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              ← Back to Library
            </button>
          </div>

          {/* ==================== PAGE CONTROLS ==================== */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '15px'
          }}>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '14px',
                border: '1px solid #ccc',
                background: currentPage <= 1 ? '#f5f5f5' : 'white',
                cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                borderRadius: '4px',
                opacity: currentPage <= 1 ? 0.5 : 1
              }}
            >
              ← Previous
            </button>

            <button
              onClick={extractText}
              disabled={extracting}
              style={{
                flex: 2,
                padding: '10px',
                fontSize: '14px',
                border: 'none',
                background: extracting ? '#ccc' : '#2196F3',
                color: 'white',
                cursor: extracting ? 'not-allowed' : 'pointer',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}
            >
              {extracting ? '⏳ Extracting...' : '📄 Extract Page Text'}
            </button>

            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={selectedBook.total_pages ? currentPage >= selectedBook.total_pages : false}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '14px',
                border: '1px solid #ccc',
                background: 'white',
                cursor: 'pointer',
                borderRadius: '4px',
                opacity: (selectedBook.total_pages && currentPage >= selectedBook.total_pages) ? 0.5 : 1
              }}
            >
              Next →
            </button>
          </div>

          {/* ==================== EXTRACTED TEXT ==================== */}
          {pageText && (
            <div style={{
              border: '1px solid #ddd',
              padding: '12px',
              marginBottom: '15px',
              background: '#fafafa',
              maxHeight: '200px',
              overflow: 'auto',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              borderRadius: '5px'
            }}>
              {pageText}
            </div>
          )}

          {/* ==================== CHAT SECTION ==================== */}
          <div style={{
            border: '2px solid #333',
            borderRadius: '8px',
            padding: '12px',
            background: '#fff'
          }}>
            <h3 style={{
              fontSize: '15px',
              marginBottom: '10px',
              borderBottom: '1px solid #ddd',
              paddingBottom: '8px'
            }}>
              💬 Chat with Gemini AI
            </h3>

            {/* Messages */}
            <div style={{
              maxHeight: '300px',
              overflow: 'auto',
              marginBottom: '12px',
              minHeight: '150px'
            }}>
              {messages.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  color: '#999',
                  padding: '40px 20px',
                  fontSize: '13px'
                }}>
                  No messages yet. Start a conversation!<br />
                  <span style={{ fontSize: '11px', marginTop: '5px', display: 'block' }}>
                    💡 Extract page text first for better context
                  </span>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      margin: '8px 0',
                      padding: '10px 12px',
                      background: msg.role === 'user' ? '#e3f2fd' : '#f5f5f5',
                      borderRadius: '6px',
                      border: '1px solid ' + (msg.role === 'user' ? '#90caf9' : '#e0e0e0')
                    }}
                  >
                    <div style={{
                      fontSize: '11px',
                      color: '#666',
                      marginBottom: '4px',
                      fontWeight: 'bold'
                    }}>
                      {msg.role === 'user' ? '👤 You' : '🤖 Gemini'}
                    </div>
                    <div style={{
                      fontSize: '13px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {msg.content || '...'}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message... (Press Enter to send)"
                disabled={sending}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '60px',
                  background: sending ? '#f5f5f5' : 'white'
                }}
                rows={2}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !userInput.trim()}
                style={{
                  padding: '10px 15px',
                  border: 'none',
                  borderRadius: '5px',
                  background: sending || !userInput.trim() ? '#ccc' : '#4CAF50',
                  color: 'white',
                  cursor: sending || !userInput.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  minWidth: '60px'
                }}
              >
                {sending ? '⏳' : '➤'}
              </button>
            </div>
          </div>

          {/* ==================== TIPS ==================== */}
          <div style={{
            marginTop: '15px',
            padding: '10px',
            background: '#fffbeb',
            border: '1px solid #fbbf24',
            borderRadius: '5px',
            fontSize: '12px',
            lineHeight: '1.5'
          }}>
            <strong>💡 Quick Tips:</strong>
            <ul style={{ margin: '5px 0 0 0', paddingLeft: '20px' }}>
              <li>Extract page text for AI to understand context</li>
              <li>Navigate with Previous/Next buttons</li>
              <li>Press Enter to send messages quickly</li>
              <li>AI works without page text too (general questions)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}