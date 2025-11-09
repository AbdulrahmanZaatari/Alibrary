import { NextRequest } from 'next/server';
import { generateResponse } from '@/lib/gemini';
import { 
  getDb, 
  addChatMessage, 
  updateChatSessionTimestamp,
  trackConversationContext,
  createSessionSummary,
  trackGlobalMemory,
  getSessionContexts
} from '@/lib/db';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext, detectFollowUpWithAI } from '@/lib/smartRetrieval';
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
        enableMultiHop = false,
        preferredModel,
        useReranking = true,
        useKeywordSearch = false
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
        enableMultiHop,
        preferredModel,
        useKeywordSearch
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

      history.reverse();
      console.log(`📜 Loaded ${history.length} previous messages`);

      // ✅ STEP 1.5: AI-POWERED FOLLOW-UP DETECTION
      const conversationHistory = history.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const followUpDetection = await detectFollowUpWithAI(message, conversationHistory);

      console.log(`🔍 Follow-up Analysis:`, {
        isFollowUp: followUpDetection.isFollowUp,
        confidence: followUpDetection.confidence,
        reason: followUpDetection.reason,
        needsRetrieval: followUpDetection.needsNewRetrieval
      });

      // ✅ STEP 2: Analyze conversation context (every 3 messages)
      if (history.length > 0 && history.length % 3 === 0) {
        console.log('🧠 Analyzing conversation context...');
        
        const queryLanguage = detectQueryLanguage(message);

        try {
          const context = await analyzeConversationContext(conversationHistory, queryLanguage);
          
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

      // ✅ STEP 3: Generate summary (every 10 messages)
      if (history.length > 0 && history.length % 10 === 0) {
        console.log('📝 Generating session summary...');
        
        try {
          const queryLanguage = detectQueryLanguage(message);

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
          
          const queryLanguage = detectQueryLanguage(message);
          contextualPromptAddition = queryLanguage === 'ar'
            ? `\n\n📋 **الوعي بالسياق:**\nالمواضيع التي ناقشناها مؤخراً: ${recentTopics}\n`
            : `\n\n📋 **Context Awareness:**\nRecent topics we've discussed: ${recentTopics}\n`;
        }

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
            useReranking,
            useKeywordSearch
          );

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
          
          console.log('✅ Multi-hop conversational response complete');
          await writer.close();
          return;

        } catch (error) {
          console.error('❌ Multi-hop reasoning failed, falling back to standard:', error);
        }
      }

      // ==================== DOCUMENT-BASED RETRIEVAL (IF DOCUMENTS PROVIDED) ====================
      if (documentIds && documentIds.length > 0) {
        console.log('📚 Documents provided - performing retrieval-based chat');
        
        // ✅ Perform query analysis
        const queryAnalysis = await analyzeQuery(message, queryLanguage);
        
        // ✅ ADD follow-up info to query analysis
        queryAnalysis.isFollowUp = followUpDetection.isFollowUp;
        queryAnalysis.followUpConfidence = followUpDetection.confidence;
        queryAnalysis.needsNewRetrieval = followUpDetection.needsNewRetrieval;

        console.log('🔍 Query Analysis:', {
          original: queryAnalysis.originalQuery,
          type: queryAnalysis.queryType,
          keywords: queryAnalysis.keywords,
          isFollowUp: queryAnalysis.isFollowUp,
          needsRetrieval: queryAnalysis.needsNewRetrieval
        });

        // ✅ SMART RETRIEVAL DECISION
        let retrievedContext = '';
        
        if (followUpDetection.needsNewRetrieval || !followUpDetection.isFollowUp) {
          console.log('📚 Performing new retrieval...');
          
          const { chunks, strategy, confidence } = await retrieveSmartContext(
            queryAnalysis,
            documentIds,
            useReranking,
            useKeywordSearch
          );
          
          console.log(`📊 Retrieval Results:
   - Strategy: ${strategy}
   - Chunks: ${chunks.length}
   - Confidence: ${(confidence * 100).toFixed(1)}%`);

          if (chunks.length > 0) {
            retrievedContext = chunks
              .map((chunk, i) => {
                const pageHeader = queryLanguage === 'ar'
                  ? `**📄 صفحة ${chunk.page_number}**`
                  : `**📄 Page ${chunk.page_number}**`;
                return `${pageHeader}\n${chunk.chunk_text}`;
              })
              .join('\n\n---\n\n');
          }
        } else {
          console.log('💬 Follow-up detected - reusing conversation context');
          
          // Use last 2 assistant messages as context
          retrievedContext = history
            .filter(msg => msg.role === 'assistant')
            .slice(-2)
            .map(msg => msg.content)
            .join('\n\n---\n\n');
        }

        // Build prompt with retrieved context
        const contextSection = retrievedContext
          ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n**${queryLanguage === 'ar' ? 'السياق المسترجع' : 'Retrieved Context'}:**\n\n${retrievedContext}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
          : '';

        const systemPrompt = queryLanguage === 'ar'
          ? `أنت مساعد بحثي دقيق يتذكر السياق. استخدم تنسيق Markdown.

📋 **القواعد:**
1. تذكر المحادثة السابقة
2. استخدم السياق المقدم عند توفره
3. استخدم معرفتك العامة بثقة
4. أجب بشكل مباشر ومفيد

${contextualPromptAddition}`
          : `You are an accurate research assistant with conversation memory. Use Markdown formatting.

📋 **Guidelines:**
1. Remember previous conversation
2. Use provided context when available
3. Use your general knowledge confidently
4. Answer directly and helpfully

${contextualPromptAddition}`;

        const prompt = conversationContextString
          ? `${systemPrompt}

**Previous conversation:**
${conversationContextString}

${contextSection}

**User:** ${message}
**Assistant:**`
          : `${systemPrompt}

${contextSection}

**User:** ${message}
**Assistant:**`;

        const geminiResult = await generateResponse(prompt, preferredModel);
        const geminiStream = geminiResult.stream;
        const modelUsed = geminiResult.modelUsed;
        
        console.log(`✅ Response generated using: ${modelUsed}`);
        
        for await (const chunk of geminiStream) {
          const text = chunk.text();
          if (text) {
            await writer.write(encoder.encode(text));
          }
        }

        updateChatSessionTimestamp(sessionId);
        await writer.close();
        console.log('✅ Document-based chat response complete');
        return;
      }

      // ==================== STANDARD CONVERSATIONAL CHAT (NO DOCUMENTS) ====================
      console.log(enableMultiHop ? '💬 Using standard conversational response (fallback)' : '💬 Using standard conversational response');

      const systemPrompt = queryLanguage === 'ar'
        ? `أنت مساعد بحثي دقيق ومتخصص يتذكر السياق. استخدم تنسيق Markdown في إجاباتك.

📋 **القواعد الأساسية:**

1. **الوعي بالمحادثة:**
   - **تذكر ما نوقش سابقاً** في هذه المحادثة
   - عند سؤالك عن محادثات سابقة، ارجع إلى السياق أدناه
   - اربط الأسئلة الجديدة بالمواضيع السابقة عند الصلة

2. **دمج المعرفة العامة بثقة:**
   - **استخدم معرفتك العامة بحرية** لتقديم إجابات مفيدة وشاملة
   - **لا تقل "لا يمكنني" أو "يحتاج المزيد من المعلومات"** - قدم أفضل إجابة ممكنة

3. **أجب على جميع الأسئلة بثقة:**
   - قدم إجابات مباشرة ومفيدة
   - **تجنب الإجابات الاعتذارية أو المترددة**

4. **تنسيق Markdown:**
   - استخدم **النص الغامق** للتأكيد
   - استخدم القوائم النقطية والمرقمة

${contextualPromptAddition}`
        : `You are an accurate and specialized research assistant with conversational memory. Use Markdown formatting in all your responses.

📋 **Core Guidelines:**

1. **Conversation Awareness:**
   - **Remember what was discussed previously** in this conversation
   - When asked about previous exchanges, refer to the context below
   - Connect new questions to prior topics when relevant

2. **Integrate General Knowledge Confidently:**
   - **Use your general knowledge freely** to provide helpful, comprehensive answers
   - **Never say "I cannot" or "I need more information"** - provide the best answer possible

3. **Answer ALL Questions Confidently:**
   - Provide direct, helpful answers
   - **Avoid apologetic or hesitant responses**

4. **Markdown Formatting:**
   - Use **bold** for emphasis
   - Use bullet and numbered lists

${contextualPromptAddition}`;

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
      let modelUsed: string | undefined;
      
      try {
        console.log(`🎯 Attempting to use model: ${preferredModel || 'default'}`);
        
        const geminiResult = await generateResponse(prompt, preferredModel);
        const geminiStream = geminiResult.stream;
        modelUsed = geminiResult.modelUsed;
        
        console.log(`✅ Successfully using model: ${modelUsed}`);
        
        for await (const chunk of geminiStream) {
          const text = chunk.text();
          if (text) {
            await writer.write(encoder.encode(text));
          }
        }
      } catch (error: any) {
        console.error('❌ Model generation failed:', error);
        
        const errorMessage = error.message.includes('All models failed')
          ? `⚠️ **Model Error**\n\nAll available AI models are currently unavailable:\n${error.message}\n\nPlease try:\n- Selecting a different model\n- Waiting a few minutes\n- Checking your API quota`
          : `⚠️ **Error:** ${error.message}`;
        
        await writer.write(encoder.encode(errorMessage));
        await writer.close();
        return;
      }

      // ✅ ONLY UPDATE SESSION TIMESTAMP (frontend saves messages)
      updateChatSessionTimestamp(sessionId);

      // ✅ Extract and track topics
      const topics = extractTopicsFromMessage(message);
      if (topics.length > 0) {
        console.log('📌 Extracted topics:', topics);
      }

      await writer.close();
      console.log(`✅ Standard conversational response complete (Model: ${modelUsed})`);

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
      'X-Model-Used': 'gemini', 
    },
  });
}