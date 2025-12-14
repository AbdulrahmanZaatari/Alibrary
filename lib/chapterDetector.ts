import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const DETECTION_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it', 
  'gemini-2.5-flash-lite',
];

/**
 * ✅ Chapter/Story Metadata for chunks
 */
export interface ChapterMetadata {
  chapterNumber?: number;
  chapterTitle?: string;
  storyNumber?: number;
  storyTitle?: string;
  sectionName?: string;
  partNumber?: number;
  isNewChapter: boolean;
  isNewStory: boolean;
  narrativeContext?: string;  // e.g., "Story about Adam in the garden"
  mainCharacters?: string[];  // Characters mentioned in this section
  setting?: string;           // Time/place setting
  themes?: string[];          // Literary themes detected
}

/**
 * ✅ Arabic chapter/story markers
 */
const ARABIC_CHAPTER_MARKERS = [
  // Chapter patterns
  /الفصل\s*(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)/,
  /الباب\s*(الأول|الثاني|الثالث|الرابع|الخامس|\d+)/,
  /القسم\s*(الأول|الثاني|الثالث|\d+)/,
  /الجزء\s*(الأول|الثاني|الثالث|\d+)/,
  
  // Story patterns (for short story collections)
  /القصة\s*(الأولى|الثانية|الثالثة|الرابعة|الخامسة|\d+)/,
  /قصة\s*[:：]?\s*(.+)/,
  /حكاية\s*[:：]?\s*(.+)/,
  /رواية\s*[:：]?\s*(.+)/,
  
  // Numbered patterns
  /^\s*(\d+)\s*[-–—\.]\s*(.+)/,
  /^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)/,
  
  // Section dividers
  /^\s*[★☆◆◇●○■□▲△]\s*(.+)/,
  /^\s*\*{3,}\s*$/,
  /^\s*[-–—]{3,}\s*$/,
];

/**
 * ✅ English chapter/story markers
 */
const ENGLISH_CHAPTER_MARKERS = [
  // Chapter patterns
  /Chapter\s+(\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)/i,
  /Part\s+(\d+|One|Two|Three|Four|Five)/i,
  /Section\s+(\d+)/i,
  /Book\s+(\d+|One|Two|Three)/i,
  
  // Story patterns
  /Story\s*[:：]?\s*(.+)/i,
  /Tale\s*[:：]?\s*(.+)/i,
  /^\s*(\d+)\s*[-–—\.]\s*(.+)/,
  
  // Section dividers
  /^\s*\*{3,}\s*$/,
  /^\s*[-–—]{3,}\s*$/,
];

/**
 * ✅ Arabic ordinal to number mapping
 */
const ARABIC_ORDINALS: Record<string, number> = {
  'الأول': 1, 'الأولى': 1,
  'الثاني': 2, 'الثانية': 2,
  'الثالث': 3, 'الثالثة': 3,
  'الرابع': 4, 'الرابعة': 4,
  'الخامس': 5, 'الخامسة': 5,
  'السادس': 6, 'السادسة': 6,
  'السابع': 7, 'السابعة': 7,
  'الثامن': 8, 'الثامنة': 8,
  'التاسع': 9, 'التاسعة': 9,
  'العاشر': 10, 'العاشرة': 10,
};

/**
 * ✅ English ordinal to number mapping
 */
const ENGLISH_ORDINALS: Record<string, number> = {
  'one': 1, 'first': 1,
  'two': 2, 'second': 2,
  'three': 3, 'third': 3,
  'four': 4, 'fourth': 4,
  'five': 5, 'fifth': 5,
  'six': 6, 'sixth': 6,
  'seven': 7, 'seventh': 7,
  'eight': 8, 'eighth': 8,
  'nine': 9, 'ninth': 9,
  'ten': 10, 'tenth': 10,
};

/**
 * ✅ Detect chapter/story boundaries in text using patterns
 */
export function detectChapterBoundary(
  text: string,
  language: 'ar' | 'en'
): { isNewSection: boolean; sectionType: 'chapter' | 'story' | 'part' | 'section' | null; number: number | null; title: string | null } {
  const markers = language === 'ar' ? ARABIC_CHAPTER_MARKERS : ENGLISH_CHAPTER_MARKERS;
  const ordinals = language === 'ar' ? ARABIC_ORDINALS : ENGLISH_ORDINALS;
  
  // Check first 200 characters for chapter markers
  const checkText = text.substring(0, 200);
  
  for (const pattern of markers) {
    const match = checkText.match(pattern);
    if (match) {
      let sectionType: 'chapter' | 'story' | 'part' | 'section' = 'section';
      let number: number | null = null;
      let title: string | null = null;
      
      // Determine section type
      if (/chapter|فصل|باب/i.test(pattern.source)) {
        sectionType = 'chapter';
      } else if (/story|قصة|حكاية|رواية|tale/i.test(pattern.source)) {
        sectionType = 'story';
      } else if (/part|جزء|قسم/i.test(pattern.source)) {
        sectionType = 'part';
      }
      
      // Extract number
      if (match[1]) {
        const numStr = match[1].toLowerCase();
        if (/^\d+$/.test(numStr)) {
          number = parseInt(numStr);
        } else if (ordinals[numStr]) {
          number = ordinals[numStr];
        }
      }
      
      // Extract title
      if (match[2]) {
        title = match[2].trim();
      } else if (match[1] && !/^\d+$/.test(match[1]) && !ordinals[match[1].toLowerCase()]) {
        title = match[1].trim();
      }
      
      return { isNewSection: true, sectionType, number, title };
    }
  }
  
  // Check for section dividers (*** or ---)
  if (/^\s*[\*\-–—]{3,}\s*$/.test(checkText.split('\n')[0])) {
    return { isNewSection: true, sectionType: 'section', number: null, title: null };
  }
  
  return { isNewSection: false, sectionType: null, number: null, title: null };
}

/**
 * ✅ AI-powered chapter/story detection for ambiguous cases
 */
export async function detectChapterWithAI(
  text: string,
  previousContext: string,
  language: 'ar' | 'en'
): Promise<ChapterMetadata> {
  const prompt = language === 'ar'
    ? `أنت محلل أدبي. حلل النص التالي وحدد:

**النص السابق (للسياق):**
${previousContext.substring(0, 300)}...

**النص الحالي:**
${text.substring(0, 500)}...

**حدد:**
1. هل هذا فصل جديد أو قصة جديدة؟
2. رقم الفصل/القصة (إن وجد)
3. عنوان الفصل/القصة
4. الشخصيات الرئيسية المذكورة
5. المكان والزمان
6. الموضوعات الأدبية

أجب بتنسيق JSON:
{
  "isNewChapter": true/false,
  "isNewStory": true/false,
  "chapterNumber": null أو رقم,
  "chapterTitle": "العنوان" أو null,
  "storyNumber": null أو رقم,
  "storyTitle": "عنوان القصة" أو null,
  "mainCharacters": ["شخصية1", "شخصية2"],
  "setting": "المكان والزمان",
  "themes": ["موضوع1", "موضوع2"],
  "narrativeContext": "ملخص قصير للسياق"
}`
    : `You are a literary analyst. Analyze the following text and determine:

**Previous text (for context):**
${previousContext.substring(0, 300)}...

**Current text:**
${text.substring(0, 500)}...

**Determine:**
1. Is this a new chapter or new story?
2. Chapter/story number (if any)
3. Chapter/story title
4. Main characters mentioned
5. Setting (time/place)
6. Literary themes

Respond in JSON format:
{
  "isNewChapter": true/false,
  "isNewStory": true/false,
  "chapterNumber": null or number,
  "chapterTitle": "title" or null,
  "storyNumber": null or number,
  "storyTitle": "story title" or null,
  "mainCharacters": ["character1", "character2"],
  "setting": "time and place",
  "themes": ["theme1", "theme2"],
  "narrativeContext": "brief context summary"
}`;

  for (const modelName of DETECTION_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.2 }
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isNewChapter: parsed.isNewChapter || false,
          isNewStory: parsed.isNewStory || false,
          chapterNumber: parsed.chapterNumber || undefined,
          chapterTitle: parsed.chapterTitle || undefined,
          storyNumber: parsed.storyNumber || undefined,
          storyTitle: parsed.storyTitle || undefined,
          mainCharacters: parsed.mainCharacters || [],
          setting: parsed.setting || undefined,
          themes: parsed.themes || [],
          narrativeContext: parsed.narrativeContext || undefined,
        };
      }
    } catch {
      console.warn(`⚠️ Chapter detection with ${modelName} failed`);
    }
  }

  return {
    isNewChapter: false,
    isNewStory: false,
  };
}

/**
 * ✅ Extract character names from text
 */
export function extractCharacterNames(
  text: string,
  language: 'ar' | 'en'
): string[] {
  const characters: Set<string> = new Set();
  
  if (language === 'ar') {
    // Arabic name patterns
    const patterns = [
      // Names with "قال X" or "قالت X"
      /(?:قال|قالت)\s+([أ-ي]+(?:\s+[أ-ي]+)?)/g,
      // Names after "يا" (calling)
      /يا\s+([أ-ي]+)/g,
      // Common Islamic/Arabic name patterns
      /\b(آدم|إبراهيم|موسى|عيسى|محمد|فاطمة|خديجة|عائشة|مريم|يوسف|يعقوب|إسماعيل|إسحاق)\b/g,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[1].length > 2) {
          characters.add(match[1].trim());
        }
      }
    }
  } else {
    // English name patterns (capitalized words that look like names)
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    let match;
    while ((match = namePattern.exec(text)) !== null) {
      // Filter out common non-names
      const name = match[1];
      const nonNames = ['The', 'This', 'That', 'Chapter', 'Part', 'Section', 'Story', 'Once', 'When', 'Then', 'After', 'Before'];
      if (!nonNames.includes(name)) {
        characters.add(name);
      }
    }
  }
  
  return Array.from(characters).slice(0, 10); // Limit to 10 characters
}

/**
 * ✅ Track chapter state across pages for consistent numbering
 */
export class ChapterTracker {
  private currentChapter: number = 0;
  private currentStory: number = 0;
  private currentChapterTitle: string | null = null;
  private currentStoryTitle: string | null = null;
  private previousText: string = '';
  
  /**
   * Update state when a new chapter/story is detected
   */
  updateState(metadata: ChapterMetadata): void {
    if (metadata.isNewChapter) {
      this.currentChapter = metadata.chapterNumber || (this.currentChapter + 1);
      this.currentChapterTitle = metadata.chapterTitle || null;
    }
    
    if (metadata.isNewStory) {
      this.currentStory = metadata.storyNumber || (this.currentStory + 1);
      this.currentStoryTitle = metadata.storyTitle || null;
    }
  }
  
  /**
   * Get current state
   */
  getCurrentState(): { chapter: number; story: number; chapterTitle: string | null; storyTitle: string | null } {
    return {
      chapter: this.currentChapter,
      story: this.currentStory,
      chapterTitle: this.currentChapterTitle,
      storyTitle: this.currentStoryTitle,
    };
  }
  
  /**
   * Set previous text for context
   */
  setPreviousText(text: string): void {
    this.previousText = text;
  }
  
  /**
   * Get previous text
   */
  getPreviousText(): string {
    return this.previousText;
  }
}

/**
 * ✅ Enrich chunk with chapter/story metadata
 */
export async function enrichChunkWithChapterInfo(
  chunkText: string,
  pageNumber: number,
  chunkIndex: number,
  language: 'ar' | 'en',
  tracker: ChapterTracker
): Promise<ChapterMetadata> {
  console.log(`   📖 Detecting chapter/story for page ${pageNumber}, chunk ${chunkIndex + 1}...`);
  
  // First try pattern-based detection
  const patternResult = detectChapterBoundary(chunkText, language);
  
  if (patternResult.isNewSection) {
    console.log(`   ✅ Pattern detected: ${patternResult.sectionType} ${patternResult.number || ''} "${patternResult.title || ''}"`);
    
    const metadata: ChapterMetadata = {
      isNewChapter: patternResult.sectionType === 'chapter' || patternResult.sectionType === 'part',
      isNewStory: patternResult.sectionType === 'story',
      chapterNumber: patternResult.sectionType === 'chapter' ? patternResult.number || undefined : undefined,
      chapterTitle: patternResult.sectionType === 'chapter' ? patternResult.title || undefined : undefined,
      storyNumber: patternResult.sectionType === 'story' ? patternResult.number || undefined : undefined,
      storyTitle: patternResult.sectionType === 'story' ? patternResult.title || undefined : undefined,
      sectionName: patternResult.title || undefined,
      mainCharacters: extractCharacterNames(chunkText, language),
    };
    
    tracker.updateState(metadata);
    tracker.setPreviousText(chunkText);
    
    return metadata;
  }
  
  // For chunks without clear markers, inherit from tracker
  const currentState = tracker.getCurrentState();
  const characters = extractCharacterNames(chunkText, language);
  
  tracker.setPreviousText(chunkText);
  
  return {
    isNewChapter: false,
    isNewStory: false,
    chapterNumber: currentState.chapter || undefined,
    chapterTitle: currentState.chapterTitle || undefined,
    storyNumber: currentState.story || undefined,
    storyTitle: currentState.storyTitle || undefined,
    mainCharacters: characters,
  };
}

/**
 * ✅ Format chapter info for display
 */
export function formatChapterInfo(metadata: ChapterMetadata, language: 'ar' | 'en'): string {
  const parts: string[] = [];
  
  if (language === 'ar') {
    if (metadata.chapterNumber) {
      parts.push(`الفصل ${metadata.chapterNumber}${metadata.chapterTitle ? ': ' + metadata.chapterTitle : ''}`);
    }
    if (metadata.storyNumber) {
      parts.push(`القصة ${metadata.storyNumber}${metadata.storyTitle ? ': ' + metadata.storyTitle : ''}`);
    }
    if (metadata.mainCharacters && metadata.mainCharacters.length > 0) {
      parts.push(`الشخصيات: ${metadata.mainCharacters.join('، ')}`);
    }
  } else {
    if (metadata.chapterNumber) {
      parts.push(`Chapter ${metadata.chapterNumber}${metadata.chapterTitle ? ': ' + metadata.chapterTitle : ''}`);
    }
    if (metadata.storyNumber) {
      parts.push(`Story ${metadata.storyNumber}${metadata.storyTitle ? ': ' + metadata.storyTitle : ''}`);
    }
    if (metadata.mainCharacters && metadata.mainCharacters.length > 0) {
      parts.push(`Characters: ${metadata.mainCharacters.join(', ')}`);
    }
  }
  
  return parts.join(' | ');
}
