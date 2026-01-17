/**
 * Word Scan Query Detection Utility
 * 
 * Detects queries that ask for "all occurrences" of a word/phrase
 * and extracts the target word for dedicated scanning
 */

export interface WordScanDetection {
  isWordScan: boolean;
  targetWord?: string;
  confidence: 'high' | 'medium' | 'low';
}

// Arabic patterns for word occurrence queries
const arabicPatterns = [
  // جميع استخدامات كلمة "الله"
  /(?:جميع|كل|كافة)\s+(?:استخدامات|حالات|مواضع|مواقع|أماكن|ورود)\s+(?:كلمة|لفظ|لفظة|مصطلح)?\s*[""«»"]?([^""«»"]+)[""«»"]?/i,
  
  // أين وردت كلمة "الله"
  /(?:أين|متى)\s+(?:وردت?|ذكرت?|استخدمت?|ظهرت?)\s+(?:كلمة|لفظ|لفظة)?\s*[""«»"]?([^""«»"]+)[""«»"]?/i,
  
  // كم مرة ذكرت كلمة "الله"
  /(?:كم|عدد)\s+(?:مرة|مرات)\s+(?:ذكرت?|وردت?|استخدمت?|ظهرت?|تكررت?)\s+(?:كلمة|لفظ|لفظة)?\s*[""«»"]?([^""«»"]+)[""«»"]?/i,
  
  // أريد جميع استخدامات كلمة الله
  /(?:أريد|اعطني|اذكر|اسرد|اعرض)\s+(?:جميع|كل|كافة)\s+(?:استخدامات|حالات|مواضع|مواقع|أماكن|ورود)\s+(?:كلمة|لفظ|لفظة)?\s*[""«»"]?([^""«»"]+)[""«»"]?/i,
  
  // ابحث عن جميع مواضع كلمة
  /(?:ابحث|فتش)\s+(?:عن\s+)?(?:جميع|كل|كافة)\s+(?:مواضع|مواقع|أماكن|حالات)\s+(?:كلمة|لفظ)?\s*[""«»"]?([^""«»"]+)[""«»"]?/i,
  
  // Direct: جميع استخدامات الله (without كلمة)
  /(?:جميع|كل|كافة)\s+(?:استخدامات|حالات|مواضع)\s+[""«»"]?(\S+)[""«»"]?\s+(?:في\s+)?(?:الكتاب|النص|المستند)?/i,
  
  // أريد ... في الكتاب pattern
  /أريد\s+(?:جميع|كل)\s+(?:استخدامات|مواضع|حالات)\s+(?:كلمة\s+)?([^\s]+)\s+في/i,
];

// English patterns for word occurrence queries
const englishPatterns = [
  // all occurrences of "word"
  /(?:all|every|each)\s+(?:occurrences?|instances?|uses?|mentions?|appearances?)\s+of\s+(?:the\s+)?(?:word|term|phrase)?\s*["""]?([^"""]+)["""]?/i,
  
  // find every "word"
  /(?:find|show|list|get)\s+(?:all|every|each)\s+(?:occurrences?|instances?|uses?|mentions?)\s+of\s*["""]?([^"""]+)["""]?/i,
  
  // how many times does "word" appear
  /how\s+many\s+times\s+(?:does|is|did)\s+["""]?([^"""]+)["""]?\s+(?:appear|mentioned?|used?|occur)/i,
  
  // where does "word" appear
  /where\s+(?:does|is|did)\s+["""]?([^"""]+)["""]?\s+(?:appear|mentioned?|used?|occur)/i,
  
  // count occurrences of "word"
  /count\s+(?:all\s+)?(?:the\s+)?(?:occurrences?|instances?|uses?)\s+of\s*["""]?([^"""]+)["""]?/i,
  
  // list all "word" mentions
  /list\s+(?:all|every)\s+["""]?([^"""]+)["""]?\s+(?:mentions?|occurrences?|instances?)/i,
];

/**
 * Detect if a query is asking for word/phrase occurrences
 */
export function detectWordScanQuery(query: string): WordScanDetection {
  const trimmedQuery = query.trim();
  
  // Check Arabic patterns first
  for (const pattern of arabicPatterns) {
    const match = trimmedQuery.match(pattern);
    if (match && match[1]) {
      const targetWord = match[1].trim()
        .replace(/[""«»"]/g, '')  // Remove quotes
        .replace(/\s+في\s*.*$/i, '')  // Remove "في الكتاب" suffix
        .trim();
      
      if (targetWord.length > 0 && targetWord.length < 50) {
        return {
          isWordScan: true,
          targetWord,
          confidence: 'high'
        };
      }
    }
  }
  
  // Check English patterns
  for (const pattern of englishPatterns) {
    const match = trimmedQuery.match(pattern);
    if (match && match[1]) {
      const targetWord = match[1].trim()
        .replace(/["""]/g, '')
        .trim();
      
      if (targetWord.length > 0 && targetWord.length < 50) {
        return {
          isWordScan: true,
          targetWord,
          confidence: 'high'
        };
      }
    }
  }
  
  // Medium confidence: simpler patterns
  const simpleArabicPattern = /(?:كلمة|لفظ)\s+[""«»"]?(\S+)[""«»"]?\s+(?:في|بالكتاب|بالنص)/i;
  const simpleMatch = trimmedQuery.match(simpleArabicPattern);
  if (simpleMatch && simpleMatch[1]) {
    return {
      isWordScan: true,
      targetWord: simpleMatch[1].trim().replace(/[""«»"]/g, ''),
      confidence: 'medium'
    };
  }
  
  return {
    isWordScan: false,
    confidence: 'low'
  };
}

/**
 * Page Range Detection
 * Detects queries that specify a page range and extracts start/end pages
 */
export interface PageRangeDetection {
  hasPageRange: boolean;
  startPage?: number;
  endPage?: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect if a query specifies a page range
 */
export function detectPageRange(query: string): PageRangeDetection {
  const trimmedQuery = query.trim();
  
  // Arabic patterns for page ranges
  const arabicPatterns = [
    // صفحة 45 و53 / صفحة 45 إلى 53 / صفحة 45 الى 53
    /صفح[ةه]\s*(\d+)\s*(?:و|إلى|الى|حتى|-|–|ل)\s*(?:صفح[ةه]\s*)?(\d+)/i,
    // بين صفحة 45 و 53 / بين صفحتي 45 و 53
    /بين\s+(?:صفح[ةه]|صفحتي|صفحتين)?\s*(\d+)\s*(?:و|إلى|الى|حتى|-|–)\s*(\d+)/i,
    // من صفحة 45 إلى صفحة 53
    /من\s+(?:صفح[ةه])?\s*(\d+)\s*(?:إلى|الى|حتى|ل|-|–)\s*(?:صفح[ةه])?\s*(\d+)/i,
    // الصفحات 45-53 / صفحات 45 إلى 53
    /(?:ال)?صفحات\s*(\d+)\s*(?:و|إلى|الى|حتى|-|–)\s*(\d+)/i,
    // ص 45 - 53 / ص45-53
    /ص\.?\s*(\d+)\s*(?:-|–|إلى|الى|و)\s*(?:ص\.?\s*)?(\d+)/i,
  ];
  
  // English patterns for page ranges
  const englishPatterns = [
    // pages 45 to 53 / pages 45-53 / page 45 to 53
    /pages?\s*(\d+)\s*(?:to|through|-|–|and)\s*(\d+)/i,
    // between pages 45 and 53
    /between\s+pages?\s*(\d+)\s*(?:and|to|-|–)\s*(\d+)/i,
    // from page 45 to page 53
    /from\s+pages?\s*(\d+)\s*(?:to|through|-|–)\s*pages?\s*(\d+)/i,
    // p. 45-53 / pp. 45-53
    /pp?\.?\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i,
  ];

  // Check Arabic patterns first
  for (const pattern of arabicPatterns) {
    const match = trimmedQuery.match(pattern);
    if (match && match[1] && match[2]) {
      const page1 = parseInt(match[1], 10);
      const page2 = parseInt(match[2], 10);
      
      if (!isNaN(page1) && !isNaN(page2) && page1 > 0 && page2 > 0) {
        return {
          hasPageRange: true,
          startPage: Math.min(page1, page2),
          endPage: Math.max(page1, page2),
          confidence: 'high'
        };
      }
    }
  }
  
  // Check English patterns
  for (const pattern of englishPatterns) {
    const match = trimmedQuery.match(pattern);
    if (match && match[1] && match[2]) {
      const page1 = parseInt(match[1], 10);
      const page2 = parseInt(match[2], 10);
      
      if (!isNaN(page1) && !isNaN(page2) && page1 > 0 && page2 > 0) {
        return {
          hasPageRange: true,
          startPage: Math.min(page1, page2),
          endPage: Math.max(page1, page2),
          confidence: 'high'
        };
      }
    }
  }
  
  // Single page detection (medium confidence)
  const singlePageArabic = /صفح[ةه]\s*(\d+)/i;
  const singlePageEnglish = /\bpage\s*(\d+)\b/i;
  
  const singleMatchAr = trimmedQuery.match(singlePageArabic);
  const singleMatchEn = trimmedQuery.match(singlePageEnglish);
  
  if (singleMatchAr && singleMatchAr[1]) {
    const page = parseInt(singleMatchAr[1], 10);
    if (!isNaN(page) && page > 0) {
      return {
        hasPageRange: true,
        startPage: page,
        endPage: page,
        confidence: 'medium'
      };
    }
  }
  
  if (singleMatchEn && singleMatchEn[1]) {
    const page = parseInt(singleMatchEn[1], 10);
    if (!isNaN(page) && page > 0) {
      return {
        hasPageRange: true,
        startPage: page,
        endPage: page,
        confidence: 'medium'
      };
    }
  }
  
  return {
    hasPageRange: false,
    confidence: 'low'
  };
}

/**
 * Check if query language is Arabic
 */
export function isArabicQuery(query: string): boolean {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return arabicPattern.test(query);
}
