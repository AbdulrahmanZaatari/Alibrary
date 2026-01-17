import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { generateResponse } from '@/lib/gemini';
import { analyzeQuery } from '@/lib/queryProcessor';
import { retrieveSmartContext } from '@/lib/smartRetrieval';
import { performMultiPassGeneration, formatMultiPassResult } from '@/lib/multiPassGeneration';
import { expandQuery, buildKeywordList } from '@/lib/queryExpansion';

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
        query, 
        documentIds,
        enableMultiPass = false,
        multiPassCount = 2,
        preferredModel,
        useReranking = true,
        useKeywordSearch = false,
        // ✅ NEW: Research mode settings
        researchDepth = 2,
        verificationMode = false,
        listOutput = false,
      } = await request.json();

      const queryLanguage = detectQueryLanguage(query);

      console.log('📝 Query:', query);
      console.log('📚 Documents:', documentIds?.length || 0);
      console.log('🌐 Language:', queryLanguage);
      console.log('⚙️ Options:', { enableMultiPass, useReranking, useKeywordSearch, researchDepth, verificationMode, listOutput });

      if (!query || !documentIds || documentIds.length === 0) {
        await writer.write(encoder.encode(
          'Please select at least one document from the corpus before asking questions.\n\n' +
          'الرجاء اختيار مستند واحد على الأقل من المكتبة قبل طرح الأسئلة.'
        ));
        await writer.close();
        return;
      }

      // ==================== MULTI-PASS GENERATION PATH ====================
      if (enableMultiPass) {
        console.log('\n╔═══════════════════════════════════════════════════════════════╗');
        console.log('║ 🔄 MULTI-PASS GENERATION MODE ACTIVATED                       ║');
        console.log('╠═══════════════════════════════════════════════════════════════╣');
        console.log(`║ 📝 Query: "${query.substring(0, 45)}${query.length > 45 ? '...' : ''}"`);
        console.log(`║ 🔢 Planned passes: ${multiPassCount}`);
        console.log(`║ 📚 Documents: ${documentIds.length}`);
        console.log('╚═══════════════════════════════════════════════════════════════╝');
        
        try {
          const startTime = Date.now();
          
          const multiPassResult = await performMultiPassGeneration(
            query,
            documentIds,
            queryLanguage,
            multiPassCount,
            useReranking,
            useKeywordSearch,
            preferredModel
          );

          const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
          
          console.log('\n┌─────────────────────────────────────────────────────────────┐');
          console.log('│ ✅ MULTI-PASS GENERATION COMPLETE                           │');
          console.log('└─────────────────────────────────────────────────────────────┘');
          console.log(`\n📊 MULTI-PASS IMPACT SUMMARY:`);
          console.log(`   ⏱️  Total time: ${elapsedTime}s`);
          console.log(`   🔄 Passes completed: ${multiPassResult.passDetails.length}`);
          console.log(`   📄 Total chunks retrieved: ${multiPassResult.totalChunksUsed}`);
          console.log(`   🔧 Refinements made: ${multiPassResult.refinementCount}`);
          console.log(`   🎯 Final confidence: ${multiPassResult.confidence}%`);
          
          console.log(`\n📋 PASS-BY-PASS BREAKDOWN:`);
          multiPassResult.passDetails.forEach((pass) => {
            console.log(`   Pass ${pass.passNumber}: ${pass.action}`);
            console.log(`      └─ Chunks: ${pass.chunksRetrieved}`);
            if (pass.gapsIdentified && pass.gapsIdentified.length > 0) {
              console.log(`      └─ Gaps found: ${pass.gapsIdentified.length}`);
              pass.gapsIdentified.forEach(gap => console.log(`         • ${gap.substring(0, 50)}...`));
            }
            if (pass.refinements && pass.refinements.length > 0) {
              console.log(`      └─ Refinement queries: ${pass.refinements.length}`);
            }
          });
          console.log('─────────────────────────────────────────────────────────────\n');

          const formattedResponse = formatMultiPassResult(multiPassResult, queryLanguage, true);
          await writer.write(encoder.encode(formattedResponse));
          await writer.close();
          return;

        } catch (error) {
          console.error('❌ Multi-pass generation failed, falling back to standard:', error);
        }
      }

      // ==================== ARABIC QUERY EXPANSION (Automatic) ====================
      let expandedKeywords: string[] = [];
      if (queryLanguage === 'ar') {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🔤 ARABIC QUERY EXPANSION (Automatic)                       │');
        console.log('└─────────────────────────────────────────────────────────────┘');
        console.log(`📝 Original Query: "${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"`);
        
        const expansion = await expandQuery(query, queryLanguage, true);
        expandedKeywords = buildKeywordList(expansion);
        
        console.log(`\n✨ EXPANSION IMPACT:`);
        console.log(`   📊 Synonyms found: ${expansion.synonyms.length}`);
        if (expansion.synonyms.length > 0) {
          console.log(`      → ${expansion.synonyms.slice(0, 5).join('، ')}`);
        }
        console.log(`   📊 Related terms: ${expansion.relatedTerms.length}`);
        if (expansion.relatedTerms.length > 0) {
          console.log(`      → ${expansion.relatedTerms.slice(0, 5).join('، ')}`);
        }
        console.log(`   📊 Spelling variants: ${expansion.variants.length}`);
        if (expansion.variants.length > 0) {
          console.log(`      → ${expansion.variants.slice(0, 5).join('، ')}`);
        }
        console.log(`   📊 Total keywords for search: ${expandedKeywords.length}`);
        console.log(`   🎯 Confidence: ${Math.round(expansion.confidence * 100)}%`);
        console.log('─────────────────────────────────────────────────────────────');
      }

      // ✅ Step 1: Analyze query
      const queryAnalysis = await analyzeQuery(query, queryLanguage);
      
      // ✅ Add expanded keywords to query analysis
      if (expandedKeywords.length > 0) {
        const originalKeywordCount = queryAnalysis.keywords.length;
        queryAnalysis.keywords = [...new Set([
          ...queryAnalysis.keywords,
          ...expandedKeywords
        ])];
        console.log(`📊 Keywords enriched: ${originalKeywordCount} → ${queryAnalysis.keywords.length}`);
      }
      
      // ✅ Step 2: Smart retrieval
      const { chunks, strategy, confidence } = await retrieveSmartContext(
        queryAnalysis, 
        documentIds,
        useReranking,
        useKeywordSearch
      );

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

      // ✅ NEW: Build verification and list output instructions
      let modeInstructions = '';
      
      if (verificationMode) {
        modeInstructions = queryLanguage === 'ar'
          ? `\n\n⚖️ **وضع التحقق:**
اتبع هذا التنسيق بالضبط:

## ✅ أدلة مؤيدة
لكل دليل:
📄 **صفحة X** - [اسم المستند]
> "الاقتباس المباشر..."
🏷️ السياق: [ملاحظة مختصرة]

---

## ⚠️ أدلة معارضة أو مخففة
[نفس التنسيق]

---

## ⚖️ التقييم
- قوة الأدلة المؤيدة: [قوية/متوسطة/ضعيفة]
- قوة الأدلة المعارضة: [قوية/متوسطة/ضعيفة]
- الخلاصة: [جملة واحدة]

**ابحث بنشاط عن الأدلة المعارضة!**\n`
          : `\n\n⚖️ **VERIFICATION MODE:**
Follow this format exactly:

## ✅ Supporting Evidence
📄 **Page X** - [Document Name]
> "Direct quote..."
🏷️ Context: [Brief note]

---

## ⚠️ Opposing/Nuancing Evidence
[Same format]

---

## ⚖️ Assessment
- Supporting evidence strength: [Strong/Moderate/Weak]
- Opposing evidence strength: [Strong/Moderate/Weak]
- Conclusion: [One sentence]

**Actively search for opposing evidence!**\n`;
      } else if (listOutput) {
        modeInstructions = queryLanguage === 'ar'
          ? `\n\n�🚨🚨 **تحذير: وضع القائمة الصارم - ممنوع التحليل** 🚨🚨🚨

**أنت الآن في وضع جمع الأدلة فقط. مهمتك الوحيدة هي سرد النتائج.**

⛔ **ممنوع منعاً باتاً:**
- ❌ لا تكتب أي تحليل أدبي أو رمزي
- ❌ لا تكتب أي تعليقات أو تفسيرات
- ❌ لا تكتب أي استنتاجات أو ملخصات
- ❌ لا تكتب أي مقدمة أو خاتمة تحليلية

✅ **المطلوب فقط:**
اسرد كل حالة بهذا الشكل الدقيق:

📄 **ص. X**
> "الاقتباس الحرفي من النص"

📄 **ص. Y**
> "الاقتباس التالي"

---
**المجموع:** X حالات

⚠️ **لا تحلل - فقط اسرد!**\n`
          : `\n\n🚨🚨🚨 **WARNING: STRICT LIST MODE - NO ANALYSIS** 🚨🚨🚨

**You are in evidence collection mode. Your ONLY task is to list findings.**

⛔ **ABSOLUTELY FORBIDDEN:**
- ❌ NO literary or symbolic analysis
- ❌ NO commentary or interpretations
- ❌ NO conclusions or summaries
- ❌ NO introductions or analytical endings

✅ **REQUIRED OUTPUT ONLY:**
List each occurrence in this exact format:

📄 **p. X**
> "Exact quote from text"

📄 **p. Y**
> "Next quote"

---
**Total:** X occurrences

⚠️ **Do NOT analyze - just LIST!**\n`;
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

${multiDocInstruction}${modeInstructions}**Document Excerpts:**

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