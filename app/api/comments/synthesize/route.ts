import { NextRequest, NextResponse } from 'next/server';
import { getComments } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ✅ Model hierarchy matching lib/gemini.ts
const CHAT_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview'
];

// OpenRouter fallback
const openRouterClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

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
}

export async function POST(req: NextRequest) {
  try {
    const { bookId, bookTitle } = await req.json();
    
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
    
    console.log(`📝 Synthesizing ${comments.length} comments for book: ${bookTitle || bookId}`);
    
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

    // ✅ Try models with fallback
    let responseText = '';
    let lastError: Error | null = null;
    
    for (const modelName of CHAT_MODELS) {
      try {
        console.log(`🤖 [Synthesize] Trying model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        responseText = result.response.text();
        console.log(`✅ [Synthesize] Success with ${modelName}`);
        break;
      } catch (error: any) {
        console.warn(`⚠️ [Synthesize] ${modelName} failed:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    if (!responseText && lastError) {
      throw lastError;
    }
    
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
    } catch (parseError) {
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
    
    return NextResponse.json(synthesis);
    
  } catch (error) {
    console.error('Comments synthesis error:', error);
    return NextResponse.json({ 
      error: 'Failed to synthesize comments',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
