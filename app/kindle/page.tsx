'use client';

import { useState, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function KindlePage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedBook, setUploadedBook] = useState<{ id: string; title: string } | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageText, setPageText] = useState('');
  const [extracting, setExtracting] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [sending, setSending] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ==================== FILE UPLOAD ====================
  async function handleFileUpload() {
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/books/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (data.success) {
        setUploadedBook({
          id: data.bookId,
          title: data.title || file.name
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Upload failed. Please try again.');
      console.error(error);
    } finally {
      setUploading(false);
    }
  }

  // ==================== TEXT EXTRACTION ====================
  async function extractText() {
    if (!uploadedBook) return;

    setExtracting(true);
    setPageText('🔄 Extracting text from page ' + currentPage + '...');

    try {
      const res = await fetch('/api/books/extract-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: uploadedBook.id,
          pageNumber: currentPage,
          enableAiCorrection: false
        })
      });

      const data = await res.json();

      if (data.success && data.text) {
        setPageText(data.text);
      } else {
        setPageText('❌ No text found on this page.');
      }
    } catch (error) {
      setPageText('❌ Error extracting text.');
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
          bookTitle: uploadedBook?.title
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
        content: '❌ Failed to get response. Please try again.'
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

      {/* ==================== UPLOAD SECTION ==================== */}
      {!uploadedBook ? (
        <div style={{
          border: '2px dashed #ccc',
          padding: '20px',
          textAlign: 'center',
          borderRadius: '8px',
          background: '#f9f9f9'
        }}>
          <h2 style={{ fontSize: '16px', marginBottom: '15px' }}>📂 Upload PDF from Kindle</h2>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{
              display: 'block',
              margin: '10px auto',
              padding: '8px',
              fontSize: '14px'
            }}
          />

          {file && (
            <div style={{ margin: '10px 0', fontSize: '13px', color: '#666' }}>
              Selected: <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </div>
          )}

          <button
            onClick={handleFileUpload}
            disabled={!file || uploading}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              border: 'none',
              borderRadius: '5px',
              background: !file || uploading ? '#ccc' : '#4CAF50',
              color: 'white',
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              marginTop: '10px'
            }}
          >
            {uploading ? '⏳ Uploading...' : '📤 Upload PDF'}
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
            <strong style={{ fontSize: '15px' }}>📖 {uploadedBook.title}</strong>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              Page {currentPage}
            </div>
            <button
              onClick={() => {
                setUploadedBook(null);
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
              ← Upload Different Book
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
                borderRadius: '4px'
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
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '14px',
                border: '1px solid #ccc',
                background: 'white',
                cursor: 'pointer',
                borderRadius: '4px'
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
              💬 Chat with Gemini
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
                  No messages yet. Start a conversation with Gemini!
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
                      {msg.content}
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
                  minHeight: '60px'
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
            <strong>💡 Tips:</strong>
            <ul style={{ margin: '5px 0 0 0', paddingLeft: '20px' }}>
              <li>Extract page text first for better context</li>
              <li>Use Previous/Next to navigate pages</li>
              <li>Press Enter to send messages quickly</li>
              <li>Chat works without page context too!</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}