import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const ANALYSIS_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
];

/**
 * ✅ Metadata enrichment for chunks
 * Extracts structural information like chapters, sections, topics, entities
 */
export interface EnrichedMetadata {
  section?: string;           // e.g., "Chapter 2", "الفصل الثاني"
  sectionType?: 'chapter' | 'section' | 'subsection' | 'story' | 'hadith' | 'verse' | 'introduction' | 'conclusion';
  topics: string[];           // Main topics discussed
  entities: {
    persons: string[];        // People mentioned
    places: string[];         // Locations
    dates: string[];          // Dates/time periods
    concepts: string[];       // Islamic concepts, terms
  };
  keywords: string[];         // Important keywords
  summary?: string;           // One-line summary
  language: 'ar' | 'en';
  confidence: number;
}

/**
 * ✅ Detect section/chapter from text patterns
 */
function detectSectionFromPatterns(text: string): { section?: string; sectionType?: string } {
  const patterns = [
    // Arabic chapter patterns
    { regex: /الفصل\s*(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)/i, type: 'chapter' },
    { regex: /الباب\s*(الأول|الثاني|الثالث|الرابع|الخامس|\d+)/i, type: 'chapter' },
    { regex: /القسم\s*(الأول|الثاني|الثالث|\d+)/i, type: 'section' },
    { regex: /المبحث\s*(الأول|الثاني|الثالث|\d+)/i, type: 'subsection' },
    { regex: /القصة\s*(الأولى|الثانية|الثالثة|\d+)/i, type: 'story' },
    { regex: /الحديث\s*(الأول|الثاني|الثالث|\d+)/i, type: 'hadith' },
    { regex: /سورة\s+[\u0600-\u06FF]+/i, type: 'verse' },
    { regex: /المقدمة/i, type: 'introduction' },
    { regex: /الخاتمة/i, type: 'conclusion' },
    
    // English chapter patterns
    { regex: /Chapter\s*(\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)/i, type: 'chapter' },
    { regex: /Section\s*(\d+)/i, type: 'section' },
    { regex: /Part\s*(\d+|One|Two|Three)/i, type: 'chapter' },
    { regex: /Story\s*(\d+)/i, type: 'story' },
    { regex: /Introduction/i, type: 'introduction' },
    { regex: /Conclusion/i, type: 'conclusion' },
  ];

  for (const { regex, type } of patterns) {
    const match = text.match(regex);
    if (match) {
      return { section: match[0], sectionType: type };
    }
  }

  return {};
}

/**
 * ✅ Extract entities from text (rule-based for speed)
 */
function extractEntitiesQuick(text: string): EnrichedMetadata['entities'] {
  const entities: EnrichedMetadata['entities'] = {
    persons: [],
    places: [],
    dates: [],
    concepts: []
  };

  // Common Arabic/Islamic person indicators
  const personPatterns = [
    /(?:الشيخ|الإمام|الأستاذ|الدكتور|السيد|النبي|الرسول|الصحابي|الخليفة)\s+[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g,
    /(?:أبو|ابن|بن)\s+[\u0600-\u06FF]+/g,
    /صلى الله عليه وسلم/g,
    /رضي الله عنه/g,
  ];

  // Common Arabic place indicators
  const placePatterns = [
    /(?:مكة|المدينة|القدس|بغداد|دمشق|القاهرة|الكوفة|البصرة)/g,
    /(?:المكرمة|المنورة)/g,
    /(?:جبل|وادي|نهر|بحر)\s+[\u0600-\u06FF]+/g,
  ];

  // Date patterns
  const datePatterns = [
    /\b\d{1,4}\s*(?:هـ|ه|هجري|ميلادي|م)\b/g,
    /(?:سنة|عام)\s+\d+/g,
    /القرن\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|\d+)/g,
  ];

  // Islamic concepts
  const conceptPatterns = [
    /(?:التوحيد|الشريعة|الفقه|الحديث|السنة|القرآن|الإيمان|الإسلام|الصلاة|الزكاة|الصيام|الحج|الجهاد)/g,
    /(?:الأمر بالمعروف|النهي عن المنكر)/g,
    /(?:أهل السنة|أهل البيت)/g,
  ];

  for (const pattern of personPatterns) {
    const matches = text.match(pattern) || [];
    entities.persons.push(...matches);
  }

  for (const pattern of placePatterns) {
    const matches = text.match(pattern) || [];
    entities.places.push(...matches);
  }

  for (const pattern of datePatterns) {
    const matches = text.match(pattern) || [];
    entities.dates.push(...matches);
  }

  for (const pattern of conceptPatterns) {
    const matches = text.match(pattern) || [];
    entities.concepts.push(...matches);
  }

  // Deduplicate
  entities.persons = [...new Set(entities.persons)].slice(0, 10);
  entities.places = [...new Set(entities.places)].slice(0, 5);
  entities.dates = [...new Set(entities.dates)].slice(0, 5);
  entities.concepts = [...new Set(entities.concepts)].slice(0, 10);

  return entities;
}

/**
 * ✅ AI-powered metadata extraction for rich chunk context
 */
export async function extractChunkMetadata(
  chunkText: string,
  pageNumber: number,
  documentContext?: { title?: string; author?: string }
): Promise<EnrichedMetadata> {
  // Quick pattern-based extraction first
  const { section, sectionType } = detectSectionFromPatterns(chunkText);
  const quickEntities = extractEntitiesQuick(chunkText);
  
  // Detect language
  const arabicChars = (chunkText.match(/[\u0600-\u06FF]/g) || []).length;
  const language: 'ar' | 'en' = arabicChars / chunkText.length > 0.3 ? 'ar' : 'en';

  // For short chunks, use quick extraction only
  if (chunkText.length < 200) {
    return {
      section,
      sectionType: sectionType as EnrichedMetadata['sectionType'],
      topics: [],
      entities: quickEntities,
      keywords: [],
      language,
      confidence: 0.6
    };
  }

  // AI-powered extraction for richer metadata
  const prompt = language === 'ar'
    ? `حلل النص التالي واستخرج البيانات الوصفية.

**النص:**
${chunkText.substring(0, 1500)}

**استخرج بتنسيق JSON:**
{
  "section": "اسم الفصل أو القسم إن وجد",
  "sectionType": "chapter|section|story|hadith|introduction|conclusion",
  "topics": ["موضوع 1", "موضوع 2"],
  "keywords": ["كلمة 1", "كلمة 2", "كلمة 3"],
  "summary": "ملخص في جملة واحدة"
}

**JSON:**`
    : `Analyze the following text and extract metadata.

**Text:**
${chunkText.substring(0, 1500)}

**Extract in JSON format:**
{
  "section": "Chapter or section name if present",
  "sectionType": "chapter|section|story|hadith|introduction|conclusion",
  "topics": ["topic 1", "topic 2"],
  "keywords": ["keyword 1", "keyword 2", "keyword 3"],
  "summary": "One sentence summary"
}

**JSON:**`;

  for (const modelName of ANALYSIS_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { 
          temperature: 0.2,
          maxOutputTokens: 500
        }
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
          section: parsed.section || section,
          sectionType: (parsed.sectionType || sectionType) as EnrichedMetadata['sectionType'],
          topics: parsed.topics || [],
          entities: quickEntities,
          keywords: parsed.keywords || [],
          summary: parsed.summary,
          language,
          confidence: 0.85
        };
      }
    } catch (error) {
      console.warn(`⚠️ Metadata extraction with ${modelName} failed`);
    }
  }

  // Fallback to quick extraction
  return {
    section,
    sectionType: sectionType as EnrichedMetadata['sectionType'],
    topics: [],
    entities: quickEntities,
    keywords: [],
    language,
    confidence: 0.6
  };
}

/**
 * ✅ Batch metadata extraction for multiple chunks
 */
export async function enrichChunksWithMetadata(
  chunks: Array<{ chunkText: string; pageNumber: number }>,
  documentContext?: { title?: string; author?: string }
): Promise<Array<{ chunkText: string; pageNumber: number; metadata: EnrichedMetadata }>> {
  console.log(`📊 Enriching ${chunks.length} chunks with metadata...`);
  
  const enrichedChunks = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      // Use quick extraction for most chunks, AI for every 3rd chunk
      const useAI = i % 3 === 0;
      
      if (useAI) {
        const metadata = await extractChunkMetadata(
          chunk.chunkText,
          chunk.pageNumber,
          documentContext
        );
        enrichedChunks.push({ ...chunk, metadata });
      } else {
        // Quick pattern-based extraction
        const { section, sectionType } = detectSectionFromPatterns(chunk.chunkText);
        const entities = extractEntitiesQuick(chunk.chunkText);
        const arabicChars = (chunk.chunkText.match(/[\u0600-\u06FF]/g) || []).length;
        const language: 'ar' | 'en' = arabicChars / chunk.chunkText.length > 0.3 ? 'ar' : 'en';
        
        enrichedChunks.push({
          ...chunk,
          metadata: {
            section,
            sectionType: sectionType as EnrichedMetadata['sectionType'],
            topics: [],
            entities,
            keywords: [],
            language,
            confidence: 0.5
          }
        });
      }
    } catch (error) {
      // On error, add minimal metadata
      enrichedChunks.push({
        ...chunk,
        metadata: {
          topics: [],
          entities: { persons: [], places: [], dates: [], concepts: [] },
          keywords: [],
          language: 'ar' as const,
          confidence: 0.3
        }
      });
    }
  }

  console.log(`✅ Metadata enrichment complete`);
  return enrichedChunks;
}

/**
 * ✅ Format metadata for display/search
 */
export function formatMetadataForContext(metadata: EnrichedMetadata, language: 'ar' | 'en'): string {
  const parts: string[] = [];

  if (metadata.section) {
    parts.push(language === 'ar' ? `📑 ${metadata.section}` : `📑 ${metadata.section}`);
  }

  if (metadata.topics.length > 0) {
    const topicsLabel = language === 'ar' ? 'المواضيع' : 'Topics';
    parts.push(`${topicsLabel}: ${metadata.topics.slice(0, 3).join(', ')}`);
  }

  if (metadata.entities.persons.length > 0) {
    const personsLabel = language === 'ar' ? 'الأشخاص' : 'Persons';
    parts.push(`${personsLabel}: ${metadata.entities.persons.slice(0, 3).join(', ')}`);
  }

  if (metadata.entities.concepts.length > 0) {
    const conceptsLabel = language === 'ar' ? 'المفاهيم' : 'Concepts';
    parts.push(`${conceptsLabel}: ${metadata.entities.concepts.slice(0, 3).join(', ')}`);
  }

  return parts.join(' | ');
}
