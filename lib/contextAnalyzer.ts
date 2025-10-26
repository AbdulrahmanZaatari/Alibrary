import { generateResponse } from './gemini';

export interface ConversationContext {
  topics: string[];
  keywords: string[];
  entities: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  mainTheme: string;
  userIntent: 'research' | 'learning' | 'comparison' | 'analysis' | 'general';
}

/**
 * ✅ Analyze conversation to extract context
 */
export async function analyzeConversationContext(
  messages: Array<{ role: string; content: string }>,
  language: 'ar' | 'en'
): Promise<ConversationContext> {
  if (messages.length === 0) {
    return {
      topics: [],
      keywords: [],
      entities: [],
      sentiment: 'neutral',
      mainTheme: '',
      userIntent: 'general'
    };
  }

  // Combine recent messages for analysis
  const recentMessages = messages.slice(-6); // Last 6 messages
  const conversationText = recentMessages
    .map(msg => `${msg.role}: ${msg.content}`)
    .join('\n');

  const prompt = language === 'ar'
    ? `حلل المحادثة التالية واستخرج:
1. المواضيع الرئيسية (قائمة بالمواضيع)
2. الكلمات المفتاحية (5-10 كلمات)
3. الكيانات المذكورة (أشخاص، أماكن، مفاهيم)
4. المشاعر العامة (positive/neutral/negative)
5. الموضوع الرئيسي (جملة واحدة)
6. نية المستخدم (research/learning/comparison/analysis/general)

المحادثة:
${conversationText}

أجب بتنسيق JSON فقط:
{
  "topics": ["موضوع1", "موضوع2"],
  "keywords": ["كلمة1", "كلمة2"],
  "entities": ["كيان1", "كيان2"],
  "sentiment": "neutral",
  "mainTheme": "الموضوع الرئيسي",
  "userIntent": "research"
}`
    : `Analyze the following conversation and extract:
1. Main topics (list of topics)
2. Keywords (5-10 keywords)
3. Mentioned entities (people, places, concepts)
4. Overall sentiment (positive/neutral/negative)
5. Main theme (one sentence)
6. User intent (research/learning/comparison/analysis/general)

Conversation:
${conversationText}

Respond ONLY in JSON format:
{
  "topics": ["topic1", "topic2"],
  "keywords": ["keyword1", "keyword2"],
  "entities": ["entity1", "entity2"],
  "sentiment": "neutral",
  "mainTheme": "main theme",
  "userIntent": "research"
}`;

  try {
    let responseText = '';
    const stream = await generateResponse(prompt);
    
    for await (const chunk of stream) {
      const text = chunk.text();
      if (text) responseText += text;
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️ Failed to extract JSON from context analysis');
      return getDefaultContext();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      topics: parsed.topics || [],
      keywords: parsed.keywords || [],
      entities: parsed.entities || [],
      sentiment: parsed.sentiment || 'neutral',
      mainTheme: parsed.mainTheme || '',
      userIntent: parsed.userIntent || 'general'
    };

  } catch (error) {
    console.error('❌ Error analyzing conversation context:', error);
    return getDefaultContext();
  }
}

function getDefaultContext(): ConversationContext {
  return {
    topics: [],
    keywords: [],
    entities: [],
    sentiment: 'neutral',
    mainTheme: '',
    userIntent: 'general'
  };
}

/**
 * ✅ Generate session summary
 */
export async function generateSessionSummary(
  messages: Array<{ role: string; content: string }>,
  language: 'ar' | 'en'
): Promise<{ summary: string; keyPoints: string[] }> {
  if (messages.length < 4) {
    return {
      summary: language === 'ar' ? 'محادثة قصيرة' : 'Short conversation',
      keyPoints: []
    };
  }

  const conversationText = messages
    .map(msg => `${msg.role}: ${msg.content}`)
    .join('\n');

  const prompt = language === 'ar'
    ? `لخص المحادثة التالية في فقرة واحدة، ثم قدم 3-5 نقاط رئيسية.

المحادثة:
${conversationText}

أجب بتنسيق JSON فقط:
{
  "summary": "الملخص هنا",
  "keyPoints": ["نقطة1", "نقطة2", "نقطة3"]
}`
    : `Summarize the following conversation in one paragraph, then provide 3-5 key points.

Conversation:
${conversationText}

Respond ONLY in JSON format:
{
  "summary": "summary here",
  "keyPoints": ["point1", "point2", "point3"]
}`;

  try {
    let responseText = '';
    const stream = await generateResponse(prompt);
    
    for await (const chunk of stream) {
      const text = chunk.text();
      if (text) responseText += text;
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        summary: language === 'ar' ? 'محادثة عامة' : 'General conversation',
        keyPoints: []
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || '',
      keyPoints: parsed.keyPoints || []
    };

  } catch (error) {
    console.error('❌ Error generating summary:', error);
    return {
      summary: language === 'ar' ? 'محادثة عامة' : 'General conversation',
      keyPoints: []
    };
  }
}

/**
 * ✅ Extract topics from message
 */
export function extractTopicsFromMessage(message: string): string[] {
  // Simple topic extraction based on common patterns
  const topics: string[] = [];
  
  // Arabic patterns
  const arabicPatterns = [
    /(?:عن|حول|بخصوص)\s+([\u0600-\u06FF\s]{3,30})/g,
    /([\u0600-\u06FF]{3,})\s+(?:في|من|على)/g
  ];
  
  // English patterns
  const englishPatterns = [
    /(?:about|regarding|concerning)\s+([a-zA-Z\s]{3,30})/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g // Proper nouns
  ];
  
  [...arabicPatterns, ...englishPatterns].forEach(pattern => {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        topics.push(match[1].trim());
      }
    }
  });
  
  return [...new Set(topics)].slice(0, 5);
}