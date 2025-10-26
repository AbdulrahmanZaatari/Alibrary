import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { 
  getDb, 
  getChatMessages, 
  addChatMessage, 
  updateChatSessionTimestamp,
  trackConversationContext,
  createSessionSummary,
  trackGlobalMemory,
  getSessionContexts
} from '@/lib/db';
import { 
  isComplexQuery, 
  performMultiHopReasoning, 
  formatMultiHopResponse 
} from '@/lib/multiHopReasoning';
import { 
  analyzeConversationContext, 
  generateSessionSummary, 
  extractTopicsFromMessage 
} from '@/lib/contextAnalyzer';

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
        documentIds,
        enableMultiHop = false
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
      
      // ✅ STEP 1: Fetch conversation history
      const history = db.prepare(`
        SELECT role, content, created_at
        FROM chat_messages 
        WHERE session_id = ? 
        ORDER BY created_at DESC
        LIMIT 10
      `).all(sessionId) as Array<{ role: string; content: string; created_at: string }>;

      // Reverse to chronological order
      history.reverse();

      console.log(`📜 Loaded ${history.length} previous messages`);

      // ✅ STEP 2: Analyze conversation context (every 3 messages)
      if (history.length > 0 && history.length % 3 === 0) {
        console.log('🧠 Analyzing conversation context...');
        
        const queryLanguage = detectQueryLanguage(message);
        const conversationHistory = history.map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        try {
          const context = await analyzeConversationContext(conversationHistory, queryLanguage);
          
          // Save context to database
          if (context.topics.length > 0) {
            for (const topic of context.topics.slice(0, 3)) {
              const contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              trackConversationContext({
                id: contextId,
                sessionId,
                topic,
                keywords: context.keywords,
                entities: context.entities,
                relevanceScore: 0.8
              });
            }
          }

          // Track in global memory
          if (context.mainTheme) {
            const memoryId = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            trackGlobalMemory({
              id: memoryId,
              topic: context.mainTheme,
              context: `Intent: ${context.userIntent}, Topics: ${context.topics.join(', ')}`,
              sessionId
            });
          }

          console.log('✅ Context tracked:', {
            topics: context.topics,
            intent: context.userIntent,
            mainTheme: context.mainTheme
          });
        } catch (error) {
          console.error('⚠️ Context analysis failed:', error);
        }
      }

      // ✅ STEP 3: Generate summary for long conversations (every 10 messages)
      if (history.length > 0 && history.length % 10 === 0) {
        console.log('📝 Generating session summary...');
        
        try {
          const queryLanguage = detectQueryLanguage(message);
          const conversationHistory = history.map(msg => ({
            role: msg.role,
            content: msg.content
          }));

          const summaryResult = await generateSessionSummary(conversationHistory, queryLanguage);
          
          const summaryId = `sum-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          createSessionSummary({
            id: summaryId,
            sessionId,
            summary: summaryResult.summary,
            keyPoints: summaryResult.keyPoints,
            messageCount: history.length
          });

          console.log('✅ Session summary created');
        } catch (error) {
          console.error('⚠️ Summary generation failed:', error);
        }
      }

      // ✅ STEP 4: Build context-aware conversation string
      let conversationContextString = '';
      let contextualPromptAddition = '';
      
      if (history.length > 0) {
        // Get tracked contexts from database
        const contexts = getSessionContexts(sessionId) as Array<{
          topic: string;
          keywords: string;
          mention_count: number;
        }>;

        if (contexts.length > 0) {
          const recentTopics = contexts
            .slice(0, 3)
            .map(c => c.topic)
            .join(', ');
          
          contextualPromptAddition = `\n\n📋 **Context Awareness:**\nRecent topics we've discussed: ${recentTopics}\n`;
        }

        // Build conversation history string
        conversationContextString = history
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n');
      }

      // ✅ STEP 5: Detect query language and check for complex queries
      const queryLanguage = detectQueryLanguage(message);
      const requiresMultiHop = enableMultiHop && 
                               documentIds?.length > 0 && 
                               isComplexQuery(message);

      // ==================== MULTI-HOP REASONING PATH ====================
      if (requiresMultiHop) {
        console.log('🧠 Complex conversational query - activating multi-hop reasoning');
        
        try {
          const docLanguages = new Map<string, 'ar' | 'en'>();
          documentIds.forEach((docId: string) => {
            docLanguages.set(docId, queryLanguage);
          });

          const multiHopResult = await performMultiHopReasoning(
            message,
            documentIds,
            docLanguages,
            3,
            queryLanguage,
            false,
            false
          );

          // Add conversational context to response
          let conversationPrefix = '';
          if (history.length > 0) {
            const recentHistory = history.slice(-3);
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
          
          // ✅ Save user message
          const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          addChatMessage({
            id: messageId,
            sessionId,
            role: 'user',
            content: message,
            mode: 'general'
          });
          updateChatSessionTimestamp(sessionId);

          console.log('✅ Multi-hop conversational response complete');
          await writer.close();
          return;

        } catch (error) {
          console.error('❌ Multi-hop reasoning failed in general chat, falling back to standard:', error);
        }
      }

      // ==================== STANDARD CONVERSATIONAL CHAT ====================
      console.log(enableMultiHop ? '💬 Using standard conversational response (fallback)' : '💬 Using standard conversational response');

      // Enhanced system prompt with memory awareness
      const systemPrompt = queryLanguage === 'ar'
        ? `أنت مساعد بحثي دقيق ومتخصص يتذكر السياق. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الوعي بالمحادثة:**
   - **تذكر ما نوقش سابقاً** في هذه المحادثة
   - عند سؤالك عن محادثات سابقة، ارجع إلى السياق أدناه
   - اربط الأسئلة الجديدة بالمواضيع السابقة عند الصلة

2. **الأولوية للسياق المقدم:**
   - إذا كانت الإجابة موجودة في المقاطع أدناه، استخدمها وأشر إلى رقم الصفحة والوثيقة
   - اقتبس المعلومات بدقة من السياق

3. **دمج المعرفة العامة بثقة:**
   - **استخدم معرفتك العامة بحرية** لتقديم إجابات مفيدة وشاملة
   - عند تحليل الأسلوب الأدبي أو المقارنة، استخدم ما هو متاح في النص ثم أضف من معرفتك
   - ضع علامات واضحة:
     * **[من النص - صفحة X]** للمعلومات من السياق
     * **[من المعرفة العامة]** للمعلومات الخارجية
   - **لا تقل "لا يمكنني" أو "يحتاج المزيد من المعلومات"** - قدم أفضل إجابة ممكنة

4. **أجب على جميع الأسئلة بثقة:**
   - قدم إجابات مباشرة ومفيدة
   - إذا لم يكن السياق كافياً، استخدم معرفتك لتكملة الإجابة
   - **تجنب الإجابات الاعتذارية أو المترددة**

5. **تحليل الأسلوب الأدبي - نهج عملي:**
   - حلل العناصر المتاحة في النص (السرد، اللغة، المواضيع، الأسلوب)
   - قارن بكتّاب مشهورين بناءً على هذه العناصر
   - قدم أمثلة محددة من النص المتاح
   - أضف من معرفتك عن الكتّاب المشابهين
   - **كن حاسماً في استنتاجاتك**

6. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم القوائم النقطية والمرقمة
   - استخدم > للاقتباسات من النص

${contextualPromptAddition}
${documentIds?.length > 0 ? '### 💡 **ملاحظة:**\nلديك وصول إلى وثائق إضافية. استخدمها عند الحاجة لإثراء إجاباتك.\n\n' : ''}`

        : `You are an accurate and specialized research assistant with conversational memory. Use Markdown formatting in all your responses.

📋 **Core Guidelines:**

1. **Conversation Awareness:**
   - **Remember what was discussed previously** in this conversation
   - When asked about previous exchanges, refer to the context below
   - Connect new questions to prior topics when relevant

2. **Prioritize Provided Context:**
   - Use passages below and cite page numbers when available
   - Quote information accurately from context

3. **Integrate General Knowledge Confidently:**
   - **Use your general knowledge freely** to provide helpful, comprehensive answers
   - When analyzing literary style or making comparisons, use available text then add from your knowledge
   - Use clear markers:
     * **[From Text - Page X]** for context information
     * **[From General Knowledge]** for external information
   - **Never say "I cannot" or "I need more information"** - provide the best answer possible

4. **Answer ALL Questions Confidently:**
   - Provide direct, helpful answers
   - If context is insufficient, use your knowledge to complete the answer
   - **Avoid apologetic or hesitant responses**

5. **Literary Style Analysis - Practical Approach:**
   - Analyze available elements in text (narrative, language, themes, style)
   - Compare to famous writers based on these elements
   - Provide specific examples from available text
   - Add from your knowledge about similar writers
   - **Be decisive in your conclusions**

6. **Markdown Formatting:**
   - Use **bold** for emphasis
   - Use bullet and numbered lists
   - Use > for quotes from text

${contextualPromptAddition}
${documentIds?.length > 0 ? '### 💡 **Note:**\nYou have access to additional documents. Use them when needed to enrich your answers.\n\n' : ''}`;

      const prompt = conversationContextString
        ? `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Previous conversation:**
${conversationContextString}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**User:** ${message}
**Assistant:**`
        : `${systemPrompt}

**User:** ${message}
**Assistant:**`;

      // ✅ Stream response
      const geminiStream = await generateResponse(prompt);
      let assistantResponse = '';
      
      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          assistantResponse += text;
          await writer.write(encoder.encode(text));
        }
      }

      // ✅ STEP 6: Save messages to database
      const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const assistantMessageId = `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`;

      addChatMessage({
        id: userMessageId,
        sessionId,
        role: 'user',
        content: message,
        mode: 'general'
      });

      addChatMessage({
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: assistantResponse,
        mode: 'general'
      });

      updateChatSessionTimestamp(sessionId);

      // ✅ STEP 7: Extract and track topics from user message
      const topics = extractTopicsFromMessage(message);
      if (topics.length > 0) {
        console.log('📌 Extracted topics:', topics);
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