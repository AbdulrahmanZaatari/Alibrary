/**
 * ✅ Literary-Enhanced Prompting System
 * 
 * This module provides prompts that make the AI:
 * 1. Understand symbolic/literary texts deeply
 * 2. Expand on ideas creatively while grounded in RAG
 * 3. Provide analysis, interpretation, and insights
 * 4. Handle chapter/story disambiguation
 */

export interface LiteraryContext {
  bookTitle?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  storyNumber?: number;
  storyTitle?: string;
  mainCharacters?: string[];
  themes?: string[];
  userSpecifiedContext?: string; // e.g., "in chapter 2" or "in the second story"
}

/**
 * ✅ Detect if user is specifying a chapter/story context in their query
 */
export function detectQueryContext(query: string): {
  chapterNumber?: number;
  storyNumber?: number;
  specificContext?: string;
} {
  const result: { chapterNumber?: number; storyNumber?: number; specificContext?: string } = {};
  
  // Arabic patterns
  const arabicPatterns = [
    { pattern: /في\s*الفصل\s*(الأول|الثاني|الثالث|الرابع|الخامس|\d+)/i, type: 'chapter' },
    { pattern: /في\s*القصة\s*(الأولى|الثانية|الثالثة|الرابعة|الخامسة|\d+)/i, type: 'story' },
    { pattern: /الفصل\s*(الأول|الثاني|الثالث|\d+)/i, type: 'chapter' },
    { pattern: /القصة\s*(الأولى|الثانية|الثالثة|\d+)/i, type: 'story' },
    { pattern: /الجزء\s*(الأول|الثاني|الثالث|\d+)/i, type: 'chapter' },
  ];
  
  // English patterns
  const englishPatterns = [
    { pattern: /in\s*chapter\s*(\d+|one|two|three|four|five)/i, type: 'chapter' },
    { pattern: /in\s*story\s*(\d+|one|two|three|four|five)/i, type: 'story' },
    { pattern: /in\s*the\s*(first|second|third|fourth|fifth)\s*chapter/i, type: 'chapter' },
    { pattern: /in\s*the\s*(first|second|third|fourth|fifth)\s*story/i, type: 'story' },
    { pattern: /chapter\s*(\d+)/i, type: 'chapter' },
    { pattern: /story\s*(\d+)/i, type: 'story' },
  ];
  
  const ordinals: Record<string, number> = {
    'الأول': 1, 'الأولى': 1, 'first': 1, 'one': 1,
    'الثاني': 2, 'الثانية': 2, 'second': 2, 'two': 2,
    'الثالث': 3, 'الثالثة': 3, 'third': 3, 'three': 3,
    'الرابع': 4, 'الرابعة': 4, 'fourth': 4, 'four': 4,
    'الخامس': 5, 'الخامسة': 5, 'fifth': 5, 'five': 5,
  };
  
  const allPatterns = [...arabicPatterns, ...englishPatterns];
  
  for (const { pattern, type } of allPatterns) {
    const match = query.match(pattern);
    if (match) {
      const numStr = match[1]?.toLowerCase();
      let num: number | undefined;
      
      if (/^\d+$/.test(numStr)) {
        num = parseInt(numStr);
      } else if (ordinals[numStr]) {
        num = ordinals[numStr];
      }
      
      if (num) {
        if (type === 'chapter') {
          result.chapterNumber = num;
          result.specificContext = `Chapter ${num}`;
        } else {
          result.storyNumber = num;
          result.specificContext = `Story ${num}`;
        }
      }
    }
  }
  
  return result;
}

/**
 * ✅ Build a literary-aware system prompt
 */
export function buildLiterarySystemPrompt(
  language: 'ar' | 'en',
  context?: LiteraryContext
): string {
  if (language === 'ar') {
    return `أنت محلل أدبي وناقد متخصص، لديك فهم عميق للنصوص العربية والرمزية والأدب الإسلامي.

**هويتك:**
- محلل أدبي يفهم الرمزية، الاستعارة، والصور البلاغية
- ناقد يستطيع ربط الأفكار وتوسيعها بإبداع
- باحث يستخدم المصادر للتأسيس مع إضافة قيمة تحليلية

**مهامك:**
1. **التحليل الأدبي:** افهم النصوص بعمق، لا تكتف بالنقل الحرفي
2. **التوسع الإبداعي:** أضف تفسيرات ورؤى مستندة للنص
3. **الربط الموضوعي:** اربط الأفكار ببعضها واستخلص المعاني
4. **الفهم الرمزي:** فسّر الرموز والاستعارات والإشارات
5. **السياق الثقافي:** ضع النص في سياقه الثقافي والأدبي

**قواعد مهمة:**
- إذا ذكر المستخدم "الفصل X" أو "القصة X"، ركز فقط على ذلك السياق
- إذا وجدت شخصيات بنفس الاسم في فصول مختلفة، وضّح الفرق
- لا تخلط بين سياقات القصص المختلفة
- استخدم المقتطفات كأساس لكن أضف قيمة تحليلية

${context?.chapterNumber ? `**السياق الحالي:** الفصل ${context.chapterNumber}${context.chapterTitle ? ' - ' + context.chapterTitle : ''}` : ''}
${context?.storyNumber ? `**القصة الحالية:** القصة ${context.storyNumber}${context.storyTitle ? ' - ' + context.storyTitle : ''}` : ''}
${context?.mainCharacters?.length ? `**الشخصيات المذكورة:** ${context.mainCharacters.join('، ')}` : ''}`;
  }
  
  return `You are a literary analyst and critic with deep understanding of symbolic texts, narrative structures, and literary interpretation.

**Your Identity:**
- A literary analyst who understands symbolism, metaphor, and imagery
- A critic who can connect and expand ideas creatively
- A researcher who uses sources for grounding while adding analytical value

**Your Tasks:**
1. **Literary Analysis:** Understand texts deeply, don't just quote literally
2. **Creative Expansion:** Add interpretations and insights grounded in the text
3. **Thematic Connection:** Connect ideas and extract meanings
4. **Symbolic Understanding:** Interpret symbols, metaphors, and allusions
5. **Cultural Context:** Place texts in their cultural and literary context

**Important Rules:**
- If user mentions "Chapter X" or "Story X", focus ONLY on that context
- If you find characters with the same name in different chapters, clarify the difference
- Do NOT mix contexts from different stories
- Use excerpts as foundation but ADD analytical value

${context?.chapterNumber ? `**Current Context:** Chapter ${context.chapterNumber}${context.chapterTitle ? ' - ' + context.chapterTitle : ''}` : ''}
${context?.storyNumber ? `**Current Story:** Story ${context.storyNumber}${context.storyTitle ? ' - ' + context.storyTitle : ''}` : ''}
${context?.mainCharacters?.length ? `**Characters Mentioned:** ${context.mainCharacters.join(', ')}` : ''}`;
}

/**
 * ✅ Build a prompt that encourages literary analysis
 */
export function buildLiteraryQueryPrompt(
  query: string,
  chunks: Array<{
    chunk_text: string;
    page_number: number;
    metadata?: {
      chapter_number?: number;
      chapter_title?: string;
      story_number?: number;
      story_title?: string;
      main_characters?: string[];
    };
  }>,
  language: 'ar' | 'en',
  context?: LiteraryContext
): string {
  // Filter chunks by chapter/story if specified
  let filteredChunks = chunks;
  if (context?.chapterNumber) {
    filteredChunks = chunks.filter(c => 
      c.metadata?.chapter_number === context.chapterNumber
    );
    // If no chunks match, use all (might not have metadata)
    if (filteredChunks.length === 0) filteredChunks = chunks;
  }
  if (context?.storyNumber) {
    filteredChunks = chunks.filter(c => 
      c.metadata?.story_number === context.storyNumber
    );
    if (filteredChunks.length === 0) filteredChunks = chunks;
  }

  // Group chunks by chapter/story for clarity
  const groupedChunks = new Map<string, typeof chunks>();
  for (const chunk of filteredChunks) {
    const key = chunk.metadata?.chapter_number 
      ? `Chapter ${chunk.metadata.chapter_number}` 
      : chunk.metadata?.story_number 
        ? `Story ${chunk.metadata.story_number}` 
        : 'General';
    
    if (!groupedChunks.has(key)) {
      groupedChunks.set(key, []);
    }
    groupedChunks.get(key)!.push(chunk);
  }

  // Build context string with clear section markers
  let contextString = '';
  for (const [section, sectionChunks] of groupedChunks) {
    if (language === 'ar') {
      contextString += `\n\n**📚 ${section === 'General' ? 'مقتطفات' : section}:**\n`;
    } else {
      contextString += `\n\n**📚 ${section === 'General' ? 'Excerpts' : section}:**\n`;
    }
    
    for (const chunk of sectionChunks) {
      const pageLabel = language === 'ar' ? `صفحة ${chunk.page_number}` : `Page ${chunk.page_number}`;
      const characters = chunk.metadata?.main_characters?.length 
        ? ` | ${language === 'ar' ? 'شخصيات' : 'Characters'}: ${chunk.metadata.main_characters.join(', ')}`
        : '';
      
      contextString += `\n**📄 ${pageLabel}${characters}**\n${chunk.chunk_text}\n`;
    }
  }

  if (language === 'ar') {
    return `**سؤال المستخدم:**
${query}

**المقتطفات المتاحة:**
${contextString}

**تعليمات الإجابة:**
1. حلل النص أدبياً - لا تكتف بالاقتباس
2. فسّر الرموز والمعاني العميقة
3. وسّع الأفكار بإبداع مع الاستناد للنص
4. إذا وجدت تناقضات بين فصول/قصص مختلفة، وضّح ذلك
5. أضف قيمة تحليلية - لا تكن مجرد أداة استرجاع
6. استخدم تنسيق Markdown

**إجابتك التحليلية:**`;
  }

  return `**User's Question:**
${query}

**Available Excerpts:**
${contextString}

**Response Instructions:**
1. Analyze the text literarily - don't just quote
2. Interpret symbols and deeper meanings
3. Expand ideas creatively while grounding in the text
4. If you find contradictions between different chapters/stories, clarify that
5. Add analytical value - don't be just a retrieval tool
6. Use Markdown formatting

**Your Analytical Response:**`;
}

/**
 * ✅ Build disambiguation prompt when multiple contexts detected
 */
export function buildDisambiguationPrompt(
  query: string,
  conflictingChunks: Array<{
    chunk_text: string;
    page_number: number;
    metadata?: {
      chapter_number?: number;
      story_number?: number;
      story_title?: string;
      main_characters?: string[];
    };
  }>,
  language: 'ar' | 'en'
): string {
  // Group by story/chapter
  const contexts = new Map<string, typeof conflictingChunks>();
  for (const chunk of conflictingChunks) {
    const key = chunk.metadata?.story_number 
      ? `Story ${chunk.metadata.story_number}` 
      : chunk.metadata?.chapter_number 
        ? `Chapter ${chunk.metadata.chapter_number}` 
        : `Page ${chunk.page_number}`;
    
    if (!contexts.has(key)) {
      contexts.set(key, []);
    }
    contexts.get(key)!.push(chunk);
  }

  let contextSummary = '';
  for (const [context, chunks] of contexts) {
    const preview = chunks[0].chunk_text.substring(0, 150);
    const characters = chunks[0].metadata?.main_characters?.join(', ') || 'Unknown';
    
    if (language === 'ar') {
      contextSummary += `\n- **${context}** (${chunks.length} مقتطفات، شخصيات: ${characters})\n  "${preview}..."`;
    } else {
      contextSummary += `\n- **${context}** (${chunks.length} excerpts, characters: ${characters})\n  "${preview}..."`;
    }
  }

  if (language === 'ar') {
    return `⚠️ **تنبيه: وجدت معلومات من سياقات مختلفة**

سؤالك "${query}" يتعلق بموضوع يظهر في عدة فصول/قصص:
${contextSummary}

هل تقصد سياقاً محدداً؟ يمكنك توضيح مثل:
- "في القصة الثانية..."
- "في الفصل الأول..."

أو سأحلل جميع السياقات مع توضيح الفروقات.`;
  }

  return `⚠️ **Notice: Found information from different contexts**

Your question "${query}" relates to a topic that appears in multiple chapters/stories:
${contextSummary}

Do you mean a specific context? You can clarify like:
- "In the second story..."
- "In chapter one..."

Or I'll analyze all contexts while clarifying the differences.`;
}

/**
 * ✅ Detect if chunks have conflicting contexts (same character name in different stories)
 */
export function detectContextConflicts(
  chunks: Array<{
    metadata?: {
      chapter_number?: number;
      story_number?: number;
      main_characters?: string[];
    };
  }>
): { hasConflict: boolean; conflictingCharacters: string[] } {
  const characterContexts = new Map<string, Set<number>>();
  
  for (const chunk of chunks) {
    const storyNum = chunk.metadata?.story_number || chunk.metadata?.chapter_number || 0;
    const characters = chunk.metadata?.main_characters || [];
    
    for (const char of characters) {
      if (!characterContexts.has(char)) {
        characterContexts.set(char, new Set());
      }
      characterContexts.get(char)!.add(storyNum);
    }
  }
  
  const conflictingCharacters: string[] = [];
  for (const [char, contexts] of characterContexts) {
    if (contexts.size > 1 && contexts.has(0) === false) {
      // Character appears in multiple numbered stories
      conflictingCharacters.push(char);
    }
  }
  
  return {
    hasConflict: conflictingCharacters.length > 0,
    conflictingCharacters,
  };
}

/**
 * ✅ Build an enhanced prompt for symbolic/allegorical texts
 */
export function buildSymbolicAnalysisPrompt(
  query: string,
  text: string,
  language: 'ar' | 'en'
): string {
  if (language === 'ar') {
    return `أنت محلل أدبي متخصص في الرمزية والاستعارة.

**النص:**
${text}

**السؤال:**
${query}

**حلل النص من خلال:**

1. **المستوى الظاهري:** ما الذي يحدث حرفياً؟
2. **المستوى الرمزي:** ما الذي ترمز إليه الشخصيات والأحداث؟
3. **المستوى الفلسفي:** ما الأفكار والمفاهيم العميقة؟
4. **المستوى الروحي/الصوفي:** هل هناك معانٍ روحية أو صوفية؟

**أضف:**
- تفسيرات إبداعية مع الاستناد للنص
- ربط بمفاهيم أدبية وفلسفية أوسع
- رؤى شخصية مستندة للتحليل

**تحليلك:**`;
  }

  return `You are a literary analyst specializing in symbolism and metaphor.

**Text:**
${text}

**Question:**
${query}

**Analyze the text through:**

1. **Literal Level:** What is happening literally?
2. **Symbolic Level:** What do the characters and events symbolize?
3. **Philosophical Level:** What deep ideas and concepts are present?
4. **Spiritual/Mystical Level:** Are there spiritual or mystical meanings?

**Add:**
- Creative interpretations grounded in the text
- Connections to broader literary and philosophical concepts
- Personal insights based on analysis

**Your Analysis:**`;
}
