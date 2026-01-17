import { embedText, generateResponse } from './gemini';
import { searchSimilarChunks } from './vectorStore';
import { correctChunksBatch } from './spellingCorrection';

/**
 * ✅ Interface for each reasoning step
 */
interface ReasoningStep {
  stepNumber: number;
  question: string;
  retrievedChunks: any[];
  answer: string;
  confidence: number;
  documentSources: string[];
  usedGeneralKnowledge: boolean; // ✅ NEW: Track if we used general knowledge
}

/**
 * ✅ Interface for multi-hop result
 */
interface MultiHopResult {
  steps: ReasoningStep[];
  finalAnswer: string;
  confidenceScore: number;
  evidenceChain: string[];
  strategy: 'multi-hop' | 'hybrid-multi-hop'; // ✅ NEW: Track if hybrid
  totalDocumentsUsed: number;
  usedGeneralKnowledge: boolean; // ✅ NEW
}

/**
 * ✅ Detect if query requires multi-hop reasoning
 */
export function isComplexQuery(query: string): boolean {
  const complexPatterns = [
    // Multi-part questions
    /\b(how|why|what|where|when|who)\b.*\b(and|also|additionally)\b.*\b(how|why|what|where|when|who)\b/i,
    
    // Requires synthesis
    /\b(compare|contrast|difference|similar|relationship|connection|relate)\b/i,
    
    // Causal reasoning
    /\b(because|therefore|thus|hence|lead to|result in|cause|effect)\b/i,
    
    // Multi-document
    /\b(across|between|among)\b.*\b(document|text|book|source|both|all)\b/i,
    
    // Deep analysis
    /\b(analyze|evaluate|assess|examine|investigate|explore)\b/i,
    
    // Arabic equivalents
    /قارن|فرق|علاقة|ارتباط|بين|تحليل|لماذا.*وكيف|ما.*ولماذا/,
  ];
  
  return complexPatterns.some(pattern => pattern.test(query));
}

/**
 * ✅ MAIN MULTI-HOP REASONING ENGINE (HYBRID MODE)
 * 
 * Performs iterative reasoning across multiple documents to answer complex questions.
 * Now supports falling back to general knowledge when document context is insufficient.
 */
export async function performMultiHopReasoning(
  complexQuery: string,
  documentIds: string[],
  documentLanguages: Map<string, 'ar' | 'en'>,
  maxHops: number = 4,
  responseLanguage: 'ar' | 'en' = 'ar',
  correctSpelling: boolean = false,
  aggressiveCorrection: boolean = false,
  pageRange?: { startPage: number; endPage: number }
): Promise<MultiHopResult> {
  console.log(`\n🧠 ========== MULTI-HOP REASONING STARTED ==========`);
  console.log(`📋 Query: "${complexQuery}"`);
  console.log(`📚 Documents: ${documentIds.length}`);
  console.log(`🔄 Max hops: ${maxHops}`);
  console.log(`🗣️ Language: ${responseLanguage}`);
  if (pageRange) {
    console.log(`📄 Page filter: ${pageRange.startPage} - ${pageRange.endPage}`);
  }
  
  const steps: ReasoningStep[] = [];
  let currentQuery = complexQuery;
  const usedDocuments = new Set<string>();
  let usedGeneralKnowledge = false;
  
  // ==========================================
  // REASONING LOOP
  // ==========================================
  for (let hop = 1; hop <= maxHops; hop++) {
    console.log(`\n┌─────────────────────────────────────────`);
    console.log(`│ 🔍 HOP ${hop}/${maxHops}`);
    console.log(`│ Question: ${currentQuery.substring(0, 80)}${currentQuery.length > 80 ? '...' : ''}`);
    console.log(`└─────────────────────────────────────────`);
    
    // ✅ STEP 1: Embed current question
    const embedding = await embedText(currentQuery);
    
    // ✅ STEP 2: Retrieve relevant evidence
    let chunks = await searchSimilarChunks(
      embedding,
      documentIds,
      pageRange ? 50 : 15, // Get more chunks if filtering by page
      0.30
    );
    
    // ✅ STEP 2.5: Filter by page range if specified
    if (pageRange && chunks.length > 0) {
      const originalCount = chunks.length;
      chunks = chunks.filter(chunk => {
        const pageNum = chunk.page_number || chunk.metadata?.page_number;
        return pageNum >= pageRange.startPage && pageNum <= pageRange.endPage;
      });
      console.log(`📄 Page filter applied: ${originalCount} → ${chunks.length} chunks (pages ${pageRange.startPage}-${pageRange.endPage})`);
    }
    
    let stepUsedGeneralKnowledge = false;
    
    // ✅ STEP 3: Check if we have good evidence
    const hasGoodEvidence = chunks.length > 0 && chunks[0].similarity > 0.35;
    
    if (!hasGoodEvidence) {
      console.log(`⚠️ Low-quality evidence (${chunks.length} chunks, best: ${chunks[0]?.similarity ? (chunks[0].similarity * 100).toFixed(1) : '0'}%)`);
      console.log(`💡 Switching to general knowledge for this hop`);
      stepUsedGeneralKnowledge = true;
      usedGeneralKnowledge = true;
    } else {
      console.log(`📄 Retrieved ${chunks.length} chunks`);
      console.log(`🎯 Top similarity: ${(chunks[0].similarity * 100).toFixed(1)}%`);
      chunks.forEach(c => usedDocuments.add(c.document_id));
    }
    
    const processedChunks = chunks;
    // ✅ STEP 5: Build context or use general knowledge
    let context = '';
    let documentSources: string[] = [];
    
    if (stepUsedGeneralKnowledge) {
      // Use general knowledge prompt
      context = responseLanguage === 'ar'
        ? `لا توجد معلومات كافية في المستندات المتاحة. استخدم معرفتك العامة للإجابة على هذا السؤال.`
        : `Insufficient information in available documents. Use your general knowledge to answer this question.`;
      documentSources = ['General Knowledge'];
    } else {
      // Use document context
      context = processedChunks
        .slice(0, 10)
        .map((c, i) => {
          const docNum = documentIds.indexOf(c.document_id) + 1;
          return `[Document ${docNum} - Page ${c.page_number}]\n${c.chunk_text}`;
        })
        .join('\n\n---\n\n');
      
      documentSources = [...new Set(
        processedChunks.slice(0, 10).map(c => {
          const docNum = documentIds.indexOf(c.document_id) + 1;
          return `Doc ${docNum}, Page ${c.page_number}`;
        })
      )];
    }
    
    // ✅ STEP 6: Generate intermediate answer (HYBRID MODE)
    const answerPrompt = stepUsedGeneralKnowledge
      ? (responseLanguage === 'ar'
        ? `أجب على السؤال التالي باستخدام معرفتك العامة. كن دقيقاً وموجزاً.

السؤال: ${currentQuery}

الجواب (2-3 جمل):` 
        : `Answer the following question using your general knowledge. Be accurate and concise.

Question: ${currentQuery}

Answer (2-3 sentences):`)
      : (responseLanguage === 'ar'
        ? `بناءً على الأدلة التالية، أجب على السؤال بشكل موجز.

إذا كانت الأدلة ناقصة، يمكنك إضافة معلومات من معرفتك العامة وأشر إلى ذلك.

${context}

السؤال: ${currentQuery}

الجواب (2-3 جمل):` 
        : `Based on the following evidence, answer the question concisely.

If evidence is incomplete, you may add information from your general knowledge and indicate this.

${context}

Question: ${currentQuery}

Answer (2-3 sentences):`);
    
    const answerStream = await generateResponse(answerPrompt);
    let intermediateAnswer = '';
    for await (const chunk of answerStream.stream) {
      intermediateAnswer += chunk.text();
    }
    intermediateAnswer = intermediateAnswer.trim();
    
    const knowledgeIcon = stepUsedGeneralKnowledge ? '💡' : '✅';
    console.log(`${knowledgeIcon} Answer: ${intermediateAnswer.substring(0, 120)}${intermediateAnswer.length > 120 ? '...' : ''}`);
    
    // ✅ STEP 7: Store reasoning step
    steps.push({
      stepNumber: hop,
      question: currentQuery,
      retrievedChunks: stepUsedGeneralKnowledge ? [] : processedChunks.slice(0, 10),
      answer: intermediateAnswer,
      confidence: stepUsedGeneralKnowledge ? 0.6 : (processedChunks[0]?.similarity || 0),
      documentSources,
      usedGeneralKnowledge: stepUsedGeneralKnowledge
    });
    
    // ✅ STEP 8: Generate next sub-question (if not last hop)
    if (hop < maxHops) {
      const nextQuestionPrompt = responseLanguage === 'ar'
        ? `لدينا هذه الإجابة الجزئية: "${intermediateAnswer}"

للإجابة الكاملة على السؤال الأصلي: "${complexQuery}"

ما هو السؤال الفرعي التالي الأكثر أهمية لاستكمال الإجابة؟

اكتب سؤالاً واحداً فقط، واضحاً ومحدداً:` 
        : `We have this partial answer: "${intermediateAnswer}"

To fully answer the original question: "${complexQuery}"

What is the next most important sub-question to complete the answer?

Write ONE clear, specific question:`;
      
      const nextQuestionResponse = await generateResponse(nextQuestionPrompt);
      let nextQuestion = '';
      for await (const chunk of nextQuestionResponse.stream) {
        nextQuestion += chunk.text();
      }
      
      nextQuestion = nextQuestion
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^\d+\.\s*/, '')
        .split('\n')[0];
      
      console.log(`🔄 Next question: ${nextQuestion}`);
      
      const similarity = calculateStringSimilarity(
        nextQuestion.toLowerCase(),
        complexQuery.toLowerCase()
      );
      
      if (similarity > 0.85) {
        console.log('⚠️ Next question too similar to original, stopping');
        break;
      }
      
      // ✅ Don't stop on "insufficient" if we're using general knowledge
      if (!stepUsedGeneralKnowledge && 
          (intermediateAnswer.toLowerCase().includes('information insufficient') ||
           intermediateAnswer.toLowerCase().includes('المعلومات غير كافية'))) {
        console.log('⚠️ Insufficient information in documents, but will try general knowledge in next hop');
      }
      
      currentQuery = nextQuestion;
    }
  }
  
  // ==========================================
  // SYNTHESIZE FINAL ANSWER (HYBRID MODE)
  // ==========================================
  console.log(`\n🔗 Synthesizing ${steps.length} reasoning steps...`);
  
  const reasoningChain = steps.map((s, i) => {
    const sources = s.usedGeneralKnowledge 
      ? (responseLanguage === 'ar' ? 'معرفة عامة' : 'General Knowledge')
      : s.documentSources.slice(0, 3).join(', ');
    
    const knowledgeIndicator = s.usedGeneralKnowledge 
      ? (responseLanguage === 'ar' ? ' 💡 (معرفة عامة)' : ' 💡 (General Knowledge)')
      : '';
    
    return responseLanguage === 'ar'
      ? `### خطوة ${i + 1}: ${s.question}${knowledgeIndicator}
**الجواب:** ${s.answer}
**المصادر:** ${sources}
**الثقة:** ${(s.confidence * 100).toFixed(1)}%`
      : `### Step ${i + 1}: ${s.question}${knowledgeIndicator}
**Answer:** ${s.answer}
**Sources:** ${sources}
**Confidence:** ${(s.confidence * 100).toFixed(1)}%`;
  }).join('\n\n');
  
  const synthesisPrompt = responseLanguage === 'ar'
    ? `لقد قمنا بعملية استدلال متعددة الخطوات للإجابة على سؤال معقد.

**السؤال الأصلي:** "${complexQuery}"

**الخطوات المنطقية:**

${reasoningChain}

---

**ملاحظة مهمة:** بعض الخطوات استخدمت معرفة عامة (💡) بسبب نقص المعلومات في المستندات.

**مهمتك:** اجمع هذه الخطوات في إجابة شاملة ومترابطة واحدة.

**متطلبات الإجابة:**
1. ابدأ بملخص مباشر للإجابة الرئيسية
2. دمج المعلومات من المستندات (إذا وجدت) مع المعرفة العامة
3. وضّح أي أقسام تعتمد على معرفة عامة باستخدام **[معلومات إضافية]**
4. استخدم تنسيق Markdown (قوائم، عناوين فرعية)
5. أشر إلى المصادر من المستندات عند الاقتباس

**الإجابة النهائية الشاملة:**` 
    : `We performed multi-hop reasoning to answer a complex question.

**Original Question:** "${complexQuery}"

**Logical Steps:**

${reasoningChain}

---

**Important Note:** Some steps used general knowledge (💡) due to insufficient document information.

**Your Task:** Synthesize these steps into ONE comprehensive, coherent answer.

**Answer Requirements:**
1. Start with direct summary of main answer
2. Integrate document information (if any) with general knowledge
3. Clearly mark sections relying on general knowledge with **[Additional Information]**
4. Use Markdown formatting (lists, subheadings)
5. Cite document sources when quoting

**Final Comprehensive Answer:**`;
  
  const finalResponse = await generateResponse(synthesisPrompt);
  let finalAnswer = '';
  for await (const chunk of finalResponse.stream) {
    finalAnswer += chunk.text();
  }
  
  // ==========================================
  // BUILD EVIDENCE CHAIN
  // ==========================================
  const evidenceChain = steps.flatMap(s => s.documentSources);
  const uniqueEvidence = [...new Set(evidenceChain)];
  
  const totalConfidence = steps.reduce((sum, s) => sum + s.confidence, 0);
  const avgConfidence = totalConfidence / steps.length;
  
  const completionRatio = steps.length / maxHops;
  const adjustedConfidence = avgConfidence * (0.7 + 0.3 * completionRatio);
  
  const strategy = usedGeneralKnowledge ? 'hybrid-multi-hop' : 'multi-hop';
  
  console.log(`\n✅ ========== MULTI-HOP REASONING COMPLETE ==========`);
  console.log(`📊 Steps taken: ${steps.length}/${maxHops}`);
  console.log(`📚 Documents used: ${usedDocuments.size}/${documentIds.length}`);
  console.log(`🔗 Evidence sources: ${uniqueEvidence.length}`);
  console.log(`💡 Used general knowledge: ${usedGeneralKnowledge ? 'Yes' : 'No'}`);
  console.log(`🎯 Confidence: ${(adjustedConfidence * 100).toFixed(1)}%`);
  console.log(`📝 Strategy: ${strategy}`);
  console.log(`====================================================\n`);
  
  return {
    steps,
    finalAnswer: finalAnswer.trim(),
    confidenceScore: adjustedConfidence,
    evidenceChain: uniqueEvidence,
    strategy,
    totalDocumentsUsed: usedDocuments.size,
    usedGeneralKnowledge
  };
}

/**
 * ✅ Calculate string similarity using Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * ✅ Levenshtein distance algorithm
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * ✅ Format multi-hop result for streaming display (HYBRID MODE)
 */
export function formatMultiHopResponse(result: MultiHopResult, language: 'ar' | 'en'): string {
  const isArabic = language === 'ar';
  
  let formatted = '';
  
  // Header with strategy indicator
  const strategyLabel = result.strategy === 'hybrid-multi-hop'
    ? (isArabic ? ' (وضع هجين 💡)' : ' (Hybrid Mode 💡)')
    : '';
  
  formatted += isArabic
    ? `## 🧠 تحليل متعدد الخطوات${strategyLabel}\n\n`
    : `## 🧠 Multi-Hop Analysis${strategyLabel}\n\n`;
  
  // Add hybrid mode explanation if used
  if (result.usedGeneralKnowledge) {
    formatted += isArabic
      ? `💡 **ملاحظة:** استخدم هذا التحليل معلومات من المستندات والمعرفة العامة.\n\n`
      : `💡 **Note:** This analysis combines document information with general knowledge.\n\n`;
  }
  
  // Reasoning steps (collapsible)
  formatted += isArabic
    ? `<details>\n<summary>📋 عرض خطوات التحليل (${result.steps.length} خطوات)</summary>\n\n`
    : `<details>\n<summary>📋 View Reasoning Steps (${result.steps.length} steps)</summary>\n\n`;
  
  result.steps.forEach((step, i) => {
    const knowledgeIcon = step.usedGeneralKnowledge ? ' 💡' : '';
    
    formatted += isArabic
      ? `### خطوة ${i + 1}: ${step.question}${knowledgeIcon}\n\n`
      : `### Step ${i + 1}: ${step.question}${knowledgeIcon}\n\n`;
    
    formatted += `**${isArabic ? 'الجواب' : 'Answer'}:** ${step.answer}\n\n`;
    
    const sources = step.usedGeneralKnowledge
      ? (isArabic ? 'معرفة عامة' : 'General Knowledge')
      : step.documentSources.slice(0, 3).join(', ');
    
    formatted += `**${isArabic ? 'المصادر' : 'Sources'}:** ${sources}\n\n`;
    formatted += `**${isArabic ? 'الثقة' : 'Confidence'}:** ${(step.confidence * 100).toFixed(1)}%\n\n`;
    formatted += '---\n\n';
  });
  
  formatted += `</details>\n\n`;
  
  // Final answer
  formatted += isArabic
    ? `## 📝 الإجابة النهائية\n\n`
    : `## 📝 Final Answer\n\n`;
  
  formatted += result.finalAnswer + '\n\n';
  
  // Metadata
  formatted += '---\n\n';
  formatted += isArabic
    ? `📊 **الإحصائيات:**\n`
    : `📊 **Statistics:**\n`;
  
  formatted += isArabic
    ? `- خطوات التحليل: ${result.steps.length}\n`
    : `- Analysis steps: ${result.steps.length}\n`;
  
  formatted += isArabic
    ? `- مستندات مستخدمة: ${result.totalDocumentsUsed}\n`
    : `- Documents used: ${result.totalDocumentsUsed}\n`;
  
  formatted += isArabic
    ? `- مصادر الأدلة: ${result.evidenceChain.length}\n`
    : `- Evidence sources: ${result.evidenceChain.length}\n`;
  
  if (result.usedGeneralKnowledge) {
    formatted += isArabic
      ? `- استخدام المعرفة العامة: نعم 💡\n`
      : `- General knowledge used: Yes 💡\n`;
  }
  
  formatted += isArabic
    ? `- الثقة الإجمالية: ${(result.confidenceScore * 100).toFixed(1)}%\n`
    : `- Overall confidence: ${(result.confidenceScore * 100).toFixed(1)}%\n`;
  
  return formatted;
}