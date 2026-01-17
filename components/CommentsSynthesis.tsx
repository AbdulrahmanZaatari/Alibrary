'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Loader2, 
  BookOpen, 
  RefreshCw, 
  Save, 
  Edit3, 
  Check, 
  Lightbulb, 
  Layers, 
  FileText,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Trash2,
  Plus,
  Copy,
  Download
} from 'lucide-react';

interface Comment {
  id: string;
  book_id: string;
  page_number: number;
  selected_text: string | null;
  comment: string;
  created_at: string;
}

interface SynthesizedSection {
  id: string;
  title: string;
  content: string;
  relatedComments: string[];
  pageReferences: number[];
}

interface Theme {
  name: string;
  description: string;
  commentIds: string[];
}

interface SynthesisData {
  bookId: string;
  bookTitle: string;
  generatedAt: string;
  totalComments: number;
  summary: string;
  keyInsights: string[];
  themes: Theme[];
  sections: SynthesizedSection[];
  rawComments: Comment[];
}

interface CommentsSynthesisProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  onPageClick?: (pageNumber: number) => void;
}

export default function CommentsSynthesis({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  onPageClick
}: CommentsSynthesisProps) {
  const [data, setData] = useState<SynthesisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Editable state
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [editingInsights, setEditingInsights] = useState<number | null>(null);
  const [editedInsight, setEditedInsight] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editedSectionContent, setEditedSectionContent] = useState('');
  const [editedSectionTitle, setEditedSectionTitle] = useState('');
  
  // UI state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [showRawComments, setShowRawComments] = useState(false);

  const fetchSynthesis = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/comments/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, bookTitle })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to synthesize comments');
      }
      
      const result = await response.json();
      setData(result);
      setEditedSummary(result.summary);
      
      // Expand first section by default
      if (result.sections.length > 0) {
        setExpandedSections(new Set([result.sections[0].id]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [bookId, bookTitle]);

  useEffect(() => {
    if (isOpen && !data && !loading) {
      fetchSynthesis();
    }
  }, [isOpen, data, loading, fetchSynthesis]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const toggleTheme = (themeName: string) => {
    setExpandedThemes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(themeName)) {
        newSet.delete(themeName);
      } else {
        newSet.add(themeName);
      }
      return newSet;
    });
  };

  const saveSummary = () => {
    if (data) {
      setData({ ...data, summary: editedSummary });
    }
    setEditingSummary(false);
  };

  const saveInsight = (index: number) => {
    if (data) {
      const newInsights = [...data.keyInsights];
      newInsights[index] = editedInsight;
      setData({ ...data, keyInsights: newInsights });
    }
    setEditingInsights(null);
  };

  const deleteInsight = (index: number) => {
    if (data) {
      const newInsights = data.keyInsights.filter((_, i) => i !== index);
      setData({ ...data, keyInsights: newInsights });
    }
  };

  const addInsight = () => {
    if (data) {
      setData({ ...data, keyInsights: [...data.keyInsights, 'استنتاج جديد...'] });
      setEditingInsights(data.keyInsights.length);
      setEditedInsight('استنتاج جديد...');
    }
  };

  const saveSection = (sectionId: string) => {
    if (data) {
      const newSections = data.sections.map(s => 
        s.id === sectionId 
          ? { ...s, title: editedSectionTitle, content: editedSectionContent }
          : s
      );
      setData({ ...data, sections: newSections });
    }
    setEditingSectionId(null);
  };

  const getCommentById = (commentId: string): Comment | undefined => {
    return data?.rawComments.find(c => c.id === commentId);
  };

  const copyToClipboard = () => {
    if (!data) return;
    
    let text = `# ملخص ملاحظات: ${data.bookTitle}\n`;
    text += `تاريخ الإنشاء: ${new Date(data.generatedAt).toLocaleDateString('ar')}\n`;
    text += `عدد التعليقات: ${data.totalComments}\n\n`;
    
    text += `## الملخص\n${data.summary}\n\n`;
    
    text += `## الاستنتاجات الرئيسية\n`;
    data.keyInsights.forEach((insight, i) => {
      text += `${i + 1}. ${insight}\n`;
    });
    text += '\n';
    
    data.sections.forEach(section => {
      text += `## ${section.title}\n`;
      text += `${section.content}\n`;
      if (section.pageReferences.length > 0) {
        text += `الصفحات: ${section.pageReferences.join(', ')}\n`;
      }
      text += '\n';
    });
    
    navigator.clipboard.writeText(text);
    alert('تم نسخ الملخص!');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg">
              <FileText className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                ملخص الملاحظات
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{bookTitle}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="p-2 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
              title="نسخ الملخص"
              disabled={!data}
            >
              <Copy className="w-4 h-4" />
            </button>
            
            <button
              onClick={fetchSynthesis}
              className="p-2 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
              title="إعادة التوليد"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto" dir="rtl">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
              <p className="text-gray-500 dark:text-gray-400">جارٍ تحليل الملاحظات وتوليد الملخص...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="text-red-500 text-center">
                <p className="font-medium">حدث خطأ</p>
                <p className="text-sm">{error}</p>
              </div>
              <button
                onClick={fetchSynthesis}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <div className="p-6 space-y-6">
              {/* Stats Bar */}
              <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {data.totalComments} تعليق
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {data.themes.length} محاور
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {data.sections.length} أقسام
                  </span>
                </div>
              </div>

              {/* Summary Section */}
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-5 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    الملخص العام
                  </h3>
                  {!editingSummary ? (
                    <button
                      onClick={() => setEditingSummary(true)}
                      className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800/50 text-amber-600 dark:text-amber-400"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={saveSummary}
                      className="p-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {editingSummary ? (
                  <textarea
                    value={editedSummary}
                    onChange={(e) => setEditedSummary(e.target.value)}
                    className="w-full p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 min-h-[150px] focus:ring-2 focus:ring-amber-500"
                    dir="rtl"
                  />
                ) : (
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {data.summary}
                  </p>
                )}
              </div>

              {/* Key Insights */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    الاستنتاجات الرئيسية
                  </h3>
                  <button
                    onClick={addInsight}
                    className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/50 text-blue-600 dark:text-blue-400"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                
                <ul className="space-y-3">
                  {data.keyInsights.map((insight, index) => (
                    <li key={index} className="flex items-start gap-3 group">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center mt-0.5">
                        {index + 1}
                      </span>
                      
                      {editingInsights === index ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            value={editedInsight}
                            onChange={(e) => setEditedInsight(e.target.value)}
                            className="flex-1 p-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                            dir="rtl"
                          />
                          <button
                            onClick={() => saveInsight(index)}
                            className="p-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-gray-700 dark:text-gray-300">{insight}</span>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingInsights(index);
                                setEditedInsight(insight);
                              }}
                              className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50 text-blue-600 dark:text-blue-400"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteInsight(index)}
                              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-800/50 text-red-600 dark:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Themes */}
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
                <h3 className="text-lg font-bold text-purple-800 dark:text-purple-300 flex items-center gap-2 mb-4">
                  <Layers className="w-5 h-5" />
                  المحاور الرئيسية
                </h3>
                
                <div className="space-y-3">
                  {data.themes.map((theme, index) => (
                    <div 
                      key={index}
                      className="bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-700 overflow-hidden"
                    >
                      <button
                        onClick={() => toggleTheme(theme.name)}
                        className="w-full p-3 flex items-center justify-between text-right hover:bg-purple-50 dark:hover:bg-purple-900/30"
                      >
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{theme.name}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400 mr-2">
                            ({theme.commentIds.length} تعليقات)
                          </span>
                        </div>
                        {expandedThemes.has(theme.name) ? (
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                      </button>
                      
                      {expandedThemes.has(theme.name) && (
                        <div className="p-3 border-t border-purple-100 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10">
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{theme.description}</p>
                          <div className="space-y-2">
                            {theme.commentIds.map(commentId => {
                              const comment = getCommentById(commentId);
                              if (!comment) return null;
                              return (
                                <div key={commentId} className="p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-sm">
                                  <div className="flex items-center gap-2 mb-1">
                                    <button
                                      onClick={() => onPageClick?.(comment.page_number)}
                                      className="text-xs px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200"
                                    >
                                      صفحة {comment.page_number}
                                    </button>
                                  </div>
                                  {comment.selected_text && (
                                    <p className="text-gray-500 dark:text-gray-500 text-xs mb-1 italic">
                                      &ldquo;{comment.selected_text}&rdquo;
                                    </p>
                                  )}
                                  <p className="text-gray-700 dark:text-gray-300">{comment.comment}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed Sections */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  الأقسام التفصيلية
                </h3>
                
                {data.sections.map((section) => (
                  <div 
                    key={section.id}
                    className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full p-4 flex items-center justify-between text-right hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-gray-800 dark:text-gray-200">{section.title}</span>
                        {section.pageReferences.length > 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            صفحات: {section.pageReferences.slice(0, 3).join(', ')}
                            {section.pageReferences.length > 3 && '...'}
                          </span>
                        )}
                      </div>
                      {expandedSections.has(section.id) ? (
                        <ChevronUp className="w-5 h-5 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-500" />
                      )}
                    </button>
                    
                    {expandedSections.has(section.id) && (
                      <div className="p-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-end mb-3">
                          {editingSectionId !== section.id ? (
                            <button
                              onClick={() => {
                                setEditingSectionId(section.id);
                                setEditedSectionTitle(section.title);
                                setEditedSectionContent(section.content);
                              }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => saveSection(section.id)}
                              className="p-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        
                        {editingSectionId === section.id ? (
                          <div className="space-y-3">
                            <input
                              value={editedSectionTitle}
                              onChange={(e) => setEditedSectionTitle(e.target.value)}
                              className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold"
                              placeholder="عنوان القسم"
                              dir="rtl"
                            />
                            <textarea
                              value={editedSectionContent}
                              onChange={(e) => setEditedSectionContent(e.target.value)}
                              className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 min-h-[120px]"
                              placeholder="محتوى القسم"
                              dir="rtl"
                            />
                          </div>
                        ) : (
                          <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                            {section.content}
                          </p>
                        )}
                        
                        {/* Related comments */}
                        {section.relatedComments.length > 0 && !editingSectionId && (
                          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                              التعليقات المرتبطة ({section.relatedComments.length})
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {section.pageReferences.map(page => (
                                <button
                                  key={page}
                                  onClick={() => onPageClick?.(page)}
                                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400"
                                >
                                  صفحة {page}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Raw Comments Toggle */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <button
                  onClick={() => setShowRawComments(!showRawComments)}
                  className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>عرض جميع التعليقات الأصلية ({data.totalComments})</span>
                  {showRawComments ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                
                {showRawComments && (
                  <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
                    {data.rawComments.map(comment => (
                      <div 
                        key={comment.id}
                        className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-700"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            onClick={() => onPageClick?.(comment.page_number)}
                            className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200"
                          >
                            صفحة {comment.page_number}
                          </button>
                          <span className="text-xs text-gray-400">
                            {new Date(comment.created_at).toLocaleDateString('ar')}
                          </span>
                        </div>
                        {comment.selected_text && (
                          <p className="text-sm text-gray-500 dark:text-gray-500 mb-1 italic border-r-2 border-gray-300 dark:border-gray-600 pr-2">
                            &ldquo;{comment.selected_text}&rdquo;
                          </p>
                        )}
                        <p className="text-gray-700 dark:text-gray-300">{comment.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 text-center text-sm text-gray-500 dark:text-gray-400">
            آخر تحديث: {new Date(data.generatedAt).toLocaleString('ar')}
          </div>
        )}
      </div>
    </div>
  );
}
