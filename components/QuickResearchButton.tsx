'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Microscope, Shield, List } from 'lucide-react';

interface QuickResearchButtonProps {
  onResearch: (mode: 'deeper' | 'verify' | 'list') => void;
  disabled?: boolean;
  compact?: boolean;
}

export default function QuickResearchButton({ 
  onResearch, 
  disabled = false,
  compact = false 
}: QuickResearchButtonProps) {
  const [showOptions, setShowOptions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowOptions(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (compact) {
    return (
      <div className="relative inline-block" ref={dropdownRef}>
        <button
          onClick={() => setShowOptions(!showOptions)}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Research deeper on this topic"
        >
          <Search size={12} />
          <span>More</span>
          <ChevronDown size={10} className={`transition-transform ${showOptions ? 'rotate-180' : ''}`} />
        </button>

        {showOptions && (
          <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
            <button
              onClick={() => { onResearch('deeper'); setShowOptions(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-purple-50 flex items-center gap-2 transition-colors"
            >
              <Microscope size={14} className="text-purple-600" />
              <div>
                <div className="font-medium text-slate-700">Search Deeper</div>
                <div className="text-slate-500">Multi-hop reasoning</div>
              </div>
            </button>
            <button
              onClick={() => { onResearch('verify'); setShowOptions(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-indigo-50 flex items-center gap-2 transition-colors border-t border-slate-100"
            >
              <Shield size={14} className="text-indigo-600" />
              <div>
                <div className="font-medium text-slate-700">Verify (Pro/Con)</div>
                <div className="text-slate-500">Find opposing evidence</div>
              </div>
            </button>
            <button
              onClick={() => { onResearch('list'); setShowOptions(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-teal-50 flex items-center gap-2 transition-colors border-t border-slate-100"
            >
              <List size={14} className="text-teal-600" />
              <div>
                <div className="font-medium text-slate-700">List All Matches</div>
                <div className="text-slate-500">Every occurrence found</div>
              </div>
            </button>
          </div>
        )}
      </div>
    );
  }

  // Full-size version
  return (
    <div className="flex gap-2 mt-2">
      <button
        onClick={() => onResearch('deeper')}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Search deeper using multi-hop reasoning"
      >
        <Microscope size={14} />
        Search Deeper
      </button>
      <button
        onClick={() => onResearch('verify')}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Find both supporting and opposing evidence"
      >
        <Shield size={14} />
        Verify
      </button>
      <button
        onClick={() => onResearch('list')}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-100 text-teal-700 hover:bg-teal-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="List all occurrences without summarizing"
      >
        <List size={14} />
        List All
      </button>
    </div>
  );
}
