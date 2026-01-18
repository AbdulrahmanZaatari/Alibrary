'use client';

import { useState, useEffect } from 'react';
import { 
  X, 
  Loader2, 
  Book, 
  Edit3, 
  Trash2, 
  Save, 
  Plus,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface GlossaryTerm {
  term: string;
  definition: string;
  page: number;
  category?: string;
}

interface Glossary {
  id: string;
  book_id: string;
  book_title: string | null;
  page_start: number;
  page_end: number;
  query: string;
  terms: GlossaryTerm[];
  created_at: string;
  updated_at: string;
}

interface CorpusDocument {
  id: string;
  display_name: string;
}

interface GlossaryManagerProps {
  bookId?: string; // Local SQLite book ID (for display purposes)
  bookTitle?: string;
  supabaseDocId?: string; // The Supabase document ID for chunks query (auto-detected)
  onClose: () => void;
}

export default function GlossaryManager({ 
  // bookId not used - we use supabaseDocId or selectedDocId instead
  bookTitle,
  supabaseDocId: initialSupabaseDocId,
  onClose
}: GlossaryManagerProps) {
  const [glossaries, setGlossaries] = useState<Glossary[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedTerms, setEditedTerms] = useState<GlossaryTerm[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // Corpus document selection
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>(initialSupabaseDocId || '');
  const [loadingCorpus, setLoadingCorpus] = useState(true);
  
  // New glossary form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newPageStart, setNewPageStart] = useState(1);
  const [newPageEnd, setNewPageEnd] = useState(10);

  // Fetch corpus documents on mount
  useEffect(() => {
    fetchCorpusDocuments();
  }, []);

  // Fetch glossaries when selected document changes
  useEffect(() => {
    if (selectedDocId) {
      fetchGlossaries();
    }
  }, [selectedDocId]);

  const fetchCorpusDocuments = async () => {
    setLoadingCorpus(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) {
        setCorpusDocuments(data.documents);
        // If no initial doc was provided, try to find matching one by title
        if (!initialSupabaseDocId && bookTitle && data.documents.length > 0) {
          const match = data.documents.find((doc: CorpusDocument) =>
            doc.display_name === bookTitle ||
            doc.display_name.includes(bookTitle) ||
            bookTitle.includes(doc.display_name)
          );
          if (match) {
            setSelectedDocId(match.id);
          }
        } else if (initialSupabaseDocId) {
          setSelectedDocId(initialSupabaseDocId);
        }
      }
    } catch (error) {
      console.error('Error fetching corpus documents:', error);
    } finally {
      setLoadingCorpus(false);
    }
  };

  const fetchGlossaries = async () => {
    if (!selectedDocId) return;
    setLoading(true);
    try {
      const url = `/api/glossary?bookId=${encodeURIComponent(selectedDocId)}`;
      const res = await fetch(url);
      const data = await res.json();
      setGlossaries(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching glossaries:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateNewGlossary = async () => {
    if (!selectedDocId) {
      alert('يرجى اختيار مستند من القائمة أولاً.\n\nPlease select a document from the dropdown first.');
      return;
    }
    
    // Find the selected document's display name
    const selectedDoc = corpusDocuments.find(d => d.id === selectedDocId);
    const docTitle = selectedDoc?.display_name || bookTitle || 'Unknown';
    
    setGenerating(true);
    try {
      const res = await fetch('/api/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: selectedDocId, // Use selected Supabase document ID
          bookTitle: docTitle,
          pageStart: newPageStart,
          pageEnd: newPageEnd,
          query: `Glossary for pages ${newPageStart}-${newPageEnd}`
        })
      });
      
      const data = await res.json();
      if (data.error) {
        alert(`Error: ${data.error}`);
      } else if (data.id) {
        setGlossaries(prev => [data, ...prev]);
        setShowNewForm(false);
        setExpandedId(data.id);
      }
    } catch (error) {
      console.error('Error generating glossary:', error);
      alert('فشل في إنشاء قائمة المصطلحات. حاول مرة أخرى.\n\nFailed to generate glossary. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const startEditing = (glossary: Glossary) => {
    setEditingId(glossary.id);
    setEditedTerms([...glossary.terms]);
  };

  const saveEdits = async (glossaryId: string) => {
    try {
      await fetch('/api/glossary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: glossaryId, terms: editedTerms })
      });
      
      setGlossaries(prev => prev.map(g => 
        g.id === glossaryId ? { ...g, terms: editedTerms } : g
      ));
      setEditingId(null);
    } catch (error) {
      console.error('Error saving glossary:', error);
    }
  };

  const deleteGlossary = async (id: string) => {
    if (!confirm('هل تريد حذف هذه القائمة؟ / Delete this glossary?')) return;
    
    try {
      await fetch(`/api/glossary?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      setGlossaries(prev => prev.filter(g => g.id !== id));
    } catch (error) {
      console.error('Error deleting glossary:', error);
    }
  };

  const updateTerm = (index: number, field: keyof GlossaryTerm, value: string | number) => {
    setEditedTerms(prev => prev.map((t, i) => 
      i === index ? { ...t, [field]: value } : t
    ));
  };

  const addTerm = () => {
    setEditedTerms(prev => [...prev, { term: '', definition: '', page: 1 }]);
  };

  const removeTerm = (index: number) => {
    setEditedTerms(prev => prev.filter((_, i) => i !== index));
  };

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'concept': return 'bg-blue-100 text-blue-700';
      case 'technical': return 'bg-purple-100 text-purple-700';
      case 'name': return 'bg-green-100 text-green-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const getCategoryLabel = (category?: string) => {
    switch (category) {
      case 'concept': return 'مفهوم';
      case 'technical': return 'فني';
      case 'name': return 'علم';
      default: return 'أخرى';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Book className="text-amber-600" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                قوائم المصطلحات / Glossaries
              </h2>
              {bookTitle && (
                <p className="text-sm text-slate-600">{bookTitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Document Selector */}
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <label className="block text-sm font-medium text-blue-800 mb-2">
              اختر المستند / Select Corpus Document
            </label>
            {loadingCorpus ? (
              <div className="flex items-center gap-2 text-blue-600">
                <Loader2 className="animate-spin" size={16} />
                <span>جاري تحميل المستندات...</span>
              </div>
            ) : corpusDocuments.length === 0 ? (
              <div className="text-amber-700 text-sm">
                لا توجد مستندات في المكتبة. أضف مستندات من شاشة البحث الرئيسية.
                <br />
                No documents in corpus. Add documents from the main research screen.
              </div>
            ) : (
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="w-full px-3 py-2 border border-blue-300 rounded-lg bg-white text-slate-800"
              >
                <option value="">-- اختر مستند / Select a document --</option>
                {corpusDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.display_name}
                  </option>
                ))}
              </select>
            )}
            {selectedDocId && (
              <p className="text-xs text-blue-600 mt-1 font-mono">
                ID: {selectedDocId}
              </p>
            )}
          </div>
          
          {/* New Glossary Button/Form */}
          {selectedDocId && (
            <div className="mb-4">
              {!showNewForm ? (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="w-full p-3 border-2 border-dashed border-amber-300 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={20} />
                  إنشاء قائمة مصطلحات جديدة / Generate New Glossary
                </button>
              ) : (
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <h3 className="font-medium text-amber-800 mb-3">نطاق الصفحات / Page Range</h3>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1">
                      <label className="text-sm text-slate-600 mb-1 block">من صفحة / From</label>
                      <input
                        type="number"
                        min={1}
                        value={newPageStart}
                        onChange={e => setNewPageStart(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm text-slate-600 mb-1 block">إلى صفحة / To</label>
                      <input
                        type="number"
                        min={newPageStart}
                        value={newPageEnd}
                        onChange={e => setNewPageEnd(parseInt(e.target.value) || newPageStart)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={generateNewGlossary}
                      disabled={generating}
                      className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {generating ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          جاري الإنشاء...
                        </>
                      ) : (
                        <>
                          <FileText size={16} />
                          إنشاء / Generate
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowNewForm(false)}
                      className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                    >
                      إلغاء / Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-amber-600" size={32} />
            </div>
          )}

          {/* Empty State */}
          {!loading && glossaries.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <Book size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg">لا توجد قوائم مصطلحات / No glossaries found</p>
              <p className="text-sm mt-2">
                أنشئ قائمة جديدة بتحديد نطاق الصفحات
              </p>
            </div>
          )}

          {/* Glossaries List */}
          {!loading && glossaries.map(glossary => (
            <div 
              key={glossary.id}
              className="mb-4 border border-slate-200 rounded-lg overflow-hidden"
            >
              {/* Glossary Header */}
              <div 
                className="p-3 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100"
                onClick={() => setExpandedId(expandedId === glossary.id ? null : glossary.id)}
              >
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-amber-600" />
                  <div>
                    <p className="font-medium text-slate-800">
                      صفحات {glossary.page_start} - {glossary.page_end}
                    </p>
                    <p className="text-xs text-slate-500">
                      {glossary.terms.length} مصطلح • {new Date(glossary.created_at).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editingId !== glossary.id && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditing(glossary); }}
                        className="p-1.5 hover:bg-slate-200 rounded transition-colors"
                        title="تعديل / Edit"
                      >
                        <Edit3 size={16} className="text-slate-600" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteGlossary(glossary.id); }}
                        className="p-1.5 hover:bg-red-100 rounded transition-colors"
                        title="حذف / Delete"
                      >
                        <Trash2 size={16} className="text-red-500" />
                      </button>
                    </>
                  )}
                  {expandedId === glossary.id ? (
                    <ChevronUp size={18} className="text-slate-400" />
                  ) : (
                    <ChevronDown size={18} className="text-slate-400" />
                  )}
                </div>
              </div>

              {/* Glossary Terms */}
              {expandedId === glossary.id && (
                <div className="p-4 bg-white">
                  {editingId === glossary.id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      {editedTerms.map((term, index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <div className="flex-1 grid grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={term.term}
                              onChange={e => updateTerm(index, 'term', e.target.value)}
                              placeholder="المصطلح"
                              className="col-span-3 px-2 py-1.5 border border-slate-300 rounded text-sm"
                              dir="rtl"
                            />
                            <input
                              type="text"
                              value={term.definition}
                              onChange={e => updateTerm(index, 'definition', e.target.value)}
                              placeholder="التعريف"
                              className="col-span-7 px-2 py-1.5 border border-slate-300 rounded text-sm"
                              dir="rtl"
                            />
                            <input
                              type="number"
                              value={term.page}
                              onChange={e => updateTerm(index, 'page', parseInt(e.target.value) || 1)}
                              className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-sm text-center"
                            />
                          </div>
                          <button
                            onClick={() => removeTerm(index)}
                            className="p-1.5 hover:bg-red-100 rounded"
                          >
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={addTerm}
                          className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 text-sm flex items-center gap-1"
                        >
                          <Plus size={14} />
                          إضافة مصطلح
                        </button>
                        <button
                          onClick={() => saveEdits(glossary.id)}
                          className="px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 text-sm flex items-center gap-1"
                        >
                          <Save size={14} />
                          حفظ التغييرات
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 text-sm"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View Mode - Table
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" dir="rtl">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-right py-2 px-2 text-slate-600 font-medium">المصطلح</th>
                            <th className="text-right py-2 px-2 text-slate-600 font-medium">التعريف</th>
                            <th className="text-center py-2 px-2 text-slate-600 font-medium w-16">صفحة</th>
                            <th className="text-center py-2 px-2 text-slate-600 font-medium w-20">التصنيف</th>
                          </tr>
                        </thead>
                        <tbody>
                          {glossary.terms.map((term, index) => (
                            <tr key={index} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-2 px-2 font-medium text-slate-800">{term.term}</td>
                              <td className="py-2 px-2 text-slate-600">{term.definition}</td>
                              <td className="py-2 px-2 text-center text-slate-500">{term.page}</td>
                              <td className="py-2 px-2 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs ${getCategoryColor(term.category)}`}>
                                  {getCategoryLabel(term.category)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <p className="text-sm text-slate-500">
            {glossaries.length} قائمة مصطلحات
          </p>
          <button
            onClick={fetchGlossaries}
            className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded flex items-center gap-1 text-sm"
          >
            <RefreshCw size={14} />
            تحديث / Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
