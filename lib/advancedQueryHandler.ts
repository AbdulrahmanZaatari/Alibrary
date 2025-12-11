/**
 * Advanced Query Understanding Module
 * 
 * Handles:
 * 1. Continuation requests ("continue", "more examples", etc.)
 * 2. Conversation context references ("use what we talked about")
 * 3. Page/chapter range filtering ("from page 10 to 50", "chapter 3")
 * 4. Result limit tracking and "more available" notifications
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const FALLBACK_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES & INTERFACES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface QueryIntent {
  type: 'search' | 'continue' | 'analyze' | 'summarize' | 'conversation_context' | 'compare';
  isContinuation: boolean;
  wantsMoreExamples: boolean;
  usePreviousContext: boolean;
  pageRange?: {
    start?: number;
    end?: number;
    chapter?: string;
  };
  keywords: string[];
  originalQuery: string;
  confidence: number;
}

export interface RetrievalState {
  sessionId: string;
  lastQuery: string;
  lastKeywords: string[];
  totalResultsFound: number;
  resultsShown: number;
  lastPageOffset: number;
  remainingPages: number[];
  documentIds: string[];
  timestamp: number;
}

export interface ContinuationInfo {
  hasMore: boolean;
  remainingCount: number;
  remainingPages: number[];
  message: string;
  messageAr: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN-MEMORY STATE TRACKING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const sessionStates = new Map<string, RetrievalState>();
const STATE_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup old states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of sessionStates.entries()) {
    if (now - state.timestamp > STATE_TTL) {
      sessionStates.delete(key);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

/**
 * Save retrieval state for continuation support
 */
export function saveRetrievalState(
  sessionId: string,
  query: string,
  keywords: string[],
  totalFound: number,
  shown: number,
  documentIds: string[],
  allPages: number[]
): void {
  const remainingPages = allPages.slice(shown);
  
  sessionStates.set(sessionId, {
    sessionId,
    lastQuery: query,
    lastKeywords: keywords,
    totalResultsFound: totalFound,
    resultsShown: shown,
    lastPageOffset: shown,
    remainingPages,
    documentIds,
    timestamp: Date.now()
  });
  
  console.log(`📊 [State] Saved: ${shown}/${totalFound} shown, ${remainingPages.length} remaining`);
}

/**
 * Get retrieval state for continuation
 */
export function getRetrievalState(sessionId: string): RetrievalState | null {
  const state = sessionStates.get(sessionId);
  if (state && Date.now() - state.timestamp < STATE_TTL) {
    return state;
  }
  return null;
}

/**
 * Update state after showing more results
 */
