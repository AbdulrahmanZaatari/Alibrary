// types/index.ts
export interface Document {
  id: string;
  filename: string;
  displayName: string;
  totalPages: number;
  uploadDate: string;
  selected: boolean;
}

export interface Prompt {
  id: string;
  name: string;
  template: string;
  category: string;
  isCustom: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  text: string;
  pageNumber: number;
  embedding?: number[];
}