# 🕌 Islamic Research Assistant

An AI-powered research platform designed specifically for Arabic and Islamic studies, featuring advanced document analysis, semantic search, and conversational AI capabilities.

![Next.js](https://img.shields.io/badge/Next.js-16.0-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-2.5-orange?style=flat-square)
![Supabase](https://img.shields.io/badge/Supabase-Vector_DB-green?style=flat-square&logo=supabase)

## 🌟 Features

### 📚 Intelligent Document Management
- **PDF Reader Mode**: Advanced PDF viewer with page navigation, zoom, rotation, and bookmarking
- **Multi-document Corpus**: Upload and manage multiple Arabic/English scholarly texts
- **Smart Embedding**: Automatic text extraction and semantic embedding using Google's Gemini models
- **Metadata Extraction**: AI-powered extraction of author, publisher, year, and language information

### 🤖 Advanced AI Research Capabilities
- **Contextual Chat**: Conversation-aware AI assistant with memory across sessions
- **Multi-hop Reasoning**: Complex question answering that chains multiple reasoning steps
- **Semantic Search**: Vector-based similarity search with intelligent retrieval strategies
- **Hybrid Knowledge**: Combines document context with general AI knowledge for comprehensive answers
- **Arabic Language Support**: Native RTL support with specialized Arabic text processing

### 🎯 Research Tools
- **Smart Annotations**: Add comments and highlights to specific pages
- **Citation Generator**: Auto-generate citations in APA, MLA, Chicago, and Harvard formats
- **Spelling Correction**: Arabic text correction with normal and aggressive modes
- **Prompt Library**: Pre-built research prompts for literary analysis, historical evidence, and more
- **Export Capabilities**: Export conversations to PDF, Markdown, or JSON

### 🔍 Intelligent Retrieval Strategies
- **Factual Precise**: High-precision search for specific facts
- **Thematic Broad**: Comprehensive document understanding
- **Comparative Analysis**: Multi-document comparison capabilities
- **Narrative Flow**: Sequential content retrieval for storytelling

## 🏗️ Technology Stack

### Frontend
- **Framework**: [Next.js 16.0](https://nextjs.org/) with App Router
- **Language**: TypeScript 5.0
- **UI Components**: 
  - React 19.2 with Server Components
  - [Lucide React](https://lucide.dev/) for icons
  - Custom Tailwind CSS styling
- **PDF Rendering**: [react-pdf](https://github.com/wojtekmaj/react-pdf) powered by PDF.js
- **Markdown**: [ReactMarkdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm)

### Backend & AI
- **AI Models**: 
  - [Google Gemini 2.5 Pro/Flash](https://ai.google.dev/) for chat and reasoning
  - Gemini 2.0 Flash for embeddings (768 dimensions)
  - Multiple model fallback system for reliability
- **Vector Database**: [Supabase](https://supabase.com/) with pgvector extension
- **Local Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for metadata and sessions
- **PDF Processing**: 
  - [MuPDF](https://mupdf.com/) for high-quality text extraction
  - [pdf-parse](https://www.npmjs.com/package/pdf-parse) as fallback
  - [Canvas](https://www.npmjs.com/package/canvas) for image processing

### Infrastructure
- **Runtime**: Node.js 20
- **Storage**: Supabase Storage for PDF files
- **Deployment**: Optimized for [Railway](https://railway.app/) and [Vercel](https://vercel.com/)
- **Build System**: Turbopack for fast development

## 🚀 Getting Started

### Prerequisites
- Node.js 20 or higher
- npm/yarn/pnpm
- Supabase account (for vector storage)
- Google AI API key (Gemini)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/islamic-research-assistant.git
   cd islamic-research-assistant
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   # Google Gemini API
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Supabase Configuration
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   
   # Optional: OpenAI (for fallback)
   OPENAI_API_KEY=your_openai_api_key
   ```

4. **Initialize the database**
   
   The SQLite database will be automatically created on first run. For Supabase:
   
   ```sql
   -- Run this in Supabase SQL Editor
   CREATE TABLE embeddings (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     document_id TEXT NOT NULL,
     chunk_text TEXT NOT NULL,
     page_number INTEGER NOT NULL,
     embedding VECTOR(768),
     created_at TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## 📖 Usage

### 1. Upload Documents
- Click on "Reader" mode
- Upload PDF files using the upload button
- Wait for automatic text extraction and embedding

### 2. Chat with Documents
- Select one or more documents from the corpus
- Ask questions in Arabic or English
- Enable "Multi-hop Reasoning" for complex queries

### 3. Read with AI Assistance
- Open a book in Reader mode
- Use the AI chat sidebar for page-specific questions
- Extract and copy text from pages
- Add bookmarks and comments

### 4. Generate Citations
- Select text in the PDF
- Click "Cite" from the popup menu
- Choose your citation style (APA/MLA/Chicago/Harvard)

### 5. Use Prompt Library
- Access pre-built research prompts
- Create custom prompts for repeated tasks
- Apply prompts to enhance your research

## 🗂️ Project Structure

```
islamic-research-assistant/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── books/               # Book management
│   │   ├── chat/                # General chat
│   │   ├── reader-chat/         # Reader-specific chat
│   │   ├── citations/           # Citation generation
│   │   ├── comments/            # Comment system
│   │   ├── embed/               # Document embedding
│   │   └── query/               # Semantic search
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Home page
├── components/                   # React Components
│   ├── ChatPanel.tsx            # Main chat interface
│   ├── ReaderMode.tsx           # PDF reader with annotations
│   ├── HistoryPanel.tsx         # Conversation history
│   ├── CorpusManager.tsx        # Document management
│   ├── PromptLibrary.tsx        # Prompt templates
│   └── MetaDataManager.tsx      # Book metadata editor
├── lib/                          # Core Libraries
│   ├── gemini.ts                # Google Gemini integration
│   ├── db.ts                    # SQLite database operations
│   ├── vectorStore.ts           # Supabase vector operations
│   ├── smartRetrieval.ts        # Intelligent search strategies
│   ├── multiHopReasoning.ts     # Multi-step reasoning engine
│   ├── queryProcessor.ts        # Query analysis and translation
│   ├── contextAnalyzer.ts       # Conversation context tracking
│   ├── spellingCorrection.ts    # Arabic text correction
│   ├── chunking.ts              # Text chunking strategies
│   └── defaultPrompts.ts        # Pre-built research prompts
├── data/                         # Local data storage
│   └── data.db                  # SQLite database
├── uploads/                      # Temporary PDF storage
├── public/                       # Static assets
└── types/                        # TypeScript definitions
```

## 🔧 Configuration

### Model Selection
The app supports multiple Gemini models with automatic fallback:
- **gemini-3.0-flash**
- **gemini-2.5-flash**
- **gemini-2.5-flash-lite**
-**gemma models: 4b- 12b - 27b**

### Embedding Configuration
Located in [`lib/vectorStore.ts`](lib/vectorStore.ts ):
```typescript
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;
const SIMILARITY_THRESHOLD = 0.35;
```

### Chunking Strategy
Located in [`lib/chunking.ts`](lib/chunking.ts ):
```typescript
const TARGET_CHUNK_SIZE = 800;  
const MIN_CHUNK_SIZE = 400;
const MAX_CHUNK_SIZE = 1200;
```

## 🌐 Deployment

### Railway (Recommended)
1. Push to GitHub
2. Connect repository to Railway
3. Add environment variables
4. Deploy automatically

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📧 Contact

For questions or support, please open an issue on GitHub.

---

**Made with ❤️ for Islamic scholarship and Arabic research**