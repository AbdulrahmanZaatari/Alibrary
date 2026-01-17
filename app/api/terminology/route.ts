import { NextRequest, NextResponse } from 'next/server';
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

// ✅ Model hierarchy matching lib/gemini.ts
const CHAT_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview'
];

// Comprehensive Arabic stopwords list
const ARABIC_STOPWORDS = new Set([
  // Prepositions
  'في', 'من', 'إلى', 'على', 'عن', 'مع', 'بين', 'حتى', 'منذ', 'خلال', 'عند', 'لدى', 'نحو', 'ضد', 'فوق', 'تحت', 'أمام', 'خلف', 'حول', 'دون', 'بعد', 'قبل', 'عبر',
  // Conjunctions
  'و', 'أو', 'ثم', 'ف', 'لكن', 'بل', 'لا', 'إلا', 'أن', 'إن', 'لأن', 'كي', 'حيث', 'إذ', 'إذا', 'لو', 'لولا', 'كلما', 'بينما', 'حين', 'حينما', 'عندما', 'لما', 'كما', 'مثلما',
  // Pronouns
  'هو', 'هي', 'هم', 'هن', 'أنا', 'نحن', 'أنت', 'أنتم', 'أنتن', 'أنتما', 'هما', 'هذا', 'هذه', 'هؤلاء', 'ذلك', 'تلك', 'أولئك', 'الذي', 'التي', 'الذين', 'اللواتي', 'اللذان', 'اللتان', 'ما', 'من', 'أي', 'كل', 'بعض', 'غير', 'سوى', 'نفس', 'عين', 'ذات',
  // Demonstratives & articles
  'ال', 'هذ', 'ذا', 'ذي', 'ذو', 'ذوو', 'ذات', 'ذوات',
  // Verbs (common)
  'كان', 'كانت', 'كانوا', 'يكون', 'تكون', 'يكونون', 'أصبح', 'صار', 'ظل', 'بات', 'أمسى', 'ليس', 'ليست', 'ليسوا', 'قال', 'قالت', 'قالوا', 'يقول', 'تقول', 'جعل', 'أخذ', 'راح', 'بدأ',
  // Question words
  'ما', 'ماذا', 'من', 'أين', 'متى', 'كيف', 'لماذا', 'هل', 'أ', 'كم', 'أي',
  // Numbers
  'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد', 'إحدى', 'اثنين', 'اثنتين', 'عشر', 'مائة', 'ألف',
  // Common words
  'كل', 'بعض', 'كلا', 'كلتا', 'جميع', 'معظم', 'أغلب', 'أكثر', 'أقل', 'عدة', 'بضع', 'آخر', 'أخرى', 'أول', 'آخر', 'نفس', 'عين', 'مثل', 'غير', 'سوى', 'فقط', 'أيضا', 'أيضاً', 'كذلك', 'هناك', 'هنا', 'ثمة', 'يوجد', 'توجد', 'لها', 'له', 'لهم', 'لهن', 'لنا', 'لك', 'لكم', 'بها', 'به', 'بهم', 'فيها', 'فيه', 'فيهم', 'عليها', 'عليه', 'عليهم', 'منها', 'منه', 'منهم', 'إليها', 'إليه', 'إليهم', 'بين', 'وبين', 'أما', 'وأما', 'إذن', 'لذا', 'لذلك', 'هكذا', 'وهو', 'وهي', 'وهم', 'والتي', 'والذي', 'مما', 'مما', 'بما', 'لما', 'عما', 'فيما', 'حيثما', 'أينما', 'كيفما', 'مهما', 'أنما', 'إنما', 'بينما', 'حينما', 'ريثما', 'طالما', 'قد', 'لقد', 'سوف', 'لن', 'لم', 'لما', 'ما', 'سا',
  // Affirmations/negations
  'نعم', 'أجل', 'بلى', 'كلا', 'لا', 'ليس', 'غير', 'عدم', 'دون', 'بدون', 'سواء',
  // Time-related common words
  'اليوم', 'أمس', 'غدا', 'الآن', 'دائما', 'أبدا', 'مرة', 'مرات', 'مرتين', 'أحيانا', 'عادة', 'غالبا', 'نادرا', 'قط', 'أبدا', 'البعض', 'الكثير', 'القليل', 'الجميع', 'الكل', 'البعض', 'النحو', 'الشكل', 'الوجه', 'الأمر', 'الحال', 'الشأن', 'السبب', 'العلة', 'الغرض', 'الهدف', 'المقصود', 'المراد', 'بداية', 'نهاية', 'وسط', 'أثناء', 'خلال', 'طوال', 'طيلة', 'خاصة', 'خصوصا', 'عموما', 'أساسا', 'فعلا', 'حقا', 'ربما', 'لعل', 'عسى', 'ليت', 'إلخ',
  // Single letters that appear in text
  'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي',
  // ✅ Words with و prefix (conjunctive waw)
  'ولا', 'ولم', 'ولن', 'ولكن', 'وقد', 'وكان', 'وكانت', 'وإذا', 'وإن', 'وأن', 'وما', 'ومن', 'وفي', 'وعلى', 'وعن', 'وأنا', 'وأنت', 'وهذا', 'وهذه', 'وذلك', 'وتلك', 'وبعد', 'وقبل', 'وحين', 'وعند', 'وإذ', 'وحتى', 'ولو', 'ومع', 'وبين', 'وقال', 'وقالت',
  // ✅ Words with ف prefix (fa conjunction)
  'فلا', 'فلم', 'فلن', 'فقد', 'فكان', 'فكانت', 'فإذا', 'فإن', 'فأن', 'فما', 'فمن', 'ففي', 'فعلى', 'فعن', 'فأنا', 'فهذا', 'فهذه', 'فذلك', 'فبعد', 'فقبل', 'فحين', 'فعند', 'فإذ', 'فحتى', 'فلو', 'فمع', 'فقال', 'فقالت',
  // ✅ Words with ب prefix (bi preposition)
  'بأن', 'بما', 'بمن', 'بهذا', 'بهذه', 'بذلك', 'بتلك', 'بكل', 'ببعض', 'بأي', 'بي', 'بك', 'بنا',
  // ✅ Words with ل prefix (li preposition)  
  'لي', 'لأن', 'لما', 'لمن', 'لهذا', 'لهذه', 'لذلك', 'لتلك', 'لكل', 'لبعض', 'لأي',
  // ✅ Common pronouns with إن/أن
  'إني', 'إنني', 'إنه', 'إنها', 'إنهم', 'إنهن', 'إننا', 'إنك', 'إنكم', 'أني', 'أنني', 'أنه', 'أنها', 'أنهم', 'أنهن', 'أننا', 'أنك', 'أنكم',
  // ✅ Common verb forms (first person)
  'قلت', 'كنت', 'رأيت', 'وجدت', 'علمت', 'عرفت', 'سمعت', 'ذهبت', 'جئت', 'أخذت', 'جعلت', 'تركت', 'أردت', 'أحببت',
  // ✅ Common nouns that are too generic
  'شيء', 'أشياء', 'شيئا', 'أمر', 'أمور', 'حال', 'أحوال', 'وقت', 'أوقات', 'يوم', 'أيام', 'ليلة', 'ليال', 'سنة', 'سنوات', 'عام', 'أعوام', 'لحظة', 'لحظات', 'ساعة', 'ساعات',
  'مكان', 'أماكن', 'موضع', 'مواضع', 'جهة', 'جهات', 'ناحية', 'نواحي', 'طريق', 'طرق', 'سبيل', 'سبل',
  'رجل', 'رجال', 'امرأة', 'نساء', 'إنسان', 'ناس', 'أناس', 'بشر', 'خلق', 'عبد', 'عباد', 'نفس', 'أنفس', 'نفسي', 'نفسه', 'نفسها', 'أنفسهم',
  'قول', 'أقوال', 'كلام', 'كلمة', 'كلمات', 'حديث', 'أحاديث', 'خبر', 'أخبار', 'رأي', 'آراء',
  'عمل', 'أعمال', 'فعل', 'أفعال', 'صنع', 'عالم', 'واحدة', 'رأسه', 'رأسها',
  // ✅ Vocative particles
  'يا', 'أيها', 'أيتها', 'هيا', 'آ', 'أي',
  // ✅ Exception/exclusion particles  
  'إلا', 'سوى', 'غير', 'عدا', 'خلا', 'حاشا',
  // ✅ More common filler words
  'الأرض', 'السماء', 'الدنيا', 'الآخرة', 'الحياة', 'الموت', 'العالم', 'المرأة', 'الرجل', 'الناس', 'الإنسان', 'القلب', 'العين', 'اليد', 'الوجه', 'الرأس', 'البيت', 'الدار', 'المكان', 'الزمان',
]);

