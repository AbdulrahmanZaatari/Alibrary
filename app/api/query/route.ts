import { NextRequest } from 'next/server';
import { searchSimilarChunks } from '@/lib/vectorStore';
import { getDb } from '@/lib/db';
import { embedText, generateResponse } from '@/lib/gemini';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext } from '@/lib/smartRetrieval';

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

      // ✅ Step 1: Analyze query
      const queryAnalysis = await analyzeQuery(query, 'ar');
      
      // ✅ Step 2: Smart retrieval
      const { chunks, strategy, confidence } = await retrieveSmartContext(queryAnalysis, documentIds);

      console.log(`✅ Retrieved ${chunks.length} chunks using ${strategy} (confidence: ${(confidence * 100).toFixed(1)}%)`);

      if (chunks.length === 0) {
        await writer.write(encoder.encode(
          'No relevant information found in the selected documents.\n\n' +
          'لم يتم العثور على معلومات ذات صلة في المستندات المحددة.'
        ));
        await writer.close();
        return;
      }

      // ✅ Step 3: Group chunks by document
      const chunksByDocument = new Map<string, any[]>();
      
      chunks.forEach(chunk => {
        if (!chunksByDocument.has(chunk.document_id)) {
          chunksByDocument.set(chunk.document_id, []);
        }
        chunksByDocument.get(chunk.document_id)!.push(chunk);
      });

      console.log(`📚 Chunks distributed across ${chunksByDocument.size} document(s)`);

      // ✅ Step 4: Build context with document separation
      const db = getDb();
      
      const documentContexts = Array.from(chunksByDocument.entries()).map(([docId, docChunks], index) => {
        const doc = db.prepare('SELECT display_name FROM documents WHERE id = ?').get(docId) as any;
        const docName = doc?.display_name || `Document ${index + 1}`;
        
        const docHeader = `## 📘 ${docName}`;
        
        const excerpts = docChunks.map((chunk, i) => {
          const similarity = ((chunk.similarity || 0) * 100).toFixed(1);
          return `**📄 Page ${chunk.page_number}** (Similarity: ${similarity}%)\n${chunk.chunk_text}`;
        }).join('\n\n---\n\n');
        
        return `${docHeader}\n\n${excerpts}`;
      }).join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

      // ✅ Step 5: Build prompt
      const isMultiDoc = documentIds.length > 1;
      const isComparative = queryAnalysis.isMultiDocumentQuery;
      
      let multiDocInstruction = '';
      if (isMultiDoc && isComparative) {
        multiDocInstruction = '\n\n**IMPORTANT:** This is a comparative question. Compare and contrast information across ALL documents. Clearly indicate similarities, differences, and unique aspects of each document.\n\n';
      } else if (isMultiDoc) {
        multiDocInstruction = '\n\n**IMPORTANT:** Multiple documents are provided. Analyze information from ALL documents and synthesize findings.\n\n';
      }

      const prompt = `You are an expert literary and research assistant with deep knowledge of Arabic and Islamic studies.

**RESPONSE STRATEGY:**

1. **Primary Source**: Use the document excerpts below as your PRIMARY evidence
2. **Reasoning**: Apply literary analysis, psychology, and critical thinking to interpret the excerpts
3. **Synthesis**: Connect ideas across multiple excerpts/documents to form coherent answers
4. **Language**: Match the user's language (English question → English answer, Arabic → Arabic)
5. **Citations**: Always cite document names and page numbers

**Be Helpful:**
- Analyze and synthesize the excerpts
- Use your knowledge to INTERPRET the content
- For narrative questions, discuss themes, character development, symbolism
- Only say "insufficient information" if excerpts are truly unrelated

${multiDocInstruction}**Document Excerpts:**

${documentContexts}

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**User's Question:**
${query}

**Your Answer (cite sources, analyze deeply, synthesize insights):**`;

      console.log('🤖 Querying Gemini...');

      const { stream: geminiStream } = await generateResponse(prompt);

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