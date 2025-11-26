'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import CorpusManager from '@/components/CorpusManager';
import PromptLibrary from '@/components/PromptLibrary';
import ChatPanel from '@/components/ChatPanel';
import HistoryPanel from '@/components/HistoryPanel';
import MetadataManager from '@/components/MetaDataManager';
import ReaderMode from '@/components/ReaderMode'; // ✅ ADD THIS
import { Book, MessageSquare, Clock, Sparkles, FileText, Database, Loader2, Menu, X, LogOut } from 'lucide-react';

const MobileReaderMode = dynamic(() => import('@/components/MobileReaderMode'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
      <div className="text-white text-center">
        <Loader2 className="animate-spin mx-auto mb-4" size={48} />
        <p>Loading reader...</p>
      </div>
    </div>
  )
});

type ViewMode = 'reader' | 'chat' | 'prompts' | 'history' | 'metadata';

export default function Home() {
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<ViewMode>('reader');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showMobileReader, setShowMobileReader] = useState(false);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarCollapsed(true);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const views = [
    { id: 'reader', label: 'Reader', icon: Book },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare },
    { id: 'prompts', label: 'Prompts', icon: Sparkles },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'metadata', label: 'Metadata', icon: Database },
  ];

  // If mobile reader is active
  if (showMobileReader && isMobile) {
    return (
      <MobileReaderMode
        onClose={() => {
          setShowMobileReader(false);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Left Sidebar - Corpus Manager (Only show for Chat view) */}
      {currentView === 'chat' && !isMobile && (
        <>
          <div 
            className={`transition-all duration-300 ease-in-out border-r border-slate-200 bg-white shadow-xl ${
              sidebarCollapsed ? 'w-0' : 'w-80'
            }`}
          >
            {!sidebarCollapsed && (
              <div className="h-full overflow-y-auto">
                <CorpusManager 
                  selectedDocuments={selectedDocuments}
                  onSelectionChange={setSelectedDocuments}
                />
              </div>
            )}
          </div>

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border border-slate-300 rounded-r-lg p-2 shadow-lg hover:bg-slate-50 transition-colors"
            style={{ left: sidebarCollapsed ? '0' : '320px' }}
          >
            <FileText size={20} className="text-slate-600" />
          </button>
        </>
      )}

      {/* Mobile Sidebar Overlay */}
      {currentView === 'chat' && isMobile && mobileMenuOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 w-80 bg-white z-50 shadow-2xl overflow-y-auto slide-in-right">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-lg">Corpus Manager</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <CorpusManager 
              selectedDocuments={selectedDocuments}
              onSelectionChange={setSelectedDocuments}
            />
          </div>
        </>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation Bar */}
        <div className="border-b border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-2 sm:gap-3">
              {currentView === 'chat' && isMobile && (
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="p-2 hover:bg-gray-100 rounded-lg lg:hidden"
                >
                  <Menu size={20} />
                </button>
              )}
              
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Book className="text-white" size={isMobile ? 18 : 24} />
              </div>
              <div>
                <h1 className="text-sm sm:text-xl font-bold text-slate-800">Islamic Research Assistant</h1>
                <p className="text-xs text-slate-500 hidden sm:block">AI-Powered Arabic & Islamic Studies</p>
              </div>
            </div>

            <div className="flex gap-1 sm:gap-2 bg-slate-100 p-1 rounded-xl overflow-x-auto max-w-[50vw] sm:max-w-none">
              {views.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setCurrentView(id as ViewMode)}
                  className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg font-medium transition-all duration-200 whitespace-nowrap ${
                    currentView === id
                      ? 'bg-white text-emerald-600 shadow-md'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Icon size={16} />
                  <span className="text-xs sm:text-base">{isMobile ? '' : label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {currentView === 'chat' && !isMobile && (
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-emerald-700">
                    {selectedDocuments.length} {selectedDocuments.length === 1 ? 'book' : 'books'}
                  </span>
                </div>
              )}
              
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut size={18} />
                {!isMobile && <span>Logout</span>}
              </button>
            </div>
          </div>

          {currentView === 'chat' && isMobile && (
            <div className="px-3 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-xs font-medium text-emerald-700">
                  {selectedDocuments.length} selected
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="text-xs text-emerald-600 font-medium"
              >
                Manage Corpus →
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {/* ✅ DESKTOP READER: Render ReaderMode */}
          {currentView === 'reader' && !isMobile && (
            <ReaderMode />
          )}

          {/* ✅ MOBILE READER: Button to open MobileReaderMode */}
          {currentView === 'reader' && isMobile && (
            <div className="h-full p-4">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-xl font-bold mb-4">📱 Mobile Reader</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Select a book to open the mobile-optimized reader with swipe navigation
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setShowMobileReader(true);
                    }}
                    className="w-full p-4 bg-white rounded-xl border border-gray-200 hover:border-emerald-500 transition-colors text-left"
                  >
                    <div className="font-semibold">Open Book Reader</div>
                    <div className="text-sm text-gray-500 mt-1">Tap to open mobile reader with your library</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentView === 'chat' && (
            <ChatPanel selectedDocuments={selectedDocuments} />
          )}
          {currentView === 'prompts' && (
            <PromptLibrary />
          )}
          {currentView === 'history' && (
            <HistoryPanel />
          )}
          {currentView === 'metadata' && (
            <MetadataManager />
          )}
        </div>
      </div>
    </div>
  );
}