// English stopwords for mixed content
const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because', 'although', 'though', 'while', 'where', 'after', 'before', 'when', 'since', 'until', 'unless', 'however', 'therefore', 'thus', 'hence', 'p', 'pp', 'vol', 'no', 'ed', 'et', 'al', 'ibid', 'op', 'cit', 'cf'
]);

interface TermFrequency {
  term: string;
  count: number;
  pages: number[];
}

interface CategorizedTerm {
  term: string;
  count: number;
  pages: number[];
  category: 'concept' | 'name' | 'technical' | 'place' | 'other';
  categoryAr: string;
  importance: 'high' | 'medium' | 'low';
}

interface TerminologyResponse {
  documentNames: string[];
  totalTerms: number;
  totalChunks: number;
  terms: CategorizedTerm[];
  categories: {
    concepts: CategorizedTerm[];
    names: CategorizedTerm[];
    technical: CategorizedTerm[];
    places: CategorizedTerm[];
    other: CategorizedTerm[];
  };
  stats: {
    conceptCount: number;
    nameCount: number;
    technicalCount: number;
    placeCount: number;
    otherCount: number;
  };
}

/**
 * Normalize Arabic text for better matching
 */
function normalizeArabic(text: string): string {
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْ]/g, '') // Remove tashkeel
    .trim();
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  // Split by whitespace and punctuation
  const tokens = text
    .replace(/[.,،!?؟:;٬٪٫()[\]{}""«»"'\-–—]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1); // Filter single characters
  
  return tokens;
}

/**
 * Check if a word is a stopword
 */
function isStopword(word: string): boolean {
  const normalized = normalizeArabic(word.toLowerCase());
  return ARABIC_STOPWORDS.has(normalized) || 
         ARABIC_STOPWORDS.has(word) ||
         ENGLISH_STOPWORDS.has(word.toLowerCase()) ||
         /^\d+$/.test(word) || // Pure numbers
         word.length < 2; // Single characters
}

/**
 * Extract term frequencies from chunks
 */
function extractTermFrequencies(
  chunks: Array<{ chunk_text: string; page_number: number }>
): TermFrequency[] {
  const termMap = new Map<string, { count: number; pages: Set<number> }>();
  
  for (const chunk of chunks) {
    const tokens = tokenize(chunk.chunk_text);
    const seenInChunk = new Set<string>();
    
    for (const token of tokens) {
      if (isStopword(token)) continue;
      
      // Use original form as key (preserve case for names)
      const key = token;
      
      if (!seenInChunk.has(key)) {
        seenInChunk.add(key);
        
        if (!termMap.has(key)) {
          termMap.set(key, { count: 0, pages: new Set() });
        }
        
        const entry = termMap.get(key)!;
        entry.count++;
        entry.pages.add(chunk.page_number);
      }
    }
  }
  
  // Convert to array and sort by frequency
  const terms: TermFrequency[] = [];
  for (const [term, data] of termMap) {
    terms.push({
      term,
      count: data.count,
      pages: Array.from(data.pages).sort((a, b) => a - b)
    });
  }
  
  // Sort by count descending
  terms.sort((a, b) => b.count - a.count);
  
  return terms;
}

/**
 * Use AI to categorize and filter terms
 */
async function categorizeTermsWithAI(
  terms: TermFrequency[],
  documentLanguage: string = 'ar'
): Promise<CategorizedTerm[]> {
  // Take top 200 terms for AI analysis
  const topTerms = terms.slice(0, 200);
  
  const termsList = topTerms.map(t => `${t.term} (${t.count}×)`).join('\n');
  
  const prompt = documentLanguage === 'ar' 
    ? `أنت خبير في تحليل المصطلحات والمفاهيم في النصوص العربية والإسلامية.

فيما يلي قائمة بأكثر الكلمات تكراراً في نص علمي/ديني (مع عدد مرات الورود):

${termsList}

مهمتك:
1. حدد المصطلحات والمفاهيم المهمة (تجاهل الكلمات العامة والشائعة)
2. صنف كل مصطلح مهم إلى إحدى الفئات: concept (مفهوم), name (علم/شخصية), technical (مصطلح فني), place (مكان)
3. حدد أهمية كل مصطلح: high (عالية), medium (متوسطة), low (منخفضة)

أجب بصيغة JSON فقط:
{
  "terms": [
    {"term": "الكلمة", "category": "concept", "importance": "high"},
    ...
  ]
}

ملاحظات مهمة:
- اختر فقط المصطلحات ذات المعنى والأهمية العلمية
- تجاهل الكلمات العامة مثل: كتاب، قال، ذكر، باب، فصل، إلخ
- ركز على المفاهيم والمصطلحات التي تمثل أفكاراً رئيسية
- حدد ما لا يزيد عن 80 مصطلحاً من الأكثر أهمية`
    : `You are an expert at analyzing terminology and concepts in academic texts.

Here is a list of the most frequent words in an academic/scholarly text (with occurrence counts):

${termsList}

Your task:
1. Identify important terms and concepts (ignore common/generic words)
2. Categorize each important term: concept, name (person), technical (specialized term), place
3. Rate importance: high, medium, low

Respond in JSON only:
{
  "terms": [
    {"term": "word", "category": "concept", "importance": "high"},
    ...
  ]
}

Important:
- Select only meaningful, academically significant terms
- Ignore generic words like: book, said, chapter, section, etc.
- Focus on concepts representing key ideas
- Select no more than 80 most important terms`;

  try {
    // ✅ Try models with fallback
    let response = '';
    let lastError: Error | null = null;
    
    for (const modelName of CHAT_MODELS) {
      try {
        console.log(`🤖 [Terminology] Trying model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        response = result.response.text();
        console.log(`✅ [Terminology] Success with ${modelName}`);
        break;
      } catch (error: any) {
        console.warn(`⚠️ [Terminology] ${modelName} failed:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    if (!response && lastError) {
      throw lastError;
    }
    
    // Parse JSON from response with cleanup
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in AI response');
      return topTerms.slice(0, 50).map(t => ({
        ...t,
        category: 'other' as const,
        categoryAr: 'أخرى',
        importance: 'medium' as const
      }));
    }
    
    // Clean up common JSON issues from AI responses
    let jsonStr = jsonMatch[0];
    // Remove trailing commas before ] or }
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    // Fix unescaped quotes in strings (basic attempt)
    jsonStr = jsonStr.replace(/:\s*"([^"]*)"([^,}\]]*)"([^"]*?)"/g, ': "$1\'$2\'$3"');
    
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse failed, attempting extraction of terms array...');
      // Try to extract just the terms array
      const termsMatch = response.match(/"terms"\s*:\s*\[([\s\S]*?)\]/);
      if (termsMatch) {
        try {
          // Parse individual term objects
          const termObjects = termsMatch[1].match(/\{[^{}]+\}/g) || [];
          const terms = [];
          for (const obj of termObjects) {
            try {
              const cleanObj = obj.replace(/,\s*([}\]])/g, '$1');
              terms.push(JSON.parse(cleanObj));
            } catch {
              // Skip malformed objects
            }
          }
          parsed = { terms };
        } catch {
          parsed = { terms: [] };
        }
      } else {
        parsed = { terms: [] };
      }
    }
    
    const aiTerms = new Map<string, { category: string; importance: string }>();
    
    for (const t of parsed.terms || []) {
      aiTerms.set(normalizeArabic(t.term), {
        category: t.category,
        importance: t.importance
      });
    }
    
    // Map AI results back to frequency data
    const categorized: CategorizedTerm[] = [];
    
    for (const term of topTerms) {
      const normalized = normalizeArabic(term.term);
      const aiData = aiTerms.get(normalized);
      
      if (aiData) {
        const categoryMap: Record<string, string> = {
          concept: 'مفهوم',
          name: 'علم/شخصية',
          technical: 'مصطلح فني',
          place: 'مكان',
          other: 'أخرى'
        };
        
        categorized.push({
          ...term,
          category: aiData.category as CategorizedTerm['category'],
          categoryAr: categoryMap[aiData.category] || 'أخرى',
          importance: aiData.importance as CategorizedTerm['importance']
        });
      }
    }
    
    // Sort by importance then count
    const importanceOrder = { high: 0, medium: 1, low: 2 };
    categorized.sort((a, b) => {
      const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
      if (impDiff !== 0) return impDiff;
      return b.count - a.count;
    });
    
    return categorized;
    
  } catch (error) {
    console.error('AI categorization error:', error);
    // Fallback: return top terms as uncategorized
    return topTerms.slice(0, 50).map(t => ({
      ...t,
      category: 'other' as const,
      categoryAr: 'أخرى',
      importance: 'medium' as const
    }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const { documentIds, bookId } = await req.json();
    
    const ids = documentIds || (bookId ? [bookId] : []);
    
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: 'Document IDs required' }, { status: 400 });
    }
    
    console.log(`🔤 Starting terminology analysis for ${ids.length} document(s)`);
    
    // Fetch all chunks for the documents
    const { data: chunks, error } = await supabaseAdmin
      .from('embeddings')
      .select('chunk_text, page_number, document_id')
      .in('document_id', ids)
      .order('page_number', { ascending: true });
    
    if (error) {
      console.error('Error fetching chunks:', error);
      return NextResponse.json({ error: 'Failed to fetch document content' }, { status: 500 });
    }
    
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ error: 'No content found for these documents' }, { status: 404 });
    }
    
    console.log(`📚 Processing ${chunks.length} chunks`);
    
    // Get document names
    const { data: docs } = await supabaseAdmin
      .from('embeddings')
      .select('document_id')
      .in('document_id', ids);
    
    // Extract term frequencies
    const termFrequencies = extractTermFrequencies(chunks);
    console.log(`📊 Found ${termFrequencies.length} unique terms`);
    
    // Detect language from first few chunks
    const sampleText = chunks.slice(0, 5).map(c => c.chunk_text).join(' ');
    const isArabic = /[\u0600-\u06FF]/.test(sampleText);
    const language = isArabic ? 'ar' : 'en';
    
    // Use AI to categorize terms
    console.log('🤖 Categorizing terms with AI...');
    const categorizedTerms = await categorizeTermsWithAI(termFrequencies, language);
    console.log(`✅ Categorized ${categorizedTerms.length} important terms`);
    
    // Group by category
    const categories = {
      concepts: categorizedTerms.filter(t => t.category === 'concept'),
      names: categorizedTerms.filter(t => t.category === 'name'),
      technical: categorizedTerms.filter(t => t.category === 'technical'),
      places: categorizedTerms.filter(t => t.category === 'place'),
      other: categorizedTerms.filter(t => t.category === 'other')
    };
    
    const response: TerminologyResponse = {
      documentNames: ids,
      totalTerms: categorizedTerms.length,
      totalChunks: chunks.length,
      terms: categorizedTerms,
      categories,
      stats: {
        conceptCount: categories.concepts.length,
        nameCount: categories.names.length,
        technicalCount: categories.technical.length,
        placeCount: categories.places.length,
        otherCount: categories.other.length
      }
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Terminology analysis error:', error);
    return NextResponse.json({ 
      error: 'Failed to analyze terminology',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
