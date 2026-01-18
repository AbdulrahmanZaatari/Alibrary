import { NextRequest, NextResponse } from 'next/server';
import { getComments, getSynthesisCache, saveSynthesisCache } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ✅ Models for parallel processing - race to get fastest response
const PARALLEL_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
];

interface Comment {
  id: string;
  book_id: string;
  page_number: number;
  selected_text: string | null;
  comment: string;
  created_at: string;
}

interface SynthesizedSection {
  id: string;
  title: string;
  content: string;
  relatedComments: string[]; // Comment IDs
  pageReferences: number[];
}

interface SynthesisResponse {
  bookId: string;
  bookTitle: string;
  generatedAt: string;
  totalComments: number;
  summary: string;
  keyInsights: string[];
  themes: Array<{
    name: string;
    description: string;
    commentIds: string[];
  }>;
  sections: SynthesizedSection[];
  rawComments: Comment[];
  fromCache?: boolean;
  cachedAt?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { bookId, bookTitle, forceRefresh } = await req.json();
    
    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }
    
    // Fetch all comments for the book
    const comments = getComments(bookId) as Comment[];
    
    if (!comments || comments.length === 0) {
      return NextResponse.json({ 
        error: 'No comments found for this book',
        totalComments: 0 
      }, { status: 404 });
    }
    
    // ✅ Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getSynthesisCache(bookId);
      if (cached && cached.total_comments === comments.length) {
        console.log(`📦 [Synthesis] Returning cached results for ${bookId}`);
        const cachedData = JSON.parse(cached.synthesis_json);
        // Update raw comments to current (in case of edits)
        cachedData.rawComments = comments;
        return NextResponse.json({
          ...cachedData,
          fromCache: true,
          cachedAt: cached.updated_at
        });
      }
    }
    
    console.log(`📝 Synthesizing ${comments.length} comments for book: ${bookTitle || bookId}${forceRefresh ? ' (force refresh)' : ''}`);
    
    // Prepare comments for AI analysis
    const commentsText = comments.map((c, i) => {
      const selectedPart = c.selected_text 
        ? `\n   النص المحدد: "${c.selected_text}"` 
        : '';
      return `${i + 1}. [صفحة ${c.page_number}]${selectedPart}
   التعليق: ${c.comment}`;
    }).join('\n\n');
    
    const prompt = `أنت مساعد بحثي متخصص في تحليل وتلخيص ملاحظات الباحثين.

لدي مجموعة من التعليقات والملاحظات التي دونها باحث أثناء قراءة كتاب "${bookTitle || 'كتاب'}".

التعليقات:
${commentsText}

مهمتك:
1. اكتب ملخصاً شاملاً يجمع أهم الأفكار والملاحظات (3-5 فقرات)
2. استخرج أهم الاستنتاجات والرؤى (5-8 نقاط)
3. حدد المحاور/الموضوعات الرئيسية التي تدور حولها التعليقات
4. نظم التعليقات في أقسام موضوعية مترابطة

أجب بصيغة JSON التالية:
{
  "summary": "ملخص شامل للملاحظات...",
  "keyInsights": [
    "استنتاج أول...",
    "استنتاج ثاني..."
  ],
  "themes": [
    {
      "name": "اسم المحور",
      "description": "وصف مختصر",
      "commentIndices": [1, 3, 5]
    }
  ],
  "sections": [
    {
      "title": "عنوان القسم",
      "content": "محتوى مفصل يجمع الأفكار ذات الصلة...",
      "commentIndices": [1, 2],
      "pageReferences": [10, 15]
    }
  ]
}

ملاحظات:
- اكتب بأسلوب أكاديمي واضح
- حافظ على أفكار الباحث الأصلية
- رقم التعليق (commentIndices) يبدأ من 1
- اجعل الأقسام مفيدة للباحث في كتابة بحثه`;

    // ✅ Run parallel requests and use Promise.race to get the FASTEST response
    console.log(`🚀 [Synthesize] Racing ${PARALLEL_MODELS.length} parallel AI requests for fastest response...`);
    const startTime = Date.now();
    
    // Create promises that resolve on success or never resolve on failure
    const racePromises = PARALLEL_MODELS.map(async (modelName) => {
      try {
        console.log(`🤖 [Synthesize] Starting ${modelName}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        console.log(`✅ [Synthesize] ${modelName} completed first!`);
        return { modelName, response, success: true };
      } catch (error: any) {
        console.warn(`⚠️ [Synthesize] ${modelName} failed:`, error.message);
        // Return a promise that never resolves so Promise.race ignores failures
        return new Promise(() => {}) as Promise<never>;
      }
    });
    
    // Also add a timeout fallback
    const timeoutPromise = new Promise<{ modelName: string; response: string; success: boolean }>((_, reject) => {
      setTimeout(() => reject(new Error('All AI requests timed out after 90 seconds')), 90000);
    });
    
    // Race all requests - first successful one wins
    let successfulResult;
    try {
      successfulResult = await Promise.race([...racePromises, timeoutPromise]);
    } catch {
      // If race fails, try Promise.all as fallback
      console.log('⚠️ [Synthesize] Race failed, trying Promise.all fallback...');
      const allResults = await Promise.all(PARALLEL_MODELS.map(async (modelName) => {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          return { modelName, response: result.response.text(), success: true };
        } catch {
          return { modelName, response: '', success: false };
        }
      }));
      successfulResult = allResults.find(r => r.success && r.response);
      if (!successfulResult) {
        throw new Error('All parallel AI requests failed');
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const responseText = successfulResult.response;
    console.log(`✅ [Synthesize] Got response from ${successfulResult.modelName} in ${elapsed}s`);
    
    // Parse JSON from response with cleanup
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response');
    }
    
    // Clean up common JSON issues from AI responses
    let jsonStr = jsonMatch[0];
    // Remove trailing commas before ] or }
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    
    let aiResult;
    try {
      aiResult = JSON.parse(jsonStr);
    } catch {
      console.error('JSON parse failed, attempting basic extraction...');
      // Extract what we can
      const summaryMatch = responseText.match(/"summary"\s*:\s*"([^"]+)"/);
      aiResult = {
        summary: summaryMatch ? summaryMatch[1] : 'فشل في تحليل الاستجابة',
        keyInsights: [],
        themes: [],
        sections: []
      };
    }
    
    // Map comment indices to actual comment IDs
    const mapIndicesToIds = (indices: number[]): string[] => {
      return indices
        .filter(i => i > 0 && i <= comments.length)
        .map(i => comments[i - 1].id);
    };
    
    const mapIndicesToPages = (indices: number[]): number[] => {
      const pages = indices
        .filter(i => i > 0 && i <= comments.length)
        .map(i => comments[i - 1].page_number);
      return [...new Set(pages)].sort((a, b) => a - b);
    };
    
    // Build response
    const synthesis: SynthesisResponse = {
      bookId,
      bookTitle: bookTitle || 'Unknown Book',
      generatedAt: new Date().toISOString(),
      totalComments: comments.length,
      summary: aiResult.summary || '',
      keyInsights: aiResult.keyInsights || [],
      themes: (aiResult.themes || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        commentIds: mapIndicesToIds(t.commentIndices || [])
      })),
      sections: (aiResult.sections || []).map((s: any, idx: number) => ({
        id: `section-${idx + 1}`,
        title: s.title,
        content: s.content,
        relatedComments: mapIndicesToIds(s.commentIndices || []),
        pageReferences: s.pageReferences || mapIndicesToPages(s.commentIndices || [])
      })),
      rawComments: comments
    };
    
    console.log(`✅ Synthesis complete: ${synthesis.sections.length} sections, ${synthesis.themes.length} themes`);
    
    // ✅ Save to cache
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawComments: _rawComments, ...cacheData } = synthesis;
      saveSynthesisCache(bookId, JSON.stringify(cacheData), comments.length);
      console.log(`💾 [Synthesis] Saved to cache for ${bookId}`);
    } catch (cacheError) {
      console.warn('Failed to save synthesis cache:', cacheError);
    }
    
    return NextResponse.json({ ...synthesis, fromCache: false });
    
  } catch (error) {
    console.error('Comments synthesis error:', error);
    return NextResponse.json({ 
      error: 'Failed to synthesize comments',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
