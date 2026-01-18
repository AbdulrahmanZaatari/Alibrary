import { NextRequest, NextResponse } from 'next/server';
import { 
  getGlossaries, 
  getGlossary, 
  saveGlossary, 
  updateGlossary, 
  deleteGlossary,
  GlossaryTerm 
} from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// GET - List glossaries or get single glossary
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const bookId = searchParams.get('bookId');
    
    if (id) {
      const glossary = getGlossary(id);
      if (!glossary) {
        return NextResponse.json({ error: 'Glossary not found' }, { status: 404 });
      }
      return NextResponse.json(glossary);
    }
    
    const glossaries = getGlossaries(bookId || undefined);
    return NextResponse.json(glossaries);
  } catch (error) {
    console.error('Error fetching glossaries:', error);
    return NextResponse.json({ error: 'Failed to fetch glossaries' }, { status: 500 });
  }
}

// POST - Generate new glossary for page range
export async function POST(req: NextRequest) {
  try {
    const { bookId, bookTitle, pageStart, pageEnd, query } = await req.json();
    
    if (!bookId || !pageStart || !pageEnd) {
      return NextResponse.json({ error: 'bookId, pageStart, and pageEnd are required' }, { status: 400 });
    }
    
    console.log(`📚 Generating glossary for ${bookTitle || bookId} pages ${pageStart}-${pageEnd}`);
    
    // Fetch chunks for the page range from embeddings table
    const { data: chunks, error } = await supabaseAdmin
      .from('embeddings')
      .select('chunk_text, page_number')
      .eq('document_id', bookId)
      .gte('page_number', pageStart)
      .lte('page_number', pageEnd)
      .order('page_number', { ascending: true });
    
    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    }
    
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ error: `No content found for pages ${pageStart}-${pageEnd}. Make sure the document is embedded.` }, { status: 404 });
    }
    
    console.log(`📄 Found ${chunks.length} chunks for pages ${pageStart}-${pageEnd}`);
    
    // Combine content by page
    const pageContents: Record<number, string> = {};
    for (const chunk of chunks) {
      const page = chunk.page_number || pageStart;
      if (!pageContents[page]) {
        pageContents[page] = '';
      }
      pageContents[page] += chunk.chunk_text + '\n';
    }
    
    // Format for AI
    const contentText = Object.entries(pageContents)
      .map(([page, content]) => `[صفحة ${page}]\n${content}`)
      .join('\n\n---\n\n');
    
    const prompt = `أنت خبير في تحليل النصوص العربية والفكر الإسلامي وإنشاء قوائم المصطلحات الأكاديمية.

المحتوى التالي من كتاب "${bookTitle || 'كتاب'}" (صفحات ${pageStart} إلى ${pageEnd}):

${contentText.substring(0, 15000)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
مهمتك: إنشاء قائمة مصطلحات أكاديمية (Academic Glossary)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⛔ لا تشمل أبداً في القائمة:
- التواريخ والسنوات (مثل: عام 1953، 2023)
- أسماء دور النشر والمؤسسات (مثل: مؤسسة هنداوي، دار الكتب)
- الكلمات العامة جداً (مثل: كتاب، صفحة، فصل، المؤلف)
- معلومات النشر والطباعة والإصدار
- الأقارب والعلاقات العادية (صديقان، الأب، الابن) إلا إذا كانت مصطلحات فلسفية
- الصفات العامة (صغير، كبير، قديم، جديد)

✅ ما يجب تضمينه فقط:
1. المفاهيم الفلسفية والدينية الجوهرية (مثل: التوحيد، الوجود، المعرفة الإلهية، رؤية الله)
2. المصطلحات الصوفية والعرفانية (مثل: الفناء، البقاء، الكشف، المحبة الإلهية)
3. المصطلحات اللاهوتية والكلامية (مثل: الصفات الإلهية، القدر، العناية)
4. المفاهيم الأخلاقية والروحية (مثل: التقوى، الزهد، الصدق، الإخلاص)
5. أسماء العلماء والفلاسفة والمفكرين المذكورين
6. المصطلحات الخاصة التي يعرّفها أو يستخدمها المؤلف بمعنى محدد

أجب بصيغة JSON فقط (بدون أي نص قبله أو بعده):
{
  "terms": [
    {"term": "رؤية الله", "definition": "موضوع الكتاب: إمكانية رؤية الله في الآخرة وطبيعة هذه الرؤية", "page": 1, "category": "theological"},
    {"term": "محبة الله", "definition": "الشعور العميق بالارتباط بالله الذي يقود لطلب القرب منه ورؤيته", "page": 5, "category": "concept"}
  ]
}`;

    // Generate with AI
    const model = genAI.getGenerativeModel({ model: 'gemma-3-27b-it' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Parse JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response');
    }
    
    const jsonStr = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Fallback: extract terms via regex
      const termPattern = /\{\s*"term"\s*:\s*"([^"]+)"\s*,\s*"definition"\s*:\s*"([^"]+)"\s*,\s*"page"\s*:\s*(\d+)\s*,\s*"category"\s*:\s*"([^"]+)"\s*\}/g;
      const terms: GlossaryTerm[] = [];
      let match;
      while ((match = termPattern.exec(responseText)) !== null) {
        terms.push({
          term: match[1],
          definition: match[2],
          page: parseInt(match[3]),
          category: match[4]
        });
      }
      parsed = { terms };
    }
    
    const terms: GlossaryTerm[] = parsed.terms || [];
    
    // Save to database
    const glossaryId = saveGlossary(
      bookId,
      bookTitle || null,
      pageStart,
      pageEnd,
      query || `Glossary for pages ${pageStart}-${pageEnd}`,
      terms
    );
    
    console.log(`✅ Generated glossary with ${terms.length} terms, saved as ${glossaryId}`);
    
    return NextResponse.json({
      id: glossaryId,
      book_id: bookId,
      book_title: bookTitle,
      page_start: pageStart,
      page_end: pageEnd,
      query: query || `Glossary for pages ${pageStart}-${pageEnd}`,
      terms,
      created_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error generating glossary:', error);
    return NextResponse.json({ error: 'Failed to generate glossary' }, { status: 500 });
  }
}

// PUT - Update glossary terms (for editing)
export async function PUT(req: NextRequest) {
  try {
    const { id, terms } = await req.json();
    
    if (!id || !terms) {
      return NextResponse.json({ error: 'id and terms are required' }, { status: 400 });
    }
    
    const existing = getGlossary(id);
    if (!existing) {
      return NextResponse.json({ error: 'Glossary not found' }, { status: 404 });
    }
    
    updateGlossary(id, terms);
    
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error updating glossary:', error);
    return NextResponse.json({ error: 'Failed to update glossary' }, { status: 500 });
  }
}

// DELETE - Delete a glossary
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    
    deleteGlossary(id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting glossary:', error);
    return NextResponse.json({ error: 'Failed to delete glossary' }, { status: 500 });
  }
}
