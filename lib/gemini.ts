import { GoogleGenerativeAI } from '@google/generative-ai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY not found');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Embed text using Gemini
export const embedText = async (text: string): Promise<number[]> => {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
};

// Generate response with streaming
export const generateResponse = async (prompt: string) => {
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    }
  });
  const result = await model.generateContentStream(prompt);
  return result.stream;
};

// ✅ PRODUCTION-GRADE CHUNKING FUNCTION
export const chunkText = (
  text: string, 
  chunkSize: number = 1200,      // Optimal size for Arabic text
  overlap: number = 200           // Good overlap for context
): string[] => {
  console.log('📦 Starting text chunking...');
  console.log(`   Original text length: ${text.length} characters`);

  // ✅ Step 1: Clean and normalize text
  const cleanText = text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove page numbers (Arabic and English)
    .replace(/[-_]+\s*\d+\s*[-_]+/g, '')
    .replace(/صفحة\s*\d+/g, '')
    .replace(/Page\s*\d+/gi, '')
    // Remove repetitive dashes/underscores
    .replace(/[_-]{3,}/g, '')
    // Normalize Arabic characters
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  console.log(`   Cleaned text length: ${cleanText.length} characters`);

  // ✅ Step 2: Split into sentences (Arabic-aware)
  const arabicSentenceEndings = /[.!?؟۔।။।。]+/g;
  const sentences = cleanText.split(arabicSentenceEndings)
    .map(s => s.trim())
    .filter(s => s.length > 20); // Ignore very short sentences

  console.log(`   Found ${sentences.length} sentences`);

  // ✅ Step 3: Build chunks with semantic boundaries
  const chunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const testChunk = currentChunk + (currentChunk ? '. ' : '') + sentence;

    if (testChunk.length > chunkSize && currentChunk.length > 0) {
      // Only add chunk if it's substantial (not just headers)
      if (isSubstantialContent(currentChunk)) {
        chunks.push(currentChunk.trim() + '.');
        console.log(`   ✓ Created chunk ${chunks.length}: ${currentChunk.length} chars`);
      } else {
        console.log(`   ✗ Skipped header-only chunk: "${currentChunk.substring(0, 50)}..."`);
      }

      // Create overlap by including last few sentences
      const sentencesInChunk = currentChunk.split(/[.!?؟]+/).filter(s => s.length > 10);
      const overlapSentences = sentencesInChunk.slice(-3).join('. '); // Last 3 sentences
      currentChunk = overlapSentences + (overlapSentences ? '. ' : '') + sentence;
    } else {
      currentChunk = testChunk;
    }
  }

  // Add final chunk if substantial
  if (currentChunk.trim().length > 0 && isSubstantialContent(currentChunk)) {
    chunks.push(currentChunk.trim() + '.');
    console.log(`   ✓ Created final chunk ${chunks.length}: ${currentChunk.length} chars`);
  }

  console.log(`✅ Chunking complete: ${chunks.length} valid chunks created`);
  
  // ✅ Step 4: Quality check
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

  // Create a numbered list of chunks for the prompt
  const chunkList = chunks
    .map((chunk, index) => {
      const preview = chunk.chunk_text.substring(0, 400).replace(/\n/g, ' ');
      return `[${index}] (Page ${chunk.page_number}, Sim: ${((chunk.similarity || 0) * 100).toFixed(1)}%)\n${preview}...\n`;
    })
    .join('\n');

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash-lite',
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

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    console.log(`📄 Reranker raw response: ${text.substring(0, 200)}`);

    let indices: number[] = [];
    
    // Method 1: Direct JSON parse
    try {
      const parsed = JSON.parse(text);
      // Handle nested arrays: [[1], [6]] -> [1, 6]
      if (Array.isArray(parsed)) {
        indices = parsed.flat().filter(i => typeof i === 'number');
      }
    } catch {
      // Method 2: Extract array from markdown code block
      const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      if (codeBlockMatch) {
        const parsed = JSON.parse(codeBlockMatch[1]);
        indices = Array.isArray(parsed) ? parsed.flat().filter(i => typeof i === 'number') : [];
      } else {
        // Method 3: Find any array in the text
        const arrayMatch = text.match(/\[[\d,\[\]\s]+\]/);
        if (arrayMatch) {
          const parsed = JSON.parse(arrayMatch[0]);
          indices = Array.isArray(parsed) ? parsed.flat().filter(i => typeof i === 'number') : [];
        }
      }
    }

    if (!Array.isArray(indices) || indices.length === 0) {
      console.warn('⚠️ Re-ranker did not return valid indices. Using original order.');
      return chunks.slice(0, targetTopN);
    }

    // Validate indices are within bounds
    const validIndices = indices.filter(i => i >= 0 && i < chunks.length);

    if (validIndices.length === 0) {
      console.warn('⚠️ No valid indices found. Using original order.');
      return chunks.slice(0, targetTopN);
    }

    // Remove duplicates while preserving order
    const uniqueIndices = [...new Set(validIndices)];

    // Map the indices back to the original chunks
    const rerankedChunks = uniqueIndices
      .map(index => chunks[index])
      .filter(chunk => chunk);
      
    console.log(`✅ Re-ranking complete. Top ${rerankedChunks.length} chunks selected`);
    console.log(`   Indices: [${uniqueIndices.slice(0, 10).join(', ')}${uniqueIndices.length > 10 ? '...' : ''}]`);
    
    return rerankedChunks.slice(0, targetTopN);

  } catch (error: any) {
    console.error(`❌ Re-ranking failed: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return chunks.slice(0, targetTopN);
  }
}

// ✅ Helper: Detect if content is substantial (not just headers/page numbers)
function isSubstantialContent(text: string): boolean {
  const trimmed = text.trim();
  
  // Too short
  if (trimmed.length < 150) return false;
  
  // Just numbers and dashes
  if (/^[-_\d\s.]+$/.test(trimmed)) return false;
  
  // Just chapter titles (e.g., "الباب الثالث")
  if (/^(الباب|الفصل|Chapter|Section)\s+[\u0600-\u06FF\w\s]+$/i.test(trimmed)) return false;
  
  // Must have at least 3 sentences
  const sentenceCount = (trimmed.match(/[.!?؟]+/g) || []).length;
  if (sentenceCount < 3) return false;
  
  // Must have enough words (not just a title)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 30) return false;
  
  return true;
}

export default genAI;