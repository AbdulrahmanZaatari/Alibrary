'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Search, Download, BarChart3, Cloud, List, Loader2, BookOpen, RefreshCw, Filter } from 'lucide-react';

interface CategorizedTerm {
  term: string;
  count: number;
  pages: number[];
  category: 'concept' | 'name' | 'technical' | 'place' | 'other';
  categoryAr: string;
  importance: 'high' | 'medium' | 'low';
}

interface TerminologyData {
  documentNames: string[];
  totalTerms: number;
  totalChunks: number;
  terms: CategorizedTerm[];
  categories: {
    concepts: CategorizedTerm[];
    names: CategorizedTerm[];
    technical: CategorizedTerm[];
    places: CategorizedTerm[];
    other: CategorizedTerm[];
  };
  stats: {
    conceptCount: number;
    nameCount: number;
    technicalCount: number;
    placeCount: number;
    otherCount: number;
  };
}

interface TerminologyAnalysisProps {
  isOpen: boolean;
  onClose: () => void;
  documentIds: string[];
  bookId?: string;
  bookTitle?: string;
  onTermClick?: (term: string) => void;
  onPageClick?: (pageNumber: number) => void;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  concept: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700' },
  name: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', border: 'border-green-300 dark:border-green-700' },
  technical: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-700' },
  place: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' },
  other: { bg: 'bg-gray-100 dark:bg-gray-700/30', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-600' }
};

const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  concept: { en: 'Concepts', ar: 'مفاهيم' },
  name: { en: 'Names', ar: 'أعلام' },
  technical: { en: 'Technical Terms', ar: 'مصطلحات فنية' },
  place: { en: 'Places', ar: 'أماكن' },
  other: { en: 'Other', ar: 'أخرى' }
};

export default function TerminologyAnalysis({
  isOpen,
  onClose,
  documentIds,
  bookId,
  bookTitle,
  onTermClick,
  onPageClick
}: TerminologyAnalysisProps) {
  const [data, setData] = useState<TerminologyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cloud' | 'list' | 'chart'>('cloud');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<CategorizedTerm | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const fetchTerminology = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/terminology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentIds: documentIds.length > 0 ? documentIds : undefined,
          bookId,
          forceRefresh
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze terminology');
      }
      
      const result = await response.json();
      setData(result);
      setFromCache(result.fromCache || false);
      setCachedAt(result.cachedAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [documentIds, bookId]);

  const handleRefresh = () => {
    fetchTerminology(true);
  };

  useEffect(() => {
    if (isOpen && !data && !loading) {
      fetchTerminology(false);
    }
  }, [isOpen, data, loading, fetchTerminology]);

  // Filter terms based on search and category
  const filteredTerms = useMemo(() => {
    if (!data) return [];
    
    let terms = data.terms;
    
    if (selectedCategory) {
      terms = terms.filter(t => t.category === selectedCategory);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      terms = terms.filter(t => t.term.toLowerCase().includes(query));
    }
    
    return terms;
  }, [data, selectedCategory, searchQuery]);

  // Calculate font size for word cloud
  const getFontSize = (count: number, maxCount: number): number => {
    const minSize = 14;
    const maxSize = 48;
    const ratio = count / maxCount;
    return minSize + (maxSize - minSize) * Math.sqrt(ratio);
  };

  const handleTermClick = (term: CategorizedTerm) => {
    setSelectedTerm(term);
  };

  const handleExportCSV = () => {
    if (!data) return;
    
    const headers = ['المصطلح,التكرار,الفئة,الأهمية,الصفحات'];
    const rows = data.terms.map(t => 
      `"${t.term}",${t.count},"${t.categoryAr}","${t.importance}","${t.pages.slice(0, 10).join(', ')}${t.pages.length > 10 ? '...' : ''}"`
    );
    
    const csv = headers.concat(rows).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `terminology-${bookTitle || 'analysis'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-blue-500" />
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                تحليل المصطلحات
              </h2>
              {bookTitle && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{bookTitle}</p>
              )}
              {fromCache && cachedAt && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  📦 من الذاكرة المؤقتة ({new Date(cachedAt).toLocaleDateString('ar')})
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
              title="إعادة التحليل"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
              <button
                onClick={() => setViewMode('cloud')}
                className={`p-2 ${viewMode === 'cloud' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
                title="سحابة الكلمات"
              >
                <Cloud className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
                title="قائمة"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('chart')}
                className={`p-2 ${viewMode === 'chart' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
                title="إحصائيات"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </div>
            
            <button
              onClick={handleExportCSV}
              className="p-2 rounded-lg bg-green-500 hover:bg-green-600 text-white"
              title="تصدير CSV"
              disabled={!data}
            >
              <Download className="w-4 h-4" />
            </button>
            
            <button
              onClick={() => fetchTerminology()}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
              title="تحديث"
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

        {/* Search and Filters */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث في المصطلحات..."
              className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
          </div>
          
          {/* Category Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400" />
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                !selectedCategory 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              الكل
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, labels]) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(key === selectedCategory ? null : key)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  selectedCategory === key
                    ? `${CATEGORY_COLORS[key].bg} ${CATEGORY_COLORS[key].text} border ${CATEGORY_COLORS[key].border}`
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {labels.ar}
                {data && (
                  <span className="mr-1 opacity-70">
                    ({data.stats[`${key}Count` as keyof typeof data.stats] || 0})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <p className="text-gray-500 dark:text-gray-400">جارٍ تحليل المصطلحات...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="text-red-500 text-center">
                <p className="font-medium">حدث خطأ</p>
                <p className="text-sm">{error}</p>
              </div>
              <button
                onClick={() => fetchTerminology()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Word Cloud View */}
              {viewMode === 'cloud' && (
                <div 
                  className="flex flex-wrap gap-3 justify-center items-center p-8 min-h-[400px]"
                  dir="rtl"
                >
                  {filteredTerms.map((term, index) => {
                    const maxCount = filteredTerms[0]?.count || 1;
                    const fontSize = getFontSize(term.count, maxCount);
                    const colors = CATEGORY_COLORS[term.category];
                    
                    return (
                      <button
                        key={`${term.term}-${index}`}
                        onClick={() => handleTermClick(term)}
                        className={`
                          px-3 py-1 rounded-lg transition-all hover:scale-110 hover:shadow-lg cursor-pointer
                          ${colors.bg} ${colors.text} border ${colors.border}
                          ${term.importance === 'high' ? 'font-bold' : term.importance === 'medium' ? 'font-medium' : ''}
                        `}
                        style={{ fontSize: `${fontSize}px` }}
                        title={`${term.term}: ${term.count} مرة`}
                      >
                        {term.term}
                      </button>
                    );
                  })}
                  
                  {filteredTerms.length === 0 && (
                    <p className="text-gray-500 dark:text-gray-400">لم يتم العثور على مصطلحات</p>
                  )}
                </div>
              )}

              {/* List View */}
              {viewMode === 'list' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-right" dir="rtl">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">المصطلح</th>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">التكرار</th>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">الفئة</th>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">الأهمية</th>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">الصفحات</th>
                        <th className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {filteredTerms.map((term, index) => {
                        const colors = CATEGORY_COLORS[term.category];
                        return (
                          <tr 
                            key={`${term.term}-${index}`} 
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                            onClick={() => handleTermClick(term)}
                          >
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                              {term.term}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                                {term.count}×
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                                {term.categoryAr}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                                term.importance === 'high' 
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  : term.importance === 'medium'
                                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                              }`}>
                                {term.importance === 'high' ? 'عالية' : term.importance === 'medium' ? 'متوسطة' : 'منخفضة'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                              {term.pages.slice(0, 5).map((p, i) => (
                                <button
                                  key={i}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onPageClick?.(p);
                                  }}
                                  className="inline-block ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-600 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
                                >
                                  {p}
                                </button>
                              ))}
                              {term.pages.length > 5 && (
                                <span className="text-xs text-gray-400">+{term.pages.length - 5}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTermClick?.(term.term);
                                }}
                                className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                              >
                                بحث
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Chart View */}
              {viewMode === 'chart' && data && (
                <div className="space-y-6" dir="rtl">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {Object.entries(CATEGORY_LABELS).map(([key, labels]) => {
                      const count = data.stats[`${key}Count` as keyof typeof data.stats] || 0;
                      const colors = CATEGORY_COLORS[key];
                      const percentage = data.totalTerms > 0 ? Math.round((count / data.totalTerms) * 100) : 0;
                      
                      return (
                        <div 
                          key={key}
                          className={`p-4 rounded-xl border ${colors.border} ${colors.bg}`}
                        >
                          <p className={`text-sm ${colors.text} opacity-80`}>{labels.ar}</p>
                          <p className={`text-3xl font-bold ${colors.text}`}>{count}</p>
                          <p className={`text-sm ${colors.text} opacity-70`}>{percentage}%</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bar Chart - Top 20 Terms */}
                  <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                      أكثر 20 مصطلحاً تكراراً
                    </h3>
                    <div className="space-y-2">
                      {data.terms.slice(0, 20).map((term, index) => {
                        const maxCount = data.terms[0]?.count || 1;
                        const percentage = (term.count / maxCount) * 100;
                        const colors = CATEGORY_COLORS[term.category];
                        
                        return (
                          <div key={`${term.term}-${index}`} className="flex items-center gap-3">
                            <span className="w-24 text-sm text-gray-600 dark:text-gray-400 truncate text-left">
                              {term.count}×
                            </span>
                            <div className="flex-1 h-8 bg-gray-200 dark:bg-gray-600 rounded-lg overflow-hidden">
                              <div 
                                className={`h-full ${colors.bg} flex items-center justify-end px-2 transition-all duration-500`}
                                style={{ width: `${percentage}%` }}
                              >
                                <span className={`text-sm font-medium ${colors.text} truncate`}>
                                  {term.term}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Category Distribution Pie-like display */}
                  <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                      توزيع الفئات
                    </h3>
                    <div className="flex h-8 rounded-lg overflow-hidden">
                      {Object.entries(data.stats).map(([key, value]) => {
                        if (value === 0) return null;
                        const categoryKey = key.replace('Count', '');
                        const colors = CATEGORY_COLORS[categoryKey] || CATEGORY_COLORS.other;
                        const percentage = (value / data.totalTerms) * 100;
                        
                        return (
                          <div 
                            key={key}
                            className={`${colors.bg} flex items-center justify-center transition-all`}
                            style={{ width: `${percentage}%` }}
                            title={`${CATEGORY_LABELS[categoryKey]?.ar || categoryKey}: ${value} (${Math.round(percentage)}%)`}
                          >
                            {percentage > 10 && (
                              <span className={`text-xs font-medium ${colors.text}`}>
                                {Math.round(percentage)}%
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4">
                      {Object.entries(CATEGORY_LABELS).map(([key, labels]) => {
                        const colors = CATEGORY_COLORS[key];
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${colors.bg} border ${colors.border}`} />
                            <span className="text-sm text-gray-600 dark:text-gray-400">{labels.ar}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Term Detail Modal */}
        {selectedTerm && (
          <div className="fixed inset-0 bg-black/30 z-60 flex items-center justify-center p-4" onClick={() => setSelectedTerm(null)}>
            <div 
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6"
              onClick={e => e.stopPropagation()}
              dir="rtl"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{selectedTerm.term}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_COLORS[selectedTerm.category].bg} ${CATEGORY_COLORS[selectedTerm.category].text}`}>
                      {selectedTerm.categoryAr}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {selectedTerm.count} تكرار
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelectedTerm(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">يظهر في الصفحات:</p>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {selectedTerm.pages.map((page, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onPageClick?.(page);
                        setSelectedTerm(null);
                      }}
                      className="px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {page}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onTermClick?.(selectedTerm.term);
                    setSelectedTerm(null);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  بحث عن جميع الاستخدامات
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {data && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 text-center text-sm text-gray-500 dark:text-gray-400">
            تم تحليل {data.totalChunks} مقطع • {data.totalTerms} مصطلح مهم
          </div>
        )}
      </div>
    </div>
  );
}
