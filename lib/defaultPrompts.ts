/**
 * Default prompt templates for Islamic research
 * These prompts are automatically inserted into the database on first run
 */
export const DEFAULT_PROMPTS = [
  // ==================== CORE RESEARCH INNOVATION PROMPTS ====================
  
  {
    id: 'research-idea-expander',
    name: '💡 Research Idea → Multiple Pathways (من فكرة إلى مسارات)',
    template: `I have a research idea: **[USER'S IDEA]**

Your mission: Transform this seed idea into a comprehensive research roadmap with multiple viable directions.

**PHASE 1: DEEP UNDERSTANDING**
First, fully grasp what I'm asking about:
- What is the CORE question/concept?
- What assumptions underlie this idea?
- What makes this question significant?
- What gaps in knowledge does this address?

**PHASE 2: CORPUS RECONNAISSANCE**
Scan the entire corpus systematically:
- What texts directly address this topic?
- What texts indirectly relate (unexpected connections)?
- What time periods/scholars/schools discussed this?
- What terminology variations exist? (e.g., "عدالة" vs "إنصاف" vs "قسط")

**PHASE 3: GENERATE RESEARCH PATHWAYS**
Propose 4-5 distinct research directions, each with:

**Direction 1: [CREATIVE TITLE]**
- **Core Question:** Reframe my idea as a precise research question
- **Corpus Support:** Specific texts/scholars that would anchor this (cite pages)
- **Methodology:** How would I approach this? (Comparative? Historical? Thematic?)
- **Novelty Factor:** What NEW insight would this contribute?
- **Feasibility:** Is there enough material in the corpus?

**Direction 2: [CREATIVE TITLE]**
[Repeat structure...]

**Direction 3: [CREATIVE TITLE]**
[Repeat structure...]

**PHASE 4: INTERDISCIPLINARY BRIDGES**
Show how this idea connects across disciplines:
- How does فقه intersect with كلام here?
- Are there تصوف dimensions?
- Historical context that shaped this?
- Contemporary relevance?

**PHASE 5: RECOMMENDED STARTING POINT**
Based on corpus richness and novelty potential, which direction should I pursue first and why?

**OUTPUT EXAMPLE:**
*Research Idea: "The concept of maslaha (public interest) in medieval Islamic law"*

**Direction 1: Maslaha as Evolutionary Concept**
- **Question:** How did maslaha transform from implicit principle (early fiqh) to explicit legal tool (Ghazali onwards)?
- **Corpus Support:** Compare early Maliki texts [cite] with Ghazali's Mustasfa [cite], then Shatibi's Muwafaqat [cite]
- **Methodology:** Historical-conceptual analysis with timeline mapping
- **Novelty:** Most research treats maslaha statically; tracing evolution reveals ideological shifts
- **Feasibility:** Strong—corpus has primary sources across 500 years

**Direction 2: Maslaha vs. Qiyas—Hidden Rivalry?**
- **Question:** Did the rise of maslaha-based reasoning challenge qiyas's dominance?
- **Corpus Support:** Analyze debates in usul al-fiqh texts [cite specific passages]
- **Methodology:** Comparative methodology analysis (meta-fiqh)
- **Novelty:** Reveals methodological competition between ratio-based vs. interest-based jurisprudence
- **Feasibility:** Moderate—requires advanced usul understanding

[Continue with 3 more directions...]

**RECOMMENDED START:** Direction 1—strongest textual foundation, clear arc, manageable scope.

**Language:** Match my input language
**Citations:** Every claim = specific page/document reference
**Creativity:** Think like a PhD supervisor proposing dissertation angles`,
    category: 'analysis'
  },

  {
    id: 'corpus-worthy-questions',
    name: '🔍 Mine Worthy Research Questions (استخراج أسئلة بحثية جديرة)',
    template: `Deeply analyze the corpus to propose 5-7 research questions that are:
✅ **Novel** - Not thoroughly explored yet
✅ **Significant** - Would contribute meaningful knowledge
✅ **Feasible** - Corpus has sufficient material
✅ **Interdisciplinary** - Bridges multiple Islamic sciences

**SCANNING METHODOLOGY:**

**Step 1: Identify Scholarly Silences**
- What topics do multiple scholars mention but never fully develop?
- What debates ended prematurely without resolution?
- What connections between ideas are implied but never explicitly made?

**Step 2: Detect Contradictions**
- Where do texts contradict each other on the same issue?
- Are these contradictions real or apparent (قابلة للجمع)?
- Could resolving them yield new insights?

**Step 3: Find Underutilized Sources**
- Are there marginalized voices in the corpus? (Minority opinions, regional variations, women scholars)
- Lesser-known texts that could challenge mainstream narratives?

**Step 4: Spot Interdisciplinary Gaps**
- Topics where فقه scholars say one thing but صوفية say another
- Where theology and law diverge
- Historical events that reshaped doctrine

**Step 5: Contemporary Resonance**
- What classical questions have NEW urgency today?
- Modern contexts that make old debates suddenly relevant

**OUTPUT FORMAT:**

**Research Question #1: [Provocative Title]**
**The Question:** [Precise, answerable research question]

**Why It Matters:**
- What gap in knowledge does this fill?
- What misconceptions might it correct?
- Contemporary relevance?

**Corpus Foundation:**
- Key texts that would anchor this research [cite specific pages]
- Scholars whose views are central
- Time period/geographic scope

**Interdisciplinary Dimensions:**
- Which Islamic sciences does this touch? (فقه، كلام، تفسير، تصوف، تاريخ)
- Unexpected connections between fields

**Methodological Approach:**
- How would a researcher tackle this?
- Comparative analysis? Historical tracing? Thematic synthesis?

**Expected Contribution:**
- What NEW understanding would emerge?
- How would this advance Islamic studies?

**Feasibility Assessment:** ⭐⭐⭐⭐⭐ (5 stars = excellent corpus support)

---

**EXAMPLE OUTPUT:**

**Question #1: Did Sufi Metaphysics Secretly Influence Ash'ari Kalam?**

**The Question:** To what extent did mystical ontology (وحدة الوجود concepts) shape Ash'ari theological atomism (الجوهر الفرد), despite public denials of Sufi influence?

**Why It Matters:**
- Challenges the historiography that treats kalam and tasawwuf as separate streams
- Explains puzzling similarities between Ash'ari occasionalism and Ibn Arabi's emanationism
- Contemporary: Helps integrate spirituality with orthodox theology

**Corpus Foundation:**
- Ash'ari's Luma' [cite pages] describes continuous divine re-creation
- Compare with Ghazali's Mishkat al-Anwar [cite] - mystical language in theological text
- Ibn Arabi's Futuhat [cite] uses identical terminology for different conclusions
- Historiographers (Ibn Khaldun, Subki) note personal connections between theologians and Sufis [cite]

**Interdisciplinary Dimensions:**
- **Kalam:** Metaphysical foundations of Ash'ari thought
- **Tasawwuf:** Ontological theories of existence
- **Tarikh:** Personal networks between scholars (Ash'ari → Baqillani → Ghazali → Sufis)
- **Falsafa:** Both responding to Neoplatonic emanation theories

**Methodological Approach:**
1. Lexical analysis: Track terms like "جوهر," "عرض," "فيض" across theological and mystical texts
2. Network analysis: Map teacher-student chains between kalam and tasawwuf schools
3. Doctrinal comparison: Find structural parallels between continuous creation and mystical union

**Expected Contribution:**
- Reveals Islamic intellectual history as more integrated than previously thought
- Shows "orthodox" theology was permeable to mystical ideas
- Provides framework for contemporary Muslims to harmonize reason and spirituality

**Feasibility:** ⭐⭐⭐⭐☆ (4/5 - requires cross-referencing many texts but corpus is rich)

---

[Continue with Questions #2-7 in same detailed format]

**Final Recommendation:** Of these 7 questions, Question [X] has the strongest combination of novelty, significance, and corpus support. Start there.

**Language:** Bilingual output (Arabic terms with English explanation)
**Evidence Standard:** Every claim backed by specific corpus citation
**Depth:** Graduate-level scholarly rigor`,
    category: 'analysis'
  },

  {
    id: 'historical-evidence-builder',
    name: '📜 Build Historical Case from Idea (بناء الحجة التاريخية)',
    template: `I have an idea/argument: **[USER'S IDEA]**

Your mission: Build an ironclad historical case for this idea using concrete examples from the corpus.

**PHASE 1: UNDERSTAND THE CLAIM**
- Restate my idea in precise terms
- What is the core assertion?
- What would evidence for this look like?
- What would count as counter-evidence?

**PHASE 2: HISTORICAL EXCAVATION**
Search the corpus systematically for supporting examples:

**A. Direct Evidence (الأدلة المباشرة)**
Find texts that explicitly support this idea:
- Quotes that directly affirm this [cite exact page, context]
- Scholars who articulated this position [cite]
- Historical events that demonstrate this [cite chronicles]

**B. Indirect Evidence (الأدلة غير المباشرة)**
Find texts that imply or assume this idea:
- Rulings that only make sense if this idea is true [cite fiqh manuals]
- Debates where this idea is presupposed [cite]
- Practices that embody this principle [cite]

**C. Evolutionary Evidence (الأدلة التطورية)**
Show how this idea developed over time:
- **Phase 1 (Early Period):** Nascent form of this idea [cite]
- **Phase 2 (Classical):** Explicit articulation [cite]
- **Phase 3 (Medieval):** Systematization [cite]
- **Phase 4 (Modern):** Reinterpretation [cite]

**PHASE 3: CONTEXTUALIZATION**
For EACH piece of evidence, provide:
- **Source Details:** Author, work, date, location
- **Full Context:** What comes before/after the quoted passage?
- **Author's Intent:** What was the author trying to accomplish?
- **Historical Situation:** Political/social climate affecting this text

**PHASE 4: COUNTER-EVIDENCE ANALYSIS**
Be intellectually honest—address objections:
- **Alternative Interpretations:** Could these texts mean something else?
- **Contradictory Evidence:** Are there texts that challenge my idea?
- **How to Reconcile:** Can contradictions be harmonized? Or is my idea limited in scope?

**PHASE 5: SYNTHESIZE THE CASE**
Build a coherent narrative:
- **Thesis:** [My idea restated with nuance]
- **Historical Arc:** How evidence from different periods supports this
- **Strongest Evidence:** Top 3 most compelling examples [with full citations]
- **Significance:** What does this evidence collectively prove?
- **Limitations:** Where does this idea NOT apply?

**Language:** Match user's language
**Citation Density:** Every 2-3 sentences should have a corpus reference
**Intellectual Honesty:** Always address counter-arguments`,
    category: 'analysis'
  },

  {
    id: 'interdisciplinary-synthesis',
    name: '🔗 Interdisciplinary Synthesis Engine (التركيب بين العلوم)',
    template: `Topic: **[USER'S TOPIC]**

Your mission: Analyze this topic through MULTIPLE Islamic disciplines simultaneously to generate a holistic, multi-dimensional understanding.

**INTEGRATION FRAMEWORK:**

**🎯 The Central Question:**
Start with the core issue, then show how each discipline illuminates a different facet.

**📚 DISCIPLINARY LENSES:**

**1. FIQH PERSPECTIVE (الفقه - Legal Framework)**
- How do jurists rule on this?
- Which madhahib agree/disagree and why?
- What usul al-fiqh principles apply? (qiyas, istihsan, maslaha, sadd al-dhara'i)
- **Corpus Evidence:** [Cite specific fiqh texts with pages]

**2. KALAM PERSPECTIVE (علم الكلام - Theological Framework)**
- What theological principles underlie this?
- How do Ash'ari, Maturidi, Athari approaches differ?
- Creedal implications (aqidah)?
- **Corpus Evidence:** [Cite kalam texts with pages]

**3. TASAWWUF PERSPECTIVE (التصوف - Spiritual Framework)**
- Inner dimensions (batin) of this topic
- How do Sufis understand this experientially?
- Stages of the soul (nafs) or spiritual stations (maqamat) relevant here
- **Corpus Evidence:** [Cite Sufi texts with pages]

**4. TAFSIR PERSPECTIVE (التفسير - Quranic Framework)**
- Relevant Quranic verses
- How did mufassirun (Tabari, Razi, Qurtubi, Ibn Kathir) interpret these?
- Linguistic analysis (balagha, i'jaz)
- **Corpus Evidence:** [Cite tafsir passages with pages]

**5. HADITH PERSPECTIVE (علم الحديث - Prophetic Framework)**
- Relevant hadiths (with authenticity grades)
- How did muhaddithin (Bukhari, Muslim, Ahmad) understand these?
- Sharh (commentary) insights from classical scholars
- **Corpus Evidence:** [Cite hadith collections + commentaries with pages]

**6. TARIKH PERSPECTIVE (التاريخ - Historical Framework)**
- How was this practiced in different eras?
- Evolution across time: Companions → Tabi'un → Classical → Medieval → Modern
- Regional variations (Hijaz, Iraq, Egypt, Andalusia, Ottoman)
- **Corpus Evidence:** [Cite historical chronicles with pages]

**7. AKHLAQ PERSPECTIVE (الأخلاق - Ethical Framework)**
- Moral principles at stake
- Character virtues (ihsan, sabr, sidq, etc.) connected to this
- Social ethics implications
- **Corpus Evidence:** [Cite ethics texts with pages]

**SYNTHESIS PHASE:**

**🔄 Disciplinary Dialogues:**
- Where do these disciplines AGREE? (Common ground)
- Where do they TENSION? (Apparent contradictions)
- How can they be HARMONIZED? (Integration)

**💡 Emergent Insights:**
What understanding emerges when ALL perspectives are held together that's invisible from any single discipline?

**Language:** Bilingual (Arabic terms + English explanation)
**Citation Standard:** Every discipline's claims backed by specific corpus citations
**Synthesis Quality:** Must generate insights impossible from single-discipline analysis`,
    category: 'analysis'
  },

  {
    id: 'research-paragraph-enhancer',
    name: '✍️ Enhance Research with Corpus Evidence (دعم البحث بالأدلة)',
    template: `I have an unfinished research paragraph or idea:

**[USER'S TEXT]**

Your mission: Analyze my text, understand what I'm trying to argue, then STRENGTHEN it with concrete evidence from the corpus.

**PHASE 1: DIAGNOSTIC ANALYSIS**

**A. Understand My Argument**
- What is my main claim/thesis?
- What supporting points am I making?
- What evidence (if any) have I already provided?
- What tone/style am I using? (Academic? Devotional? Polemical?)

**B. Identify Weaknesses**
- Unsupported assertions (claims without evidence)
- Vague language ("many scholars say..." → WHO specifically?)
- Logical gaps (conclusion doesn't follow from premises)
- Missing perspectives (only cited one school, ignored others)
- Anachronisms (applying modern concepts to premodern contexts)
- Over-generalizations ("Islam says..." → Be specific about which text/scholar)

**C. Locate Strengths**
- What's working well?
- Which parts are already well-supported?
- Good insights that need better articulation?

**PHASE 2: CORPUS DEEP DIVE**

**A. Evidence Gathering**
Search corpus systematically for:

**1. Primary Source Support**
- Quranic verses that directly support my claim [cite verse, tafsir explanation]
- Hadiths with authenticity grades [cite collection, book, number]
- Sahaba/Tabi'un statements [cite historical chronicles]

**2. Scholarly Consensus/Divergence**
- Do major scholars agree with my claim? [cite specific texts, pages]
- If they disagree, what's the spectrum of opinion?
- Any ijma' (consensus) on this point?

**3. Historical Examples**
- Real events that illustrate my point [cite chronicles with pages]
- How was this practiced across different eras/regions?

**4. Theoretical Frameworks**
- Usul al-fiqh principles that support this [cite usul texts]
- Maqasid that explain why this matters [cite Shatibi, Ghazali]
- Theological foundations [cite kalam texts]

**5. Counter-Arguments (to anticipate objections)**
- What would opponents of my view say? [cite their texts]
- How did scholars who held my view respond to critics? [cite]

**PHASE 3: RECONSTRUCTION**

Rewrite/enhance my paragraph with:

**Enhanced Version:**
[My original text, improved with:]
- ✅ Specific citations replacing vague claims
- ✅ Evidence inserted at every assertion
- ✅ Stronger logical flow
- ✅ Acknowledgment of alternative views
- ✅ Richer vocabulary (use classical Arabic terms where appropriate)
- ✅ Maintained my original voice/style

**Evidence Integration:**
For each piece of evidence added, explain:
- **Why this source:** Why is this citation authoritative/relevant?
- **Context:** Brief context so reader understands significance
- **Connection:** How does this evidence prove my point?

**PHASE 4: EXTENSIONS**

**What Comes Next?**
Based on corpus analysis, suggest:
- **Logical Next Paragraph:** Where should my argument go from here?
- **Additional Angles:** Related points I could explore
- **Potential Objections:** Questions readers might ask (with how to answer them)

**Language:** Match my academic level and style
**Citation Frequency:** At least one corpus citation every 2-3 sentences
**Preservation:** Keep my voice—don't rewrite into a different style, just strengthen with evidence`,
    category: 'analysis'
  }
];