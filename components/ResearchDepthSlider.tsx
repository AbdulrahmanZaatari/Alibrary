'use client';

import { Zap, BookOpen, Microscope, Search, Shield, List } from 'lucide-react';

export type ResearchDepth = 1 | 2 | 3 | 4;

export interface ResearchModeSettings {
  depth: ResearchDepth;
  verificationMode: boolean;
  listOutput: boolean;
}

// Depth configuration mapping for backend compatibility
export const DEPTH_CONFIGS: Record<ResearchDepth, {
  name: string;
  nameAr: string;
  description: string;
  useReranking: boolean;
  useKeywordSearch: boolean;
  enableMultiHop: boolean;
  enableMultiPass: boolean;
  maxChunks: number;
  icon: string;
}> = {
  1: {
    name: 'Quick',
    nameAr: 'سريع',
    description: 'Fast answers',
    useReranking: false,
    useKeywordSearch: false,
    enableMultiHop: false,
    enableMultiPass: false,
    maxChunks: 8,
    icon: '⚡'
  },
  2: {
    name: 'Standard',
    nameAr: 'عادي',
    description: 'Balanced search',
    useReranking: true,
    useKeywordSearch: false,
    enableMultiHop: false,
    enableMultiPass: false,
    maxChunks: 15,
    icon: '📚'
  },
  3: {
    name: 'Deep',
    nameAr: 'عميق',
    description: 'Multi-hop reasoning',
    useReranking: true,
    useKeywordSearch: false,
    enableMultiHop: true,
    enableMultiPass: false,
    maxChunks: 25,
    icon: '🔬'
  },
  4: {
    name: 'Exhaustive',
    nameAr: 'شامل',
    description: 'All occurrences',
    useReranking: false,
    useKeywordSearch: true,
    enableMultiHop: false,
    enableMultiPass: true,
    maxChunks: 100,
    icon: '🔍'
  }
};

interface ResearchDepthSliderProps {
  depth: ResearchDepth;
  onDepthChange: (depth: ResearchDepth) => void;
  verificationMode: boolean;
  onVerificationChange: (enabled: boolean) => void;
  listOutput: boolean;
  onListOutputChange: (enabled: boolean) => void;
  compact?: boolean;
}

const DEPTH_INFO: Record<ResearchDepth, {
  icon: typeof Zap;
  name: string;
  nameAr: string;
  colorClass: string;
  bgClass: string;
  description: string;
}> = {
  1: { 
    icon: Zap, 
    name: 'Quick', 
    nameAr: 'سريع', 
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-100',
    description: 'Fast answers' 
  },
  2: { 
    icon: BookOpen, 
    name: 'Standard', 
    nameAr: 'عادي', 
    colorClass: 'text-blue-600',
    bgClass: 'bg-blue-100',
    description: 'Balanced' 
  },
  3: { 
    icon: Microscope, 
    name: 'Deep', 
    nameAr: 'عميق', 
    colorClass: 'text-purple-600',
    bgClass: 'bg-purple-100',
    description: 'Multi-hop' 
  },
  4: { 
    icon: Search, 
    name: 'Exhaustive', 
    nameAr: 'شامل', 
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-100',
    description: 'All matches' 
  },
};

export default function ResearchDepthSlider({
  depth,
  onDepthChange,
  verificationMode,
  onVerificationChange,
  listOutput,
  onListOutputChange,
  compact = false
}: ResearchDepthSliderProps) {
  const currentDepth = DEPTH_INFO[depth];
  const IconComponent = currentDepth.icon;

  return (
    <div className={`space-y-3 ${compact ? 'p-2' : 'p-3'} bg-slate-50 rounded-lg border border-slate-200`}>
      {/* Depth Slider */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <IconComponent size={16} className={currentDepth.colorClass} />
            <span className="text-sm font-medium text-slate-700">
              Research Depth: <span className={currentDepth.colorClass}>{currentDepth.name}</span>
            </span>
          </div>
          <span className="text-xs text-slate-500">{currentDepth.description}</span>
        </div>
        
        {/* Slider Track */}
        <div className="relative pt-1">
          <input
            type="range"
            min="1"
            max="4"
            value={depth}
            onChange={(e) => onDepthChange(parseInt(e.target.value) as ResearchDepth)}
            className="w-full h-2 bg-gradient-to-r from-emerald-400 via-blue-400 via-purple-400 to-amber-400 rounded-lg appearance-none cursor-pointer"
            style={{
              WebkitAppearance: 'none',
            }}
          />
          {/* Labels */}
          <div className="flex justify-between mt-1 px-0.5">
            {([1, 2, 3, 4] as ResearchDepth[]).map((d) => (
              <button
                key={d}
                onClick={() => onDepthChange(d)}
                className={`text-xs transition-all px-1 ${
                  depth === d 
                    ? `font-bold ${DEPTH_INFO[d].colorClass}` 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                title={DEPTH_INFO[d].description}
              >
                {DEPTH_CONFIGS[d].icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mode Toggles - Horizontal compact buttons */}
      <div className="flex gap-2">
        {/* Verification Mode */}
        <button
          onClick={() => onVerificationChange(!verificationMode)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            verificationMode
              ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-300'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200'
          }`}
          title="Search for both supporting and contradicting evidence"
        >
          <Shield size={14} />
          <span>Verify</span>
        </button>

        {/* List Output Mode */}
        <button
          onClick={() => onListOutputChange(!listOutput)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            listOutput
              ? 'bg-teal-100 text-teal-700 border-2 border-teal-300'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-200'
          }`}
          title="Output as organized list instead of summary"
        >
          <List size={14} />
          <span>List</span>
        </button>
      </div>

      {/* Active modes indicator */}
      {(verificationMode || listOutput || depth === 4) && (
        <div className="flex flex-wrap gap-1">
          {depth === 4 && (
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
              📋 All occurrences
            </span>
          )}
          {verificationMode && (
            <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
              ⚖️ Pro/Con analysis
            </span>
          )}
          {listOutput && (
            <span className="text-xs px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">
              📝 List format
            </span>
          )}
        </div>
      )}
    </div>
  );
}
