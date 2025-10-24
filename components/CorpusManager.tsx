'use client';

import { useState, useEffect } from 'react';
import { Upload, Trash2, Edit2, Check, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  display_name: string;
  total_pages: number;
  selected: boolean;
  embedding_status: string;
  chunks_count: number;
}

interface CorpusManagerProps {
  selectedDocuments: string[];
  onSelectionChange: (ids: string[]) => void;
}

export default function CorpusManager({ 
  selectedDocuments, 
  onSelectionChange 
}: CorpusManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchDocuments();
    // Poll for embedding status updates
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) {
        console.error('Failed to fetch documents:', res.status);
        setDocuments([]);
        return;
      }
      
      const data = await res.json();
      
      // ✅ Handle both response formats
      if (Array.isArray(data)) {
        setDocuments(data);
      } else if (data && Array.isArray(data.documents)) {
        setDocuments(data.documents);
      } else {
        console.warn('Invalid documents response:', data);
        setDocuments([]);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      setDocuments([]);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        await fetchDocuments();
        alert('✅ Document uploaded successfully!');
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
  };

  const handleToggleSelection = (docId: string) => {
    const newSelection = selectedDocuments.includes(docId)
      ? selectedDocuments.filter(id => id !== docId)
      : [...selectedDocuments, docId];
    onSelectionChange(newSelection);
  };

  const handleRename = async (docId: string) => {
    if (!editName.trim()) return;

    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editName.trim() }),
      });

      if (res.ok) {
        await fetchDocuments();
        setEditingId(null);
        setEditName('');
      } else {
        alert('Failed to rename document');
      }
    } catch (error) {
      console.error('Rename error:', error);
      alert('Rename error');
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document? This will remove all embeddings.')) return;

    setDeletingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchDocuments();
        onSelectionChange(selectedDocuments.filter(id => id !== docId));
      } else {
        alert('Failed to delete document');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Delete error');
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
            <CheckCircle size={12} />
            Ready
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
            <Loader2 size={12} className="animate-spin" />
            Processing
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">
            <AlertCircle size={12} />
            Failed
          </span>
        );
      default:
        return (
          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
            Pending
          </span>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-2">📚 Corpus Library</h2>
        <p className="text-sm text-slate-500">Manage your research documents</p>
      </div>

      {/* Upload Section */}
      <div className="p-6 border-b border-slate-200">
        <label className="block">
          <input
            type="file"
            accept=".pdf"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
          <div
            className={`w-full px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer text-center transition-colors ${
              uploading
                ? 'border-slate-300 bg-slate-50 cursor-not-allowed'
                : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin text-emerald-600" />
                <span className="text-sm font-medium text-slate-600">Uploading & Embedding...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Upload size={18} className="text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">Upload PDF Document</span>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto p-6">
        {documents.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload size={32} className="text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium mb-2">No documents yet</p>
            <p className="text-sm text-slate-400">Upload your first PDF to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`p-4 border rounded-lg transition-all ${
                  selectedDocuments.includes(doc.id)
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedDocuments.includes(doc.id)}
                    onChange={() => handleToggleSelection(doc.id)}
                    className="mt-1 w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    disabled={doc.embedding_status !== 'completed'}
                  />

                  {/* Document Info */}
                  <div className="flex-1 min-w-0">
                    {editingId === doc.id ? (
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 text-sm border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRename(doc.id)}
                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditName('');
                          }}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <h3 className="font-medium text-slate-800 mb-1 truncate">
                        {doc.display_name}
                      </h3>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{doc.total_pages} pages</span>
                      <span>•</span>
                      <span>{doc.chunks_count} chunks</span>
                      <span>•</span>
                      {getStatusBadge(doc.embedding_status)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(doc.id);
                        setEditName(doc.display_name);
                      }}
                      className="p-2 hover:bg-slate-100 rounded transition-colors"
                      title="Rename"
                    >
                      <Edit2 size={16} className="text-slate-600" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="p-2 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === doc.id ? (
                        <Loader2 size={16} className="text-red-600 animate-spin" />
                      ) : (
                        <Trash2 size={16} className="text-red-600" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Selection Summary */}
      {documents.length > 0 && (
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">
              <span className="font-medium text-emerald-600">{selectedDocuments.length}</span> of{' '}
              <span className="font-medium">{documents.length}</span> selected
            </span>
            <button
              onClick={() => onSelectionChange([])}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}