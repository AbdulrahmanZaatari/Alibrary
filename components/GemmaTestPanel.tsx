'use client';

import { useState, useRef } from 'react';
import { Send, Paperclip, X, Loader2, Copy, Check, Trash2, Image as ImageIcon } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  images?: string[];
  timestamp: Date;
}

const GEMMA_MODELS = [
  { id: 'gemma-3-27b-it', name: 'Gemma 3 27B', description: 'Largest, most capable' },
  { id: 'gemma-3-12b-it', name: 'Gemma 3 12B', description: 'Balanced performance' },
  { id: 'gemma-3-4b-it', name: 'Gemma 3 4B', description: 'Fast, lightweight' },
];

export default function GemmaTestPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemma-3-27b-it');
  const [attachedImages, setAttachedImages] = useState<{ file: File; preview: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachedImages(prev => [
            ...prev,
            { file, preview: event.target?.result as string }
          ]);
        };
        reader.readAsDataURL(file);
      }
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    setMessages([]);
    setAttachedImages([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && attachedImages.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      images: attachedImages.map(img => img.preview),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Convert images to base64
      const imageBase64s = attachedImages.map(img => {
        const base64 = img.preview.split(',')[1];
        return base64;
      });

      const response = await fetch('/api/gemma-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input,
          model: selectedModel,
          images: imageBase64s,
        }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.error || 'No response',
        model: data.model || selectedModel,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setAttachedImages([]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        model: selectedModel,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">🧪 Gemma Model Tester</h2>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-gray-700 text-white px-3 py-1.5 rounded-lg border border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {GEMMA_MODELS.map(model => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.description}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors text-sm"
        >
          <Trash2 size={16} />
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <ImageIcon size={48} className="mb-4 opacity-50" />
            <p className="text-lg">Test Gemma Models</p>
            <p className="text-sm mt-2">Send text or attach images to test model responses</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              {GEMMA_MODELS.map(model => (
                <div key={model.id} className="bg-gray-800 px-3 py-2 rounded-lg text-center">
                  <div className="font-medium text-white">{model.name}</div>
                  <div className="text-gray-400">{model.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-100'
              }`}
            >
              {/* User images */}
              {message.images && message.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {message.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`Attached ${idx + 1}`}
                      className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}

              {/* Content */}
              <div className="whitespace-pre-wrap break-words">{message.content}</div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-xs opacity-60">
                  {message.model && `${message.model} • `}
                  {message.timestamp.toLocaleTimeString()}
                </span>
                {message.role === 'assistant' && (
                  <button
                    onClick={() => copyToClipboard(message.content, message.id)}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                  >
                    {copiedId === message.id ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} className="opacity-60 hover:opacity-100" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg p-4 flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-blue-400" />
              <span className="text-gray-400">
                Generating with {GEMMA_MODELS.find(m => m.id === selectedModel)?.name}...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attached Images Preview */}
      {attachedImages.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
          <div className="flex flex-wrap gap-2">
            {attachedImages.map((img, index) => (
              <div key={index} className="relative group">
                <img
                  src={img.preview}
                  alt={`Attachment ${index + 1}`}
                  className="w-20 h-20 object-cover rounded-lg"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700 bg-gray-800">
        <div className="flex items-end gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageAttach}
            accept="image/*"
            multiple
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            title="Attach images"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Type a message or attach an image..."
            className="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || (!input.trim() && attachedImages.length === 0)}
            className="p-3 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