export function updateRetrievalState(sessionId: string, additionalShown: number): void {
  const state = sessionStates.get(sessionId);
  if (state) {
    state.resultsShown += additionalShown;
    state.lastPageOffset += additionalShown;
    state.remainingPages = state.remainingPages.slice(additionalShown);
    state.timestamp = Date.now();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUERY INTENT DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Detect if query is a continuation request
 */
export function detectContinuationRequest(query: string): boolean {
  const continuationPatterns = [
    // English
    /^continue$/i,
    /^more$/i,
    /^show\s*more/i,
    /^give\s*me\s*more/i,
    /^next/i,
    /^more\s*examples?/i,
    /^additional/i,
    /^keep\s*going/i,
    /^go\s*on/i,
    /^what\s*else/i,
    /^any\s*more/i,
    // Arabic
    /^المزيد$/,
    /^أكمل$/,
    /^استمر$/,
    /^تابع$/,
    /^المزيد\s*من\s*الأمثلة/,
    /^أمثلة\s*أخرى/,
    /^ماذا\s*أيضاً/,
    /^هل\s*يوجد\s*المزيد/,
    /^أعطني\s*المزيد/,
  ];
  
  return continuationPatterns.some(p => p.test(query.trim()));
}

/**
 * Detect if query references previous conversation
 */
export function detectConversationReference(query: string): boolean {
  const referencePatterns = [
    // English
    /use\s+what\s+we\s+(talked|discussed|said)/i,
    /based\s+on\s+(our|the)\s+(conversation|discussion|chat)/i,
    /from\s+(our|the)\s+(previous|earlier)\s+(conversation|discussion)/i,
    /what\s+we\s+(mentioned|covered|went\s+over)/i,
    /using\s+(the|our)\s+(context|conversation)/i,
    /summarize\s+(our|the)\s+(conversation|discussion|chat)/i,
    /what\s+have\s+we\s+(discussed|talked\s+about)/i,
    // Arabic
    /استخدم\s+ما\s+(ناقشناه|تحدثنا\s+عنه)/,
    /بناءً\s+على\s+(محادثتنا|نقاشنا)/,
    /من\s+(محادثتنا|نقاشنا)\s+السابق/,
    /ما\s+(ذكرناه|تناولناه)/,
    /لخص\s+(المحادثة|النقاش)/,
    /عن\s+ماذا\s+تحدثنا/,
  ];
  
  return referencePatterns.some(p => p.test(query));
}

/**
 * Extract page/chapter range from query
 */
export function extractPageRange(query: string): { start?: number; end?: number; chapter?: string } | null {
  const result: { start?: number; end?: number; chapter?: string } = {};
  
  // Page range patterns (English)
  const pageRangeEn = query.match(/(?:from\s+)?page\s*(\d+)\s*(?:to|[-–])\s*(?:page\s*)?(\d+)/i);
  if (pageRangeEn) {
    result.start = parseInt(pageRangeEn[1]);
    result.end = parseInt(pageRangeEn[2]);
    return result;
  }
  
  // Page range patterns (Arabic)
  const pageRangeAr = query.match(/(?:من\s+)?صفحة\s*(\d+)\s*(?:إلى|حتى|[-–])\s*(?:صفحة\s*)?(\d+)/);
  if (pageRangeAr) {
    result.start = parseInt(pageRangeAr[1]);
    result.end = parseInt(pageRangeAr[2]);
    return result;
  }
  
  // Single page "from page X onwards"
  const fromPageEn = query.match(/(?:from|starting\s+(?:from|at))\s+page\s*(\d+)/i);
  if (fromPageEn) {
    result.start = parseInt(fromPageEn[1]);
    return result;
  }
  
  const fromPageAr = query.match(/(?:من|بداية\s+من)\s+صفحة\s*(\d+)/);
  if (fromPageAr) {
    result.start = parseInt(fromPageAr[1]);
    return result;
  }
  
  // Until page X
  const untilPageEn = query.match(/(?:until|up\s+to|before)\s+page\s*(\d+)/i);
  if (untilPageEn) {
    result.end = parseInt(untilPageEn[1]);
    return result;
  }
  
  const untilPageAr = query.match(/(?:حتى|إلى|قبل)\s+صفحة\s*(\d+)/);
  if (untilPageAr) {
    result.end = parseInt(untilPageAr[1]);
    return result;
  }
  
  // Chapter patterns
  const chapterEn = query.match(/(?:in\s+)?chapter\s*[:\s]*([\w\d]+)/i);
  if (chapterEn) {
    result.chapter = chapterEn[1];
    return result;
  }
  
  const chapterAr = query.match(/(?:في\s+)?(?:الفصل|الباب)\s*[:\s]*([\u0600-\u06FF\w\d]+)/);
  if (chapterAr) {
    result.chapter = chapterAr[1];
    return result;
  }
  
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Comprehensive query intent analysis
 */
export async function analyzeQueryIntent(
  query: string,
  conversationHistory: Array<{ role: string; content: string }>,
  sessionId?: string
): Promise<QueryIntent> {
  const normalizedQuery = query.trim();
  
  // Quick pattern-based detection first
  const isContinuation = detectContinuationRequest(normalizedQuery);
  const usesConversationContext = detectConversationReference(normalizedQuery);
  const pageRange = extractPageRange(normalizedQuery);
  
  // If it's a simple continuation, return immediately
  if (isContinuation && sessionId) {
    const state = getRetrievalState(sessionId);
    if (state) {
      return {
        type: 'continue',
        isContinuation: true,
        wantsMoreExamples: true,
        usePreviousContext: true,
        keywords: state.lastKeywords,
        originalQuery: state.lastQuery,
        confidence: 0.95
      };
    }
  }
  
  // For conversation context queries, we need AI to summarize
  if (usesConversationContext) {
    return {
      type: 'conversation_context',
      isContinuation: false,
      wantsMoreExamples: false,
      usePreviousContext: true,
      pageRange: pageRange || undefined,
      keywords: [],
      originalQuery: normalizedQuery,
      confidence: 0.9
    };
  }
  
  // Use AI for complex intent analysis
  const aiIntent = await analyzeIntentWithAI(normalizedQuery, conversationHistory);
  
  return {
    ...aiIntent,
    pageRange: pageRange || aiIntent.pageRange,
    originalQuery: normalizedQuery
  };
}

/**
 * AI-powered intent analysis for complex queries
 */
async function analyzeIntentWithAI(
  query: string,
  history: Array<{ role: string; content: string }>
): Promise<QueryIntent> {
  const recentHistory = history.slice(-4);
  const historyText = recentHistory
    .map(m => `${m.role}: ${m.content.substring(0, 150)}...`)
    .join('\n');
  
  const prompt = `Analyze this query and determine user intent.

**Recent Conversation:**
${historyText || 'No previous conversation'}

**Current Query:** ${query}

**Detect:**
1. Is this asking for MORE of the same thing? (continuation)
2. Does it want to use previous conversation context?
3. Is there a page/chapter filter?
4. What are the key search terms?

**Response (JSON only):**
{
  "type": "search|continue|analyze|summarize|conversation_context|compare",
  "isContinuation": boolean,
  "wantsMoreExamples": boolean,
  "usePreviousContext": boolean,
  "pageRange": {"start": number|null, "end": number|null, "chapter": string|null} or null,
  "keywords": ["keyword1", "keyword2"],
  "confidence": 0.0-1.0
}`;

  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      });
      
      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();
      response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const parsed = JSON.parse(response);
      
      return {
        type: parsed.type || 'search',
        isContinuation: parsed.isContinuation || false,
        wantsMoreExamples: parsed.wantsMoreExamples || false,
        usePreviousContext: parsed.usePreviousContext || false,
        pageRange: parsed.pageRange || undefined,
        keywords: parsed.keywords || [],
        originalQuery: query,
        confidence: parsed.confidence || 0.7
      };
    } catch (error) {
      console.warn(`[QueryIntent] Model ${modelName} failed:`, error);
      continue;
    }
  }
  
  // Fallback: basic keyword extraction
  return {
    type: 'search',
    isContinuation: false,
    wantsMoreExamples: false,
    usePreviousContext: false,
    keywords: query.split(/\s+/).filter(w => w.length > 2),
    originalQuery: query,
    confidence: 0.5
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTINUATION INFO GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generate continuation info message
 */
export function generateContinuationInfo(
  totalFound: number,
  shown: number,
  remainingPages: number[]
): ContinuationInfo {
  const remaining = totalFound - shown;
  const hasMore = remaining > 0;
  
  if (!hasMore) {
    return {
      hasMore: false,
      remainingCount: 0,
      remainingPages: [],
      message: '',
      messageAr: ''
    };
  }
  
  // Format page numbers (show first 5, then "...")
  const pagesToShow = remainingPages.slice(0, 5);
  const pageListEn = pagesToShow.join(', ') + (remainingPages.length > 5 ? ', ...' : '');
  const pageListAr = pagesToShow.join('، ') + (remainingPages.length > 5 ? '، ...' : '');
  
  return {
    hasMore: true,
    remainingCount: remaining,
    remainingPages,
    message: `\n\n---\n📚 **${remaining} more result${remaining > 1 ? 's' : ''} available** in pages: ${pageListEn}\n\n💡 *Type "continue" or "more" to see additional examples.*`,
    messageAr: `\n\n---\n📚 **يوجد ${remaining} نتيجة${remaining > 1 ? ' إضافية' : ''} أخرى** في الصفحات: ${pageListAr}\n\n💡 *اكتب "المزيد" أو "أكمل" لعرض المزيد من الأمثلة.*`
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONVERSATION CONTEXT SUMMARIZATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Summarize conversation for context-aware responses
 */
export async function summarizeConversationForQuery(
  history: Array<{ role: string; content: string }>,
  language: 'ar' | 'en'
): Promise<string> {
  if (!history || history.length === 0) {
    return language === 'ar' 
      ? 'لا توجد محادثة سابقة للإشارة إليها.'
      : 'No previous conversation to reference.';
  }
  
  const historyText = history
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  
  const prompt = language === 'ar'
    ? `لخص النقاط الرئيسية من هذه المحادثة بإيجاز:

${historyText}

**الملخص:**`
    : `Summarize the key points from this conversation concisely:

${historyText}

**Summary:**`;

  for (const modelName of FALLBACK_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
      });
      
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch {
      continue;
    }
  }
  
  // Fallback: return last few exchanges
  const recent = history.slice(-4);
  return recent.map(m => `• ${m.content.substring(0, 100)}...`).join('\n');
}

/**
 * Extract topics discussed in conversation
 */
export function extractConversationTopics(
  history: Array<{ role: string; content: string }>
): string[] {
  const topics = new Set<string>();
  
  for (const msg of history) {
    // Extract Arabic keywords (3+ chars)
    const arabicWords = msg.content.match(/[\u0600-\u06FF]{3,}/g) || [];
    arabicWords.forEach(w => topics.add(w));
    
    // Extract English keywords (4+ chars, not common words)
    const commonWords = new Set(['this', 'that', 'with', 'from', 'have', 'were', 'been', 'what', 'when', 'where', 'which', 'there', 'their', 'about', 'would', 'could', 'should']);
    const englishWords = msg.content.match(/\b[a-zA-Z]{4,}\b/g) || [];
    englishWords.forEach(w => {
      if (!commonWords.has(w.toLowerCase())) {
        topics.add(w.toLowerCase());
      }
    });
  }
  
  return Array.from(topics).slice(0, 20); // Return top 20 topics
}
