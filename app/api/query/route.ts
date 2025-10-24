import { NextRequest } from 'next/server';
import { searchSimilarChunks } from '@/lib/vectorStore';
import { getDb } from '@/lib/db';
import { embedText, generateResponse } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  (async () => {
    try {
      const { query, documentIds } = await request.json();

      console.log('📝 Query:', query);
      console.log('📚 Documents:', documentIds?.length || 0);

      if (!query || !documentIds || documentIds.length === 0) {
        await writer.write(encoder.encode(
          'Please select at least one document from the corpus before asking questions.\n\n' +
          'الرجاء اختيار مستند واحد على الأقل من المكتبة قبل طرح الأسئلة.'
        ));
        await writer.close();
        return;
      }

      // Step 1: Embed query
      const queryEmbedding = await embedText(query);

      // Step 2: Search
      const rawResults = await searchSimilarChunks(queryEmbedding, documentIds, 50);
      
      const filteredResults = rawResults
        .filter((r: any) => 
          r.chunk_text && 
          r.chunk_text.length >= 150 &&
          (r.similarity || 0) >= 0.3
        )
        .slice(0, 10);

      console.log(`🔍 Search results: ${rawResults.length} → ${filteredResults.length} after filtering`);

      if (filteredResults.length === 0) {
        await writer.write(encoder.encode(
          'No relevant information found in the selected documents.\n\n' +
          'لم يتم العثور على معلومات ذات صلة في المستندات المحددة.\n\n' +
          `Debug: Found ${rawResults.length} chunks but none passed quality filters (similarity > 0.3, length > 150 chars)`
        ));
        await writer.close();
        return;
      }

      // Step 3: Build context
      const db = getDb();
      const context = filteredResults.map((r: any, i: number) => {
        const doc = db.prepare('SELECT display_name FROM documents WHERE id = ?').get(r.document_id) as any;
        return `━━━ Excerpt ${i + 1} / مقتطف ${i + 1} ━━━
📖 Source / المصدر: ${doc?.display_name || 'Unknown'}
📄 Page / الصفحة: ${r.page_number}
🎯 Similarity / التشابه: ${((r.similarity || 0) * 100).toFixed(1)}%

${r.chunk_text}`;
      }).join('\n\n');

      console.log(`📄 Context: ${context.length} chars, ${filteredResults.length} excerpts`);

      // Step 4: Generate response with improved prompt
      // Replace the prompt with this MUCH BETTER version:

const prompt = `You are an expert literary and research assistant with deep knowledge of Arabic and Islamic studies.

**RESPONSE STRATEGY:**

1. **Primary Source**: Use the document excerpts below as your PRIMARY evidence
2. **Reasoning**: Apply literary analysis, psychology, and critical thinking to interpret the excerpts
3. **Synthesis**: Connect ideas across multiple excerpts to form coherent answers
4. **Language**: Match the user's language (English question → English answer, Arabic → Arabic), make sure you follow this
Also if the user specifies a language, follow that strictly.
5. **Citations**: Always cite page numbers when referencing specific excerpts

**IMPORTANT - Be Helpful, Not Restrictive:**
- If excerpts contain relevant information, analyze and synthesize it
- Use your knowledge to INTERPRET the excerpts (character psychology, literary themes, etc.)
- Only say "insufficient information" if the excerpts are truly unrelated to the question
- For narrative questions, feel free to discuss themes, character development, symbolism

**Document Excerpts:**

${context}

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**User's Question:**
${query}

**Your Answer (cite pages, analyze deeply, synthesize insights):**`;

      console.log('🤖 Querying Gemini...');

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
      
      try {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await writer.write(encoder.encode(
          `Error processing query / حدث خطأ في معالجة السؤال:\n${errorMsg}`
        ));
        await writer.close();
      } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  });
}