import { GoogleGenerativeAI } from '@google/generative-ai';
import { OpenRouter } from '@openrouter/sdk';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY not found');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Initialize OpenRouter client
const openRouter = process.env.OPENROUTER_API_KEY 
  ? new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
  : null;

// ✅ OpenRouter models (free tier)
const OPENROUTER_MODELS = [
  'qwen/qwen3-235b-a22b:free',  // Qwen 235B - 50 free requests/day
];

// ✅ Model hierarchy for fallback (best to worst)
const CHAT_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.0-flash'
];


const RERANK_MODELS = [
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.0-flash',
];

// Embed text using Gemini
export const embedText = async (text: string): Promise<number[]> => {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
};

// ✅ Check if model is an OpenRouter model
const isOpenRouterModel = (model: string): boolean => {
  return model.includes('/') || OPENROUTER_MODELS.includes(model);
};

// ✅ Generate response with OpenRouter streaming
async function* streamOpenRouterResponse(prompt: string, model: string): AsyncIterable<any> {
  if (!openRouter) {
    throw new Error('OpenRouter API key not configured');
  }

  console.log(`🌐 [OpenRouter] Streaming with ${model}...`);
  
  const stream = await openRouter.chat.send({
    model,
    messages: [
      { role: 'user', content: prompt }
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      // Wrap in Gemini-compatible format
      yield {
        text: () => content
      };
    }
  }
}

// ✅ Generate response with streaming + model fallback
export const generateResponse = async (
  prompt: string,
  preferredModel?: string
): Promise<{ stream: AsyncIterable<any>; modelUsed: string }> => {
  // Handle OpenRouter models first
  if (preferredModel && isOpenRouterModel(preferredModel)) {
    try {
      console.log(`🤖 Using OpenRouter model: ${preferredModel}`);
      const stream = streamOpenRouterResponse(prompt, preferredModel);
      return { stream, modelUsed: preferredModel };
    } catch (error: any) {
      console.error(`❌ OpenRouter ${preferredModel} failed:`, error.message);
      // Fall through to Gemini models
    }
  }

  const modelsToTry = preferredModel && !isOpenRouterModel(preferredModel)
    ? [preferredModel, ...CHAT_MODELS.filter(m => m !== preferredModel)]
    : CHAT_MODELS;

  const errors: Array<{ model: string; error: string; reason: string }> = [];

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelName = modelsToTry[i];
    try {
      console.log(`🤖 Trying model: ${modelName}`);
      
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      });
      
      const result = await model.generateContentStream(prompt);
      console.log(`✅ Success with ${modelName}`);
      
      return { 
        stream: result.stream, 
        modelUsed: modelName 
      };
      
    } catch (error: any) {
      const isQuotaError = error?.status === 429 || 
                          error?.message?.includes('quota') || 
                          error?.message?.includes('RESOURCE_EXHAUSTED');
      
      const isUnsupported = error?.status === 400 || 
                           error?.message?.includes('model not found') ||
                           error?.message?.includes('Invalid model');
      
      const isLastModel = i === modelsToTry.length - 1;
      
      let errorReason = 'Unknown error';
      if (isQuotaError) errorReason = 'Quota exceeded';
      else if (isUnsupported) errorReason = 'Model not available';
      else errorReason = error.message;

      errors.push({ model: modelName, error: error.message, reason: errorReason });
      
      if ((isQuotaError || isUnsupported) && !isLastModel) {
        console.warn(`⚠️ ${modelName} failed (${errorReason}), trying next model...`);
        continue;
      }
      
      console.error(`❌ ${modelName} failed:`, error.message);
      if (isLastModel) {
        const errorSummary = errors.map(e => `${e.model}: ${e.reason}`).join('\n');
        throw new Error(`All models failed:\n${errorSummary}`);
      }
    }
  }
  
  throw new Error('Failed to generate response with all available models');
};

// ✅ PRODUCTION-GRADE CHUNKING FUNCTION
export const chunkText = (
  text: string, 
  chunkSize: number = 1200,
  overlap: number = 200
): string[] => {
  console.log('📦 Starting text chunking...');
  console.log(`   Original text length: ${text.length} characters`);

  // ✅ Step 1: Clean and normalize text - PRESERVE ARABIC DIACRITICAL MARKS
  // NOTE: We NO LONGER normalize أ/إ/آ→ا or ى→ي or ة→ه because:
  // 1. AI correction has already fixed OCR errors
  // 2. These characters have distinct meanings in Arabic
  // 3. Normalization destroys the semantic value
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/[-_]+\s*\d+\s*[-_]+/g, '')  // Remove page markers
    .replace(/صفحة\s*\d+/g, '')            // Remove Arabic page numbers
    .replace(/Page\s*\d+/gi, '')           // Remove English page numbers
    .replace(/[_-]{3,}/g, '')              // Remove separator lines
    .replace(/\n{3,}/g, '\n\n')            // Normalize multiple newlines
    .trim();

  console.log(`   Cleaned text length: ${cleanText.length} characters`);

  const arabicSentenceEndings = /[.!?؟۔।။।。]+/g;
  const sentences = cleanText.split(arabicSentenceEndings)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  console.log(`   Found ${sentences.length} sentences`);

  const chunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const testChunk = currentChunk + (currentChunk ? '. ' : '') + sentence;

    if (testChunk.length > chunkSize && currentChunk.length > 0) {
      if (isSubstantialContent(currentChunk)) {
        chunks.push(currentChunk.trim() + '.');
        console.log(`   ✓ Created chunk ${chunks.length}: ${currentChunk.length} chars`);
      } else {
        console.log(`   ✗ Skipped header-only chunk: "${currentChunk.substring(0, 50)}..."`);
      }

      const sentencesInChunk = currentChunk.split(/[.!?؟]+/).filter(s => s.length > 10);
      const overlapSentences = sentencesInChunk.slice(-3).join('. ');
      currentChunk = overlapSentences + (overlapSentences ? '. ' : '') + sentence;
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim().length > 0 && isSubstantialContent(currentChunk)) {
    chunks.push(currentChunk.trim() + '.');
    console.log(`   ✓ Created final chunk ${chunks.length}: ${currentChunk.length} chars`);
  }

  console.log(`✅ Chunking complete: ${chunks.length} valid chunks created`);
  
  const avgLength = chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length;
  const tooShort = chunks.filter(c => c.length < 200).length;
  
  console.log(`📊 Chunk Statistics:`);
  console.log(`   - Total chunks: ${chunks.length}`);
  console.log(`   - Average length: ${Math.round(avgLength)} chars`);
  console.log(`   - Chunks < 200 chars: ${tooShort}`);
  console.log(`   - Coverage: ${((chunks.join('').length / text.length) * 100).toFixed(1)}%`);

  return chunks;
};

export async function rerankChunks(
  originalQuery: string,
  chunks: any[],
  targetTopN: number = 10
): Promise<any[]> {
  if (chunks.length === 0) {
    return [];
  }

  console.log(`🤖 Starting Re-ranking: ${chunks.length} chunks for query: "${originalQuery}"`);

  const chunkList = chunks
    .map((chunk, index) => {
      const preview = chunk.chunk_text.substring(0, 400).replace(/\n/g, ' ');
      return `[${index}] (Page ${chunk.page_number}, Sim: ${((chunk.similarity || 0) * 100).toFixed(1)}%)\n${preview}...\n`;
    })
    .join('\n');

  // ✅ Use fallback models for reranking
  for (const modelName of RERANK_MODELS) {
    try {
      console.log(`🔄 Reranking with ${modelName}...`);
      
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.1,
        }
      });

      const prompt = `You are a search relevance expert. Rank these text chunks by relevance to the query.

QUERY: "${originalQuery}"

CHUNKS (${chunks.length} total):
${chunkList}

Return ONLY a single flat JSON array of the top ${Math.min(targetTopN, chunks.length)} chunk indices (just numbers), ordered from most to least relevant.

CORRECT format: [5, 2, 10, 1, 8, 14, 3]
WRONG format: [[5], [2], [10]]

Your response (numbers only):`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      console.log(`📄 Reranker raw response: ${text.substring(0, 200)}`);

      let indices: number[] = [];
      
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          indices = parsed.flat().filter(i => typeof i === 'number');
        }
      } catch {
        const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (codeBlockMatch) {
          const parsed = JSON.parse(codeBlockMatch[1]);
          indices = Array.isArray(parsed) ? parsed.flat().filter(i => typeof i === 'number') : [];
        } else {
          const arrayMatch = text.match(/\[[\d,\[\]\s]+\]/);
          if (arrayMatch) {
            const parsed = JSON.parse(arrayMatch[0]);
            indices = Array.isArray(parsed) ? parsed.flat().filter(i => typeof i === 'number') : [];
          }
        }
      }

      if (!Array.isArray(indices) || indices.length === 0) {
        console.warn(`⚠️ ${modelName} returned invalid indices, trying next model...`);
        continue;
      }

      const validIndices = indices.filter(i => i >= 0 && i < chunks.length);

      if (validIndices.length === 0) {
        console.warn(`⚠️ No valid indices from ${modelName}, trying next model...`);
        continue;
      }

      const uniqueIndices = [...new Set(validIndices)];
      const rerankedChunks = uniqueIndices
        .map(index => chunks[index])
        .filter(chunk => chunk);
        
      console.log(`✅ Re-ranking complete with ${modelName}. Top ${rerankedChunks.length} chunks selected`);
      
      return rerankedChunks.slice(0, targetTopN);

    } catch (error: any) {
      const isQuotaError = error?.status === 429 || error?.message?.includes('quota');
      console.error(`❌ ${modelName} reranking failed: ${error.message}`);
      
      if (!isQuotaError) {
        break; // Non-quota error, don't try other models
      }
    }
  }

  console.warn('⚠️ All reranking models failed. Using original order.');
  return chunks.slice(0, targetTopN);
}

function isSubstantialContent(text: string): boolean {
  const trimmed = text.trim();
  
  if (trimmed.length < 150) return false;
  if (/^[-_\d\s.]+$/.test(trimmed)) return false;
  if (/^(الباب|الفصل|Chapter|Section)\s+[\u0600-\u06FF\w\s]+$/i.test(trimmed)) return false;
  
  const sentenceCount = (trimmed.match(/[.!?؟]+/g) || []).length;
  if (sentenceCount < 3) return false;
  
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 30) return false;
  
  return true;
}

export default genAI;