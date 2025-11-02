'use client';

import { useState, useEffect } from 'react';
import { Database, Pencil, Check, X, Loader2, BookOpen, AlertCircle, Search, RefreshCw } from 'lucide-react';

interface BookMetadata {
  id: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  edition?: string;
  language?: string;
  filename: string;
  page_count: number;
  size: number;
  uploaded_at: string;
  last_read: string;
}

export default function MetadataManager() {
  const [books, setBooks] = useState<BookMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [metadataForm, setMetadataForm] = useState({
    title: '',
    author: '',
    publisher: '',
    year: '',
    isbn: '',
    edition: '',
    language: 'Arabic',
  });

  useEffect(() => {
    loadBooks();
  }, []);

  async function loadBooks() {
    setLoading(true);
    try {
      const res = await fetch('/api/books/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error('Failed to load books');
      }

      const data = await res.json();
      setBooks(data.books || []);
    } catch (error) {
      console.error('Error loading books:', error);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(book: BookMetadata) {
    setEditingBookId(book.id);
    setMetadataForm({
      title: book.title || '',
      author: book.author || '',
      publisher: book.publisher || '',
      year: book.year || '',
      isbn: book.isbn || '',
      edition: book.edition || '',
      language: book.language || 'Arabic',
    });
  }

  function cancelEdit() {
    setEditingBookId(null);
    setMetadataForm({
      title: '',
      author: '',
      publisher: '',
      year: '',
      isbn: '',
      edition: '',
      language: 'Arabic',
    });
  }

  async function saveMetadata() {
    if (!editingBookId || !metadataForm.title.trim()) {
      alert('Title is required');
      return;
    }

    setSaving(true);

    try {
      const res = await fetch('/api/books/metadata', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: editingBookId,
          ...metadataForm,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save metadata');
      }

      await loadBooks();
      cancelEdit();

      // Success notification
      const tempDiv = document.createElement('div');
      tempDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[150] bg-green-600 text-white px-6 py-3 rounded-lg shadow-xl font-medium';
      tempDiv.textContent = '✅ Metadata saved successfully!';
      document.body.appendChild(tempDiv);
      setTimeout(() => document.body.removeChild(tempDiv), 3000);

    } catch (error) {
      console.error('Error saving metadata:', error);
      alert('Failed to save metadata');
    } finally {
      setSaving(false);
    }
  }

  const filteredBooks = books.filter(book =>
    book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.author?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.publisher?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const missingMetadataCount = books.filter(b => !b.author || !b.publisher || !b.year).length;

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg">
                <Database className="text-white" size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-800">Book Metadata Manager</h1>
                <p className="text-slate-600 mt-1">
                  Manage book information for accurate citations and better organization
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              {/* Stats */}
              <div className="text-right">
                <div className="text-sm text-slate-600">Total Books</div>
                <div className="text-3xl font-bold text-blue-600">{books.length}</div>
              </div>
              {missingMetadataCount > 0 && (
                <div className="text-right">
                  <div className="text-sm text-amber-600">Needs Metadata</div>
                  <div className="text-3xl font-bold text-amber-600">{missingMetadataCount}</div>
                </div>
              )}
              {/* Refresh Button */}
              <button
                onClick={loadBooks}
                disabled={loading}
                className="p-3 bg-blue-100 hover:bg-blue-200 rounded-xl transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`text-blue-600 ${loading ? 'animate-spin' : ''}`} size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-7xl mx-auto px-8 py-6 h-full">
          <div className="bg-white rounded-2xl shadow-xl h-full flex flex-col">
            
            {/* Search Bar */}
            <div className="p-6 border-b border-slate-200">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title, author, or publisher..."
                  className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Books Grid - FIXED SCROLLING */}
            <div className="flex-1 overflow-y-auto p-6" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {loading ? (
                <div className="flex items-center justify-center h-full min-h-[400px]">
                  <div className="text-center">
                    <Loader2 className="animate-spin text-blue-600 mx-auto mb-4" size={48} />
                    <p className="text-slate-600">Loading books...</p>
                  </div>
                </div>
              ) : filteredBooks.length === 0 ? (
                <div className="flex items-center justify-center h-full min-h-[400px]">
                  <div className="text-center">
                    <BookOpen className="mx-auto mb-4 text-slate-400" size={64} />
                    <p className="text-xl text-slate-600 font-medium">
                      {searchQuery ? 'No books match your search' : 'No books uploaded yet'}
                    </p>
                    <p className="text-sm text-slate-500 mt-2">
                      {searchQuery ? 'Try a different search term' : 'Upload PDFs in Reader Mode to get started'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
                  {filteredBooks.map((book) => (
                    <div
                      key={book.id}
                      className={`bg-gradient-to-br from-white to-slate-50 rounded-xl border-2 transition-all duration-200 ${
                        editingBookId === book.id
                          ? 'border-blue-400 shadow-xl ring-4 ring-blue-100'
                          : 'border-slate-200 hover:border-blue-200 hover:shadow-lg'
                      }`}
                    >
                      {editingBookId === book.id ? (
                        /* EDIT MODE */
                        <div className="p-6">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                              <Pencil size={20} className="text-blue-600" />
                              Editing Book
                            </h3>
                            <div className="flex gap-2">
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Cancel"
                              >
                                <X size={18} />
                              </button>
                              <button
                                onClick={saveMetadata}
                                disabled={saving || !metadataForm.title.trim()}
                                className="p-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                                title="Save"
                              >
                                {saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {/* Title */}
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                Title <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={metadataForm.title}
                                onChange={(e) => setMetadataForm({ ...metadataForm, title: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                placeholder="Book title"
                              />
                            </div>

                            {/* Author */}
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Author</label>
                              <input
                                type="text"
                                value={metadataForm.author}
                                onChange={(e) => setMetadataForm({ ...metadataForm, author: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                placeholder="Author name"
                              />
                            </div>

                            {/* Publisher */}
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Publisher</label>
                              <input
                                type="text"
                                value={metadataForm.publisher}
                                onChange={(e) => setMetadataForm({ ...metadataForm, publisher: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                placeholder="Publisher name"
                              />
                            </div>

                            {/* Year & Edition */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Year</label>
                                <input
                                  type="text"
                                  value={metadataForm.year}
                                  onChange={(e) => setMetadataForm({ ...metadataForm, year: e.target.value })}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                  placeholder="2024"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Edition</label>
                                <input
                                  type="text"
                                  value={metadataForm.edition}
                                  onChange={(e) => setMetadataForm({ ...metadataForm, edition: e.target.value })}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                  placeholder="1st, 2nd..."
                                />
                              </div>
                            </div>

                            {/* ISBN */}
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">ISBN</label>
                              <input
                                type="text"
                                value={metadataForm.isbn}
                                onChange={(e) => setMetadataForm({ ...metadataForm, isbn: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                placeholder="978-3-16-148410-0"
                              />
                            </div>

                            {/* Language */}
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Language</label>
                              <select
                                value={metadataForm.language}
                                onChange={(e) => setMetadataForm({ ...metadataForm, language: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                              >
                                <option value="Arabic">Arabic</option>
                                <option value="English">English</option>
                                <option value="French">French</option>
                                <option value="Urdu">Urdu</option>
                                <option value="Persian">Persian</option>
                                <option value="Turkish">Turkish</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* VIEW MODE */
                        <div className="p-6">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-lg font-semibold text-slate-800 truncate mb-1">
                                {book.title}
                              </h3>
                              <p className="text-xs text-slate-500">{book.filename}</p>
                            </div>
                            <button
                              onClick={() => startEdit(book)}
                              className="flex-shrink-0 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit Metadata"
                            >
                              <Pencil size={18} />
                            </button>
                          </div>

                          <div className="space-y-2 mb-4">
                            {book.author && (
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">Author:</span>
                                <span className="text-xs text-slate-700">{book.author}</span>
                              </div>
                            )}
                            {book.publisher && (
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">Publisher:</span>
                                <span className="text-xs text-slate-700">{book.publisher}</span>
                              </div>
                            )}
                            {book.year && (
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">Year:</span>
                                <span className="text-xs text-slate-700">{book.year}</span>
                              </div>
                            )}
                            {book.edition && (
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">Edition:</span>
                                <span className="text-xs text-slate-700">{book.edition}</span>
                              </div>
                            )}
                            {book.isbn && (
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-slate-600 w-20 flex-shrink-0">ISBN:</span>
                                <span className="text-xs text-slate-700 font-mono">{book.isbn}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs flex-wrap">
                            <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-700">
                              {book.language || 'Arabic'}
                            </span>
                            <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-700">
                              {book.page_count} pages
                            </span>
                            <span className="px-2 py-1 bg-slate-100 rounded-md text-slate-700">
                              {(book.size / 1024 / 1024).toFixed(1)} MB
                            </span>
                          </div>

                          {/* Missing Info Warning */}
                          {(!book.author || !book.publisher || !book.year) && (
                            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                              <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={16} />
                              <div className="flex-1">
                                <p className="text-xs font-medium text-amber-800 mb-1">Missing metadata</p>
                                <p className="text-xs text-amber-700">
                                  Add author, publisher, and year for accurate citations
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}