'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Plus, Edit2, Trash2, Copy, Star } from 'lucide-react';

interface Prompt {
  id: string;
  name: string;
  template: string;
  category: string;
  is_custom: number;
  created_at: string;
  modified_at: string | null;
}

export default function PromptLibrary() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    template: '',
    category: 'analysis'
  });

  useEffect(() => {
    fetchPrompts();
  }, []);

  async function fetchPrompts() {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch (error) {
      console.error('Error fetching prompts:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      const endpoint = '/api/prompts';
      const method = editingPrompt ? 'PUT' : 'POST';
      
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingPrompt?.id,
          ...formData,
          isCustom: true
        }),
      });

      if (res.ok) {
        await fetchPrompts();
        resetForm();
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      alert('Failed to save prompt');
    }
  }

  async function handleDelete(id: string, isSystemPrompt: boolean) {
    const message = isSystemPrompt 
      ? 'Delete this system prompt? Your changes will be preserved.'
      : 'Delete this custom prompt?';
    
    if (!confirm(message)) return;
    
    try {
      await fetch(`/api/prompts?id=${id}`, { method: 'DELETE' });
      await fetchPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
    }
  }

  async function handleClearOldPrompts() {
    if (!confirm('Delete ALL old system prompts? This will remove Compare Sources, Explain Concept, Find References, and Summarize. The new 5 research prompts will remain.')) {
      return;
    }

    try {
      const oldPromptIds = [
        'compare-sources',
        'explain-concept', 
        'find-references',
        'summarize'
      ];

      for (const id of oldPromptIds) {
        await fetch(`/api/prompts?id=${id}`, { method: 'DELETE' });
      }

      await fetchPrompts();
      alert('Old prompts removed successfully!');
    } catch (error) {
      console.error('Error clearing old prompts:', error);
      alert('Failed to clear old prompts');
    }
  }

  function resetForm() {
    setFormData({ name: '', template: '', category: 'analysis' });
    setShowAddDialog(false);
    setEditingPrompt(null);
  }

  const categories = ['analysis', 'translation', 'education', 'summary', 'comparison', 'general'];
  const groupedPrompts = categories.map(cat => ({
    category: cat,
    prompts: prompts.filter(p => p.category === cat)
  })).filter(g => g.prompts.length > 0);

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header */}
      <div className="flex-shrink-0 p-6 border-b bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="text-emerald-600" />
            Prompt Library
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handleClearOldPrompts}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm"
            >
              Clear Old Prompts
            </button>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Plus size={18} />
              Create Prompt
            </button>
          </div>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>💡 System Prompts:</strong> Predefined research templates that update automatically.
            You can edit or delete them, and your changes will be preserved.
          </p>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {loading ? (
            <div className="text-center py-12">Loading prompts...</div>
          ) : prompts.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No prompts yet. Create your first prompt!
            </div>
          ) : (
            <div className="space-y-6 max-w-6xl mx-auto">
              {groupedPrompts.map(group => (
                <div key={group.category}>
                  <h3 className="text-lg font-semibold mb-3 capitalize text-slate-700">
                    {group.category}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {group.prompts.map(prompt => {
                      const isSystemPrompt = prompt.is_custom === 0;
                      const isModified = prompt.modified_at !== null;
                      
                      return (
                        <div
                          key={prompt.id}
                          className={`p-4 border rounded-lg transition-colors ${
                            isSystemPrompt && !isModified
                              ? 'border-emerald-300 bg-emerald-50/50'
                              : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                                <span className="truncate">{prompt.name}</span>
                                {isSystemPrompt && !isModified && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full flex-shrink-0">
                                    <Star size={12} />
                                    System
                                  </span>
                                )}
                                {isModified && (
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full flex-shrink-0">
                                    Modified
                                  </span>
                                )}
                              </h4>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 ml-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(prompt.template);
                                  alert('Prompt template copied!');
                                }}
                                className="p-1 hover:bg-emerald-100 rounded transition-colors"
                                title="Copy template"
                              >
                                <Copy size={16} className="text-slate-600" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingPrompt(prompt);
                                  setFormData({
                                    name: prompt.name,
                                    template: prompt.template,
                                    category: prompt.category
                                  });
                                  setShowAddDialog(true);
                                }}
                                className="p-1 hover:bg-blue-100 rounded transition-colors"
                                title="Edit prompt"
                              >
                                <Edit2 size={16} className="text-blue-600" />
                              </button>
                              <button
                                onClick={() => handleDelete(prompt.id, isSystemPrompt)}
                                className="p-1 hover:bg-red-100 rounded transition-colors"
                                title="Delete prompt"
                              >
                                <Trash2 size={16} className="text-red-600" />
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-600 line-clamp-3">{prompt.template}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex-shrink-0">
              <h3 className="text-xl font-bold">
                {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
              </h3>
              {editingPrompt && editingPrompt.is_custom === 0 && !editingPrompt.modified_at && (
                <p className="text-sm text-amber-600 mt-2">
                  ⚠️ Editing a system prompt. Your changes will be preserved even after updates.
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Prompt Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g., Deep Character Analysis"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Prompt Template</label>
                <textarea
                  value={formData.template}
                  onChange={(e) => setFormData({ ...formData, template: e.target.value })}
                  rows={12}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                  placeholder="Enter your prompt template here..."
                />
                <p className="text-xs text-slate-500 mt-1">
                  Tip: Use clear instructions. This will be added to your queries.
                </p>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3 flex-shrink-0 bg-white">
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name || !formData.template}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {editingPrompt ? 'Save Changes' : 'Create Prompt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}