import { GoogleGenerativeAI } from '@google/generative-ai';
import { retrieveSmartContext } from './smartRetrieval';
import { analyzeQuery } from './queryProcessor';
import { generateResponse } from './gemini';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const ANALYSIS_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.0-flash'
];

/**
 * ✅ Multi-Pass Generation for improved RAG quality
 * 
 * Pass 1: Generate initial draft with first retrieval
 * Pass 2: Analyze gaps in the response, retrieve more targeted context
 * Pass 3: Refine final answer with enriched context
 */
export interface MultiPassResult {
  finalResponse: string;
  passDetails: PassDetail[];
  totalChunksUsed: number;
  refinementCount: number;
  confidence: number;
}

interface PassDetail {
  passNumber: number;
  action: string;
  chunksRetrieved: number;
  gapsIdentified?: string[];
  refinements?: string[];
}

/**
 * ✅ Identify gaps in the initial response that need more context
 */
async function identifyResponseGaps(
  query: string,
  initialResponse: string,
  language: 'ar' | 'en'
): Promise<{
  gaps: string[];
  additionalQueries: string[];
  needsRefinement: boolean;
  confidence: number;
}> {
  const prompt = language === 'ar'
    ? `أنت محلل جودة إجابات. حلل الإجابة التالية وحدد الثغرات.

**السؤال الأصلي:**
${query}

**الإجابة الأولية:**
${initialResponse}

**المهمة:** حدد:
1. ما هي المعلومات الناقصة أو غير المكتملة؟
2. ما هي الاستفسارات الإضافية التي يمكن أن تحسن الإجابة؟
3. هل الإجابة تحتاج تحسين؟ (نعم/لا)
4. ما مستوى الثقة في الإجابة الحالية؟ (0-100)

أجب بتنسيق JSON:
{
  "gaps": ["ثغرة 1", "ثغرة 2"],
  "additionalQueries": ["استفسار 1", "استفسار 2"],
  "needsRefinement": true/false,
  "confidence": 75
}`
    : `You are a response quality analyzer. Analyze the following response and identify gaps.

**Original Question:**
${query}

**Initial Response:**
${initialResponse}

**Task:** Identify:
1. What information is missing or incomplete?
2. What additional queries could improve the response?
3. Does the response need refinement? (yes/no)
4. What is the confidence level in the current response? (0-100)

Respond in JSON format:
{
  "gaps": ["gap 1", "gap 2"],
  "additionalQueries": ["query 1", "query 2"],
  "needsRefinement": true/false,
  "confidence": 75
}`;

  for (const modelName of ANALYSIS_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.3 }
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          gaps: parsed.gaps || [],
          additionalQueries: parsed.additionalQueries || [],
          needsRefinement: parsed.needsRefinement ?? true,
          confidence: parsed.confidence || 70
        };
      }
    } catch (error) {
      console.warn(`⚠️ Gap analysis with ${modelName} failed:`, error);
    }
  }

  return {
    gaps: [],
    additionalQueries: [],
    needsRefinement: false,
    confidence: 60
  };
}

/**
 * ✅ Refine response with additional context
 */
async function refineResponse(
  query: string,
  initialResponse: string,
  additionalContext: string,
  gaps: string[],
  language: 'ar' | 'en',
  preferredModel?: string
): Promise<string> {
  const gapsSection = gaps.length > 0
    ? (language === 'ar' 
        ? `\n\n**الثغرات المحددة للتحسين:**\n${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}`
        : `\n\n**Identified gaps to address:**\n${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}`)
    : '';

  const prompt = language === 'ar'
    ? `أنت مساعد بحثي متخصص. حسّن الإجابة التالية باستخدام السياق الإضافي.

**السؤال:**
${query}

**الإجابة الأولية:**
${initialResponse}
${gapsSection}

**السياق الإضافي:**
${additionalContext}

**المهمة:** 
- أعد كتابة الإجابة بشكل محسّن
- أضف المعلومات الناقصة من السياق الإضافي
- حافظ على ما كان صحيحاً في الإجابة الأولية
- استخدم تنسيق Markdown
- أجب باللغة العربية فقط

**الإجابة المحسّنة:**`
    : `You are a specialized research assistant. Improve the following response using additional context.

**Question:**
${query}

**Initial Response:**
${initialResponse}
${gapsSection}

**Additional Context:**
${additionalContext}

**Task:**
- Rewrite the response in an improved way
- Add missing information from the additional context
- Preserve what was correct in the initial response
- Use Markdown formatting

**Improved Response:**`;

  const { stream, modelUsed } = await generateResponse(prompt, preferredModel);
  
  let refinedResponse = '';
  for await (const chunk of stream) {
    refinedResponse += chunk.text();
  }

  console.log(`✅ Response refined using ${modelUsed}`);
  return refinedResponse;
}

/**
 * ✅ Main Multi-Pass Generation function
 * 
 * @param query - User's question
 * @param documentIds - Documents to search
 * @param language - Query language
 * @param numPasses - Number of refinement passes (2 or 3)
 * @param useReranking - Whether to use reranking
 * @param useKeywordSearch - Whether to use keyword search
 * @param preferredModel - Preferred model for generation
 */
export async function performMultiPassGeneration(
  query: string,
  documentIds: string[],
  language: 'ar' | 'en',
  numPasses: number = 2,
  useReranking: boolean = true,
  useKeywordSearch: boolean = false,
  preferredModel?: string
): Promise<MultiPassResult> {
  console.log(`\n🔄 MULTI-PASS GENERATION (${numPasses} passes)`);
  console.log(`   Query: ${query.substring(0, 50)}...`);
  
  const passDetails: PassDetail[] = [];
  let totalChunksUsed = 0;
  let currentResponse = '';
  
  // ==================== PASS 1: Initial Retrieval & Draft ====================
  console.log('\n━━━ PASS 1: Initial Draft ━━━');
  
  const queryAnalysis = await analyzeQuery(query, language);
  
  const { chunks: initialChunks, strategy } = await retrieveSmartContext(
    queryAnalysis,
    documentIds,
    useReranking,
    useKeywordSearch
  );

  console.log(`   Retrieved ${initialChunks.length} chunks using ${strategy}`);
  totalChunksUsed += initialChunks.length;

  // Build initial context
  const initialContext = initialChunks
    .slice(0, 10)
    .map(chunk => {
      const pageHeader = language === 'ar'
        ? `📄 صفحة ${chunk.page_number}`
        : `📄 Page ${chunk.page_number}`;
      
      // Include metadata if available
      const metadata = chunk.metadata || {};
      const metadataStr = metadata.section 
        ? ` | ${language === 'ar' ? 'القسم' : 'Section'}: ${metadata.section}`
        : '';
      
      return `**${pageHeader}${metadataStr}**\n${chunk.chunk_text}`;
    })
    .join('\n\n---\n\n');

  // Generate initial draft
  const initialPrompt = language === 'ar'
    ? `أنت مساعد بحثي دقيق. استخدم السياق التالي للإجابة على السؤال.

**السؤال:** ${query}

**السياق:**
${initialContext}

**الإجابة (باللغة العربية، باستخدام Markdown):**`
    : `You are an accurate research assistant. Use the following context to answer the question.

**Question:** ${query}

**Context:**
${initialContext}

**Answer (using Markdown):**`;

  const { stream: initialStream, modelUsed } = await generateResponse(initialPrompt, preferredModel);
  
  for await (const chunk of initialStream) {
    currentResponse += chunk.text();
  }

  passDetails.push({
    passNumber: 1,
    action: 'Initial retrieval and draft generation',
    chunksRetrieved: initialChunks.length
  });

  console.log(`   ✅ Draft generated (${currentResponse.length} chars) with ${modelUsed}`);

  // ==================== PASS 2: Gap Analysis & Targeted Retrieval ====================
  if (numPasses >= 2) {
    console.log('\n━━━ PASS 2: Gap Analysis & Refinement ━━━');
    
    const gapAnalysis = await identifyResponseGaps(query, currentResponse, language);
    
    console.log(`   Gaps found: ${gapAnalysis.gaps.length}`);
    console.log(`   Additional queries: ${gapAnalysis.additionalQueries.length}`);
    console.log(`   Needs refinement: ${gapAnalysis.needsRefinement}`);
    console.log(`   Confidence: ${gapAnalysis.confidence}%`);

    if (gapAnalysis.needsRefinement && gapAnalysis.additionalQueries.length > 0) {
      // Retrieve additional context based on gap queries
      let additionalContext = '';
      let additionalChunksCount = 0;

      for (const additionalQuery of gapAnalysis.additionalQueries.slice(0, 2)) {
        const additionalAnalysis = await analyzeQuery(additionalQuery, language);
        
        const { chunks: moreChunks } = await retrieveSmartContext(
          additionalAnalysis,
          documentIds,
          useReranking,
          useKeywordSearch
        );

        // Filter out chunks we already used
        const newChunks = moreChunks.filter(mc => 
          !initialChunks.some(ic => ic.chunk_text === mc.chunk_text)
        );

        if (newChunks.length > 0) {
          additionalContext += newChunks
            .slice(0, 5)
            .map(chunk => `📄 Page ${chunk.page_number}\n${chunk.chunk_text}`)
            .join('\n\n---\n\n');
          
          additionalChunksCount += Math.min(newChunks.length, 5);
        }
      }

      totalChunksUsed += additionalChunksCount;

      if (additionalContext) {
        currentResponse = await refineResponse(
          query,
          currentResponse,
          additionalContext,
          gapAnalysis.gaps,
          language,
          preferredModel
        );
      }

      passDetails.push({
        passNumber: 2,
        action: 'Gap analysis and targeted refinement',
        chunksRetrieved: additionalChunksCount,
        gapsIdentified: gapAnalysis.gaps.slice(0, 3),
        refinements: gapAnalysis.additionalQueries.slice(0, 2)
      });

      console.log(`   ✅ Refined with ${additionalChunksCount} additional chunks`);
    } else {
      passDetails.push({
        passNumber: 2,
        action: 'Gap analysis (no refinement needed)',
        chunksRetrieved: 0,
        gapsIdentified: []
      });
      console.log(`   ✅ No refinement needed`);
    }
  }

  // ==================== PASS 3: Final Polish (Optional) ====================
  if (numPasses >= 3) {
    console.log('\n━━━ PASS 3: Final Polish ━━━');
    
    // Final quality check and polish
    const polishPrompt = language === 'ar'
      ? `راجع الإجابة التالية وحسّنها نهائياً:

**السؤال:** ${query}

**الإجابة الحالية:**
${currentResponse}

**المهمة:**
- تأكد من الوضوح والتنظيم
- أضف عناوين فرعية إذا لزم الأمر
- تأكد من الدقة
- أجب باللغة العربية

**الإجابة النهائية:**`
      : `Review and polish the following response:

**Question:** ${query}

**Current Response:**
${currentResponse}

**Task:**
- Ensure clarity and organization
- Add subheadings if needed
- Verify accuracy

**Final Response:**`;

    const { stream: polishStream } = await generateResponse(polishPrompt, preferredModel);
    
    let polishedResponse = '';
    for await (const chunk of polishStream) {
      polishedResponse += chunk.text();
    }

    currentResponse = polishedResponse;

    passDetails.push({
      passNumber: 3,
      action: 'Final quality polish',
      chunksRetrieved: 0
    });

    console.log(`   ✅ Final polish complete`);
  }

  // Calculate final confidence
  const finalConfidence = Math.min(
    95,
    60 + (totalChunksUsed * 2) + (numPasses * 5)
  );

  console.log(`\n✅ MULTI-PASS GENERATION COMPLETE`);
  console.log(`   Total chunks used: ${totalChunksUsed}`);
  console.log(`   Passes completed: ${passDetails.length}`);
  console.log(`   Confidence: ${finalConfidence}%`);

  return {
    finalResponse: currentResponse,
    passDetails,
    totalChunksUsed,
    refinementCount: passDetails.filter(p => p.chunksRetrieved > 0).length - 1,
    confidence: finalConfidence
  };
}

/**
 * ✅ Format multi-pass result for display
 */
export function formatMultiPassResult(
  result: MultiPassResult,
  language: 'ar' | 'en',
  showDetails: boolean = true
): string {
  let output = result.finalResponse;

  if (showDetails) {
    const detailsSection = language === 'ar'
      ? `\n\n---\n\n📊 **تفاصيل المعالجة المتعددة:**\n` +
        `- المراحل المكتملة: ${result.passDetails.length}\n` +
        `- القطع المستخدمة: ${result.totalChunksUsed}\n` +
        `- التحسينات: ${result.refinementCount}\n` +
        `- الثقة: ${result.confidence}%`
      : `\n\n---\n\n📊 **Multi-Pass Processing Details:**\n` +
        `- Passes completed: ${result.passDetails.length}\n` +
        `- Chunks used: ${result.totalChunksUsed}\n` +
        `- Refinements: ${result.refinementCount}\n` +
        `- Confidence: ${result.confidence}%`;

    output += detailsSection;
  }

  return output;
}
