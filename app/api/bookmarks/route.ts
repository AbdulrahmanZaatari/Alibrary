import { NextRequest } from 'next/server';
import { searchSimilarChunks } from '@/lib/vectorStore';
import { getDb } from '@/lib/db';
import { embedText, generateResponse } from '@/lib/gemini'; // ✅ Import generateResponse

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { query, documentIds } = await request.json();

      if (!query || !documentIds || documentIds.length === 0) {
        await writer.write(encoder.encode('Please select at least one document from the corpus.'));
        await writer.close();
        return;
      }

      console.log('📝 Query:', query);
      console.log('📚 Document IDs:', documentIds);

      // 1. Embed query → Gemini API
      console.log('🔄 Generating embedding...');
      const queryEmbedding = await embedText(query);
      console.log('✅ Embedding generated');

      // 2. Search vectors → Supabase
      console.log('🔍 Searching similar chunks...');
      const results = await searchSimilarChunks(queryEmbedding, documentIds, 5);
      console.log('✅ Found chunks:', results?.length || 0);

      if (!results || results.length === 0) {
        await writer.write(encoder.encode('No relevant information found in the selected documents.'));
        await writer.close();
        return;
      }

      // 3. Get document names → SQLite
      const db = getDb();
      const context = results.map((r: any) => {
        const doc = db.prepare('SELECT display_name FROM documents WHERE id = ?').get(r.document_id) as any;
        return `[${doc?.display_name || 'Unknown'} - Page ${r.page_number}]\n${r.chunk_text}`;
      }).join('\n\n---\n\n');

      console.log('📄 Context built:', context.length, 'characters');

      // 4. Generate response with streaming
      const prompt = `You are an expert Islamic scholar assistant. Based on the following excerpts from Islamic texts, answer the user's question accurately and cite the page numbers.

Context from documents:
${context}

User question: ${query}

Please provide a detailed answer in the same language as the question, citing page numbers where appropriate.`;

      console.log('🤖 Querying Gemini...');

      // ✅ Use gemini.ts generateResponse
      const geminiStream = await generateResponse(prompt);

      for await (const chunk of geminiStream) {
        const text = chunk.text();
        if (text) {
          await writer.write(encoder.encode(text));
        }
      }

      console.log('✅ Response complete');
      await writer.close();

    } catch (error) {
      console.error('❌ Query error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      
      try {
        await writer.write(encoder.encode('Error processing query. Please try again.'));
        await writer.close();
      } catch (writeError) {
        console.error('Failed to write error:', writeError);
      }
    }
  })();

  return new Response(stream.readable, {
    headers: { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  });
}