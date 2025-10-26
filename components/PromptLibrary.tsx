'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Plus, Edit2, Trash2, Copy } from 'lucide-react';

interface Prompt {
  id: string;
  name: string;
  template: string;
  category: string;
  is_custom: number;
  created_at: string;
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
      const endpoint = editingPrompt ? '/api/prompts' : '/api/prompts';
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this custom prompt?')) return;
    
    try {
      await fetch(`/api/prompts?id=${id}`, { method: 'DELETE' });
      await fetchPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="text-emerald-600" />
          Prompt Library
        </h2>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus size={18} />
          Create Prompt
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">Loading prompts...</div>
      ) : (
        <div className="space-y-6">
          {groupedPrompts.map(group => (
            <div key={group.category}>
              <h3 className="text-lg font-semibold mb-3 capitalize text-slate-700">
                {group.category}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.prompts.map(prompt => (
                  <div
                    key={prompt.id}
                    className="p-4 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-slate-800">{prompt.name}</h4>
                      <div className="flex gap-1">
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
                        {prompt.is_custom === 1 && (
                          <>
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
                            >
                              <Edit2 size={16} className="text-blue-600" />
                            </button>
                            <button
                              onClick={() => handleDelete(prompt.id)}
                              className="p-1 hover:bg-red-100 rounded transition-colors"
                            >
                              <Trash2 size={16} className="text-red-600" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-3">{prompt.template}</p>
                    {prompt.is_custom === 0 && (
                      <span className="inline-block mt-2 px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded">
                        Default
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl">
            <div className="p-6 border-b">
              <h3 className="text-xl font-bold">
                {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
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
                  rows={6}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Enter your prompt template here..."
                />
                <p className="text-xs text-slate-500 mt-1">
                  Tip: Use clear instructions. This will be added to your queries.
                </p>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
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