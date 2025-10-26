import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { getDb } from '@/lib/db';
import { 
  isComplexQuery, 
  performMultiHopReasoning, 
  formatMultiHopResponse 
} from '@/lib/multiHopReasoning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ✅ Detect query language
 */
function detectQueryLanguage(query: string): 'ar' | 'en' {
  const arabicChars = (query.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = query.replace(/\s/g, '').length;
  const arabicRatio = arabicChars / totalChars;
  
  return arabicRatio > 0.3 ? 'ar' : 'en';
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { 
        message, 
        sessionId, 
        documentIds, // ✅ Optional document context
        enableMultiHop = false // ✅ NEW: Default is FALSE (opt-in)
      } = await request.json();

      if (!message || !sessionId) {
        await writer.write(encoder.encode('Error: Missing message or sessionId'));
        await writer.close();
        return;
      }

      console.log('💬 General Chat:', {
        sessionId,
        hasMessage: !!message,
        hasDocuments: documentIds?.length > 0,
        documentCount: documentIds?.length || 0,
        enableMultiHop
      });

      const db = getDb();
      
      // Fetch conversation history
      const history = db.prepare(`
        SELECT role, content 
        FROM chat_messages 
        WHERE session_id = ? 
        ORDER BY created_at DESC
        LIMIT 10
      `).all(sessionId) as Array<{ role: string; content: string }>;

      // Reverse to chronological order
      history.reverse();

      // ✅ Detect if this is a complex query that needs multi-hop reasoning (only if enabled)
      const queryLanguage = detectQueryLanguage(message);
      const requiresMultiHop = enableMultiHop && 
                               documentIds?.length > 0 && 
                               isComplexQuery(message);

      // ==================== MULTI-HOP REASONING PATH ====================
      if (requiresMultiHop) {
        console.log('🧠 Complex conversational query - activating multi-hop reasoning');
        
        try {
          // Create document language map (assume same language for all in general chat)
          const docLanguages = new Map<string, 'ar' | 'en'>();
          documentIds.forEach((docId: string) => {
            docLanguages.set(docId, queryLanguage);
          });

          const multiHopResult = await performMultiHopReasoning(
            message,
            documentIds,
            docLanguages,
            3, // Fewer hops for conversational context
            queryLanguage,
            false, // No spelling correction in general chat
            false
          );

          // Add conversational context to response
          let conversationPrefix = '';
          if (history.length > 0) {
            const recentHistory = history.slice(-3); // Last 3 exchanges
            conversationPrefix = queryLanguage === 'ar'
              ? `💭 **استكمالاً للمحادثة السابقة:**\n\n`
              : `💭 **Continuing our conversation:**\n\n`;
            
            recentHistory.forEach(msg => {
              const label = msg.role === 'user' 
                ? (queryLanguage === 'ar' ? 'أنت' : 'You')
                : (queryLanguage === 'ar' ? 'المساعد' : 'Assistant');
              conversationPrefix += `**${label}:** ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n\n`;
            });
            
            conversationPrefix += '---\n\n';
          }

          const formattedResponse = conversationPrefix + formatMultiHopResponse(multiHopResult, queryLanguage);
          await writer.write(encoder.encode(formattedResponse));
          
          console.log('✅ Multi-hop conversational response complete');
          await writer.close();
          return;

        } catch (error) {
          console.error('❌ Multi-hop reasoning failed in general chat, falling back to standard:', error);
          // Fall through to standard chat
        }
      }

      // ==================== STANDARD CONVERSATIONAL CHAT ====================
      console.log(enableMultiHop ? '💬 Using standard conversational response (fallback)' : '💬 Using standard conversational response');

      let conversationContext = '';
      if (history.length > 0) {
        conversationContext = history
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n');
      }

      // Enhanced system prompt based on language with improved robustness
      const systemPrompt = queryLanguage === 'ar'
        ? `أنت مساعد بحثي دقيق ومتخصص. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الأولوية للسياق المقدم:**
   - إذا كانت الإجابة موجودة في المقاطع أدناه، استخدمها وأشر إلى رقم الصفحة والوثيقة
   - اقتبس المعلومات بدقة من السياق

2. **دمج المعرفة العامة بثقة:**
   - **استخدم معرفتك العامة بحرية** لتقديم إجابات مفيدة وشاملة
   - عند تحليل الأسلوب الأدبي أو المقارنة، استخدم ما هو متاح في النص ثم أضف من معرفتك
   - ضع علامات واضحة:
     * **[من النص - صفحة X]** للمعلومات من السياق
     * **[من المعرفة العامة]** للمعلومات الخارجية
   - **لا تقل "لا يمكنني" أو "يحتاج المزيد من المعلومات"** - قدم أفضل إجابة ممكنة

3. **أجب على جميع الأسئلة بثقة:**
   - قدم إجابات مباشرة ومفيدة
   - إذا لم يكن السياق كافياً، استخدم معرفتك لتكملة الإجابة
   - **تجنب الإجابات الاعتذارية أو المترددة**

4. **تحليل الأسلوب الأدبي - نهج عملي:**
   - حلل العناصر المتاحة في النص (السرد، اللغة، المواضيع، الأسلوب)
   - قارن بكتّاب مشهورين بناءً على هذه العناصر
   - قدم أمثلة محددة من النص المتاح
   - أضف من معرفتك عن الكتّاب المشابهين
   - **كن حاسماً في استنتاجاتك**

5. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم القوائم النقطية والمرقمة
   - استخدم > للاقتباسات من النص

${documentIds?.length > 0 ? '### 💡 **ملاحظة:**\nلديك وصول إلى وثائق إضافية. استخدمها عند الحاجة لإثراء إجاباتك.\n\n' : ''}`

        : `You are an accurate and specialized research assistant. Use Markdown formatting in all your responses.

    📋 **Core Guidelines:**

    1. **Prioritize Provided Context:**
    - Use passages below and cite page numbers when available
    - Quote information accurately from context

    2. **Integrate General Knowledge Confidently:**
    - **Use your general knowledge freely** to provide helpful, comprehensive answers
    - When analyzing literary style or making comparisons, use available text then add from your knowledge
    - Use clear markers:
        * **[From Text - Page X]** for context information
        * **[From General Knowledge]** for external information
    - **Never say "I cannot" or "I need more information"** - provide the best answer possible

    3. **Answer ALL Questions Confidently:**
    - Provide direct, helpful answers
    - If context is insufficient, use your knowledge to complete the answer
    - **Avoid apologetic or hesitant responses**

    4. **Literary Style Analysis - Practical Approach:**
    - Analyze available elements in text (narrative, language, themes, style)
    - Compare to famous writers based on these elements
    - Provide specific examples from available text
    - Add from your knowledge about similar writers
    - **Be decisive in your conclusions**

    5. **Markdown Formatting:**
    - Use **bold** for emphasis
    - Use bullet and numbered lists
    - Use > for quotes from text


    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${documentIds?.length > 0 ? '### 💡 **Note:**\nYou have access to additional documents. Use them when needed to enrich your answers.\n\n' : ''}`;

      const prompt = conversationContext
        ? `${systemPrompt}

**Previous conversation:**
${conversationContext}

**User:** ${message}
**Assistant:**`
        : `${systemPrompt}

**User:** ${message}
**Assistant:**`;

      const geminiStream = await generateResponse(prompt);
      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          await writer.write(encoder.encode(text));
        }
      }

      await writer.close();
      console.log('✅ Standard conversational response complete');

    } catch (error) {
      console.error('❌ General chat error:', error);
      try {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await writer.write(encoder.encode(`Error: ${errorMsg}`));
        await writer.close();
      } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}