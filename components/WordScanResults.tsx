'use client';

import { useState } from 'react';
import { Search, FileText, ChevronDown, ChevronUp, Download, X, ExternalLink } from 'lucide-react';

interface WordOccurrence {
  before: string;
  match: string;
  after: string;
}

interface PageResult {
  pageNumber: number;
  documentName: string;
  documentId: string;
  occurrenceCount: number;
  excerpts: WordOccurrence[];
}

interface WordScanResponse {
  word: string;
  totalOccurrences: number;
  totalPages: number;
  totalDocuments: number;
  results: PageResult[];
}

interface WordScanResultsProps {
  data: WordScanResponse;
  onClose: () => void;
  onGoToPage?: (pageNumber: number, documentId: string) => void;
  isArabic?: boolean;
}

export default function WordScanResults({ 
  data, 
  onClose, 
  onGoToPage,
  isArabic = true 
}: WordScanResultsProps) {
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  
  const INITIAL_DISPLAY = 10;
  const displayedResults = showAll ? data.results : data.results.slice(0, INITIAL_DISPLAY);
  
  const togglePage = (pageKey: string) => {
    const newExpanded = new Set(expandedPages);
    if (newExpanded.has(pageKey)) {
      newExpanded.delete(pageKey);
    } else {
      newExpanded.add(pageKey);
    }
    setExpandedPages(newExpanded);
  };
  
  const exportToCSV = () => {
    const rows = [
      ['Page', 'Document', 'Occurrences', 'Context']
    ];
    
    for (const result of data.results) {
      for (const excerpt of result.excerpts) {
        rows.push([
          String(result.pageNumber),
          result.documentName,
          String(result.occurrenceCount),
          `${excerpt.before} [${excerpt.match}] ${excerpt.after}`
        ]);
      }
    }
    
    const csvContent = rows.map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `word-scan-${data.word}-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  if (data.totalOccurrences === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-700">
            <Search className="w-5 h-5" />
            <span>
              {isArabic 
                ? `لم يتم العثور على "${data.word}" في المستندات المحددة`
                : `No occurrences of "${data.word}" found in selected documents`
              }
            </span>
          </div>
          <button onClick={onClose} className="text-amber-600 hover:text-amber-800">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white border border-blue-200 rounded-lg shadow-lg my-3 overflow-hidden" dir={isArabic ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">
                {isArabic ? 'نتائج البحث عن:' : 'Word Scan Results:'} &quot;{data.word}&quot;
              </h3>
              <p className="text-blue-100 text-sm">
                {isArabic 
                  ? `${data.totalOccurrences} حالة في ${data.totalPages} صفحة من ${data.totalDocuments} مستند`
                  : `${data.totalOccurrences} occurrences across ${data.totalPages} pages in ${data.totalDocuments} document(s)`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition-colors"
              title={isArabic ? 'تصدير CSV' : 'Export CSV'}
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Results List */}
      <div className="max-h-[60vh] overflow-y-auto">
        {displayedResults.map((result, index) => {
          const pageKey = `${result.documentId}-${result.pageNumber}`;
          const isExpanded = expandedPages.has(pageKey);
          
          return (
            <div key={pageKey} className={`border-b border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
              {/* Page Header */}
              <button
                onClick={() => togglePage(pageKey)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span className="font-medium text-slate-800">
                      {isArabic ? 'ص.' : 'p.'} {result.pageNumber}
                    </span>
                  </div>
                  <span className="text-slate-500 text-sm truncate max-w-[200px]">
                    {result.documentName}
                  </span>
                  <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                    {result.occurrenceCount} {isArabic ? 'حالة' : 'hits'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {onGoToPage && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onGoToPage(result.pageNumber, result.documentId);
                      }}
                      className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded"
                      title={isArabic ? 'اذهب للصفحة' : 'Go to page'}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </button>
              
              {/* Excerpts */}
              {isExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  {result.excerpts.map((excerpt, i) => (
                    <div 
                      key={i} 
                      className="bg-slate-100 rounded-lg px-3 py-2 text-sm font-arabic leading-relaxed"
                    >
                      <span className="text-slate-600">{excerpt.before}</span>
                      <span className="bg-yellow-200 text-yellow-900 px-1 rounded font-bold mx-1">
                        {excerpt.match}
                      </span>
                      <span className="text-slate-600">{excerpt.after}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Show More / Show Less */}
      {data.results.length > INITIAL_DISPLAY && (
        <div className="p-3 bg-slate-50 border-t border-slate-200">
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full py-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            {showAll 
              ? (isArabic ? `عرض أقل` : 'Show Less')
              : (isArabic 
                  ? `عرض جميع الصفحات (${data.results.length - INITIAL_DISPLAY} أخرى)`
                  : `Show All Pages (${data.results.length - INITIAL_DISPLAY} more)`
                )
            }
          </button>
        </div>
      )}
      
      {/* Footer Stats */}
      <div className="px-4 py-2 bg-slate-100 text-xs text-slate-500 flex items-center justify-between">
        <span>
          {isArabic 
            ? `إجمالي: ${data.totalOccurrences} حالة`
            : `Total: ${data.totalOccurrences} occurrences`
          }
        </span>
        <span>
          {isArabic 
            ? `${data.totalPages} صفحة • ${data.totalDocuments} مستند`
            : `${data.totalPages} pages • ${data.totalDocuments} documents`
          }
        </span>
      </div>
    </div>
  );
}
