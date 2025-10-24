'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import CorpusManager from '@/components/CorpusManager';
import PromptLibrary from '@/components/PromptLibrary';
import ChatPanel from '@/components/ChatPanel';
import HistoryPanel from '@/components/HistoryPanel';
import { Book, MessageSquare, Clock, Sparkles, FileText, Loader2 } from 'lucide-react';

// ✅ Dynamic import with SSR disabled to prevent DOMMatrix error
const ReaderMode = dynamic(() => import('@/components/ReaderMode'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="animate-spin text-emerald-600" size={48} />
    </div>
  )
});

type ViewMode = 'reader' | 'prompts' | 'chat' | 'history';

export default function Home() {
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<ViewMode>('reader');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const views = [
    { id: 'reader', label: 'Reader', icon: Book },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare },
    { id: 'prompts', label: 'Prompts', icon: Sparkles },
    { id: 'history', label: 'History', icon: Clock },
  ] as const;

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Left Sidebar - Corpus Manager (Only show for Chat view) */}
      {currentView === 'chat' && (
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

          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border border-slate-300 rounded-r-lg p-2 shadow-lg hover:bg-slate-50 transition-colors"
            style={{ left: sidebarCollapsed ? '0' : '320px' }}
          >
            <FileText size={20} className="text-slate-600" />
          </button>
        </>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation Bar */}
        <div className="border-b border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4">
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Book className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Islamic Research Assistant</h1>
                <p className="text-xs text-slate-500">AI-Powered Arabic & Islamic Studies</p>
              </div>
            </div>

            {/* View Tabs */}
            <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
              {views.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setCurrentView(id as ViewMode)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                    currentView === id
                      ? 'bg-white text-emerald-600 shadow-md'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Corpus Status (Only show for Chat view) */}
            {currentView === 'chat' && (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-emerald-700">
                  {selectedDocuments.length} {selectedDocuments.length === 1 ? 'book' : 'books'} selected
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {currentView === 'reader' && (
            <ReaderMode />
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
        </div>
      </div>
    </div>
  );
}