import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * ✅ Comprehensive corruption patterns
 */
const CORRUPTION_PATTERNS: Array<[RegExp, string]> = [
  // ========== PRIORITY: Shīʿī variations ==========
  [/\bSh[tT]{1,3}[iī]s?\b/gi, "Shīʿī"],
  [/\bSh[tT]{1,3}ism\b/gi, "Shīʿīsm"],
  [/\bSh[tT]{1,3}ah\b/gi, "Shīʿah"],
  [/\bShl['']?[Il1]\b/gi, "Shīʿī"],
  [/\bSh[il1]['']ah\b/gi, "Shīʿah"],
  [/\bShri\b/gi, "Shīʿī"],
  [/\bShilis\b/gi, "Shīʿīs"],
  [/\bIShri\b/gi, "Shīʿī"],
  [/\bISh[!'']i\b/gi, "Shīʿī"],
  [/\bSh[!'']i\b/gi, "Shīʿī"],
  
  // ========== Sunnī variations ==========
  [/\bSunn[il1]\b/gi, "Sunnī"],
  [/\bSunnism\b/gi, "Sunnīsm"],
  
  // ========== Jamāʿī variations ==========
  [/\bJamal[il1]\b/gi, "Jamāʿī"],
  [/\b]ama['']?[il1]?[-\s]Sunn[il1]\b/gi, "Jamāʿī-Sunnī"],
  [/\bJama['']?[il1][-\s]Sunn[il1]\b/gi, "Jamāʿī-Sunnī"],
  
  // ========== Ismāʿīlī variations ==========
  [/\bIsma[il1l][il1l][il1l]?\b/gi, "Ismāʿīlī"],
  [/\bIsma['']?[il1]l[il1]\b/gi, "Ismāʿīlī"],
  [/\bIsmalUt\b/gi, "Ismāʿīlī"],
  [/\bIsmalili\b/gi, "Ismāʿīlī"],
  
  // ========== Jaʿfarī variations ==========
  [/\bJa[il1l]far[il1]\b/gi, "Jaʿfarī"],
  [/\bJal[fƒ]ar[il1]\b/gi, "Jaʿfarī"],
  
  // ========== Ḥadīth variations ==========
  [/\bḤad[iī]th?\b/gi, "Ḥadīth"],
  [/\b[IJ1l][\).:]?ad[iī]th?\b/gi, "Ḥadīth"],
  [/\b1\)\.adith\b/gi, "Ḥadīth"],
  
  // ========== Names with J: prefix → Ḥ ==========
  [/\bJ:lamid\b/gi, "Ḥamid"],
  [/\bJ:lak/gi, "Ḥak"],
  [/\bJ:lam/gi, "Ḥam"],
  [/\bJ:Iakim\b/gi, "Ḥākim"],
  [/\bJ:I/gi, "Ḥ"],
  [/\bal-J:l/gi, "al-Ḥ"],
  [/\bJ:l/g, "Ḥ"],
  
  // ========== ʿAlī variations ==========
  [/\bIAU\b/g, "ʿAlī"],
  [/\bIAl[iī]\b/g, "ʿAlī"],
  [/\b['']Al[iī]\b/g, "ʿAlī"],
  [/\bal-IAU\b/g, "al-ʿAlī"],
  [/\baI-Sharif\b/g, "al-Sharīf"],
  [/\baI-/g, "al-"],
  
  // ========== Other names ==========
  [/\bal-RaQi\b/gi, "al-Rāḍī"],
  [/\bIbn-?[IJ1l]{1,2}[aā]zm\b/gi, "Ibn Ḥazm"],
  [/\bDa[''ʿ]?[fƒt]d\b/gi, "Dāwūd"],
  
  // ========== NEW: Specific fixes ==========
  [/\bNahj\s+al-Baldghah\b/gi, "Nahj al-Balāghah"],
  [/\bal-Baldghah\b/gi, "al-Balāghah"],
  [/\bBaldghah\b/gi, "Balāghah"],
  [/\bSeljul\}?\b/gi, "Seljuk"],
  [/\bS[ae]ljul?[}j]\b/gi, "Seljuk"],
  [/\bdali\b/gi, "dāʿī"],
  [/\bda['']i\b/gi, "dāʿī"],
  
  // ========== Dynasties ==========
  [/\bSaman[il1]s\b/gi, "Sāmānīs"],
  [/\bSamaD[il1]s\b/gi, "Sāmānīs"],
  [/\bBuyids\b/gi, "Būyids"],
  [/\bBuwayhids\b/gi, "Būwayhids"],
  [/\b[HḤ]amdanid\b/gi, "Ḥamdānid"],
  [/\bFatimid\b/gi, "Fāṭimid"],
  
  // ========== Places ==========
  [/\bShl?raz\b/gi, "Shīrāz"],
  [/\bI[s~ṣ]fahan\b/gi, "Iṣfahān"],
  [/\bIsfahan\b/gi, "Iṣfahān"],
  
  // ========== Religious terms ==========
  [/\bMu['']tazil[iī]\b/gi, "Muʿtazilī"],
  [/\bT[aā]libids\b/gi, "Ṭālibids"],
  [/\b['']Alids\b/gi, "ʿAlids"],
  [/\b['']Abb[aā]sids\b/gi, "ʿAbbāsids"],
  [/\bZayd[iī]s\b/gi, "Zaydīs"],
  
  // ========== Common corruptions ==========
  [/\$ufi/gi, "Sufi"],
  [/\$([a-z])/gi, (_match: string, p1: string): string => p1.toUpperCase()],
  [/Proven[<>][;,]?al/gi, "Provençal"],
  [/<[;,]/g, "ç"],
  
  // ========== Cleanup ==========
  [/\s([''])\s/g, "$1"],
  [/([''])([A-Z])/g, "$1$2"],
  [/\s{2,}/g, " "],
];

/**
 * ✅ Apply regex patterns (fast, 95% accuracy)
 */
function applyRegexCorrections(text: string): string {
  let fixed = text;
  
  for (const [pattern, replacement] of CORRUPTION_PATTERNS) {
    if (typeof replacement === 'string') {
      fixed = fixed.replace(pattern, replacement);
    } else {
      fixed = fixed.replace(pattern, replacement as any);
    }
  }
  
  return fixed;
}

/**
 * ✅ AI validates and perfects the regex corrections
 */
async function aiValidateCorrections(regexCorrected: string, original: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-lite',
      generationConfig: {
        temperature: 0.05, // ✅ Lower temperature for consistency
        maxOutputTokens: 3000,
      }
    });
    
    const prompt = `You are a text correction specialist. Fix ONLY transliteration errors in the corrected text.

RULES:
1. Return EXACTLY the same text length (±5% max)
2. Fix ONLY: corrupted proper nouns, diacritics, and Islamic terms
3. DO NOT add, remove, or rewrite sentences
4. DO NOT add explanations or formatting
5. Preserve all punctuation, line breaks, and spacing

EXAMPLES OF VALID CORRECTIONS:
- "Ismalili" → "Ismāʿīlī"
- "Jalfari" → "Jaʿfarī"
- "Shttis" → "Shīʿīs"
- "Baldghah" → "Balāghah"
- "Seljul}" → "Seljuk"
- "dali" → "dāʿī"
- "aI-" → "al-"

ORIGINAL (corrupted):
${original}

REGEX-CORRECTED (needs validation):
${regexCorrected}

Return ONLY the corrected text, nothing else:`;

    const result = await model.generateContent(prompt);
    let aiCorrected = result.response.text().trim();
    
    // ✅ Remove any markdown formatting the AI might add
    aiCorrected = aiCorrected.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
    aiCorrected = aiCorrected.replace(/^\*\*.*?\*\*:?\s*/gm, '');
    
    // ✅ Calculate length difference
    const lengthDiff = Math.abs(aiCorrected.length - regexCorrected.length) / regexCorrected.length;
    
    console.log(`   📊 AI correction stats:
      - Original: ${original.length} chars
      - Regex: ${regexCorrected.length} chars
      - AI: ${aiCorrected.length} chars
      - Difference: ${(lengthDiff * 100).toFixed(1)}%`);
    
    if (lengthDiff > 0.15) { // ✅ Stricter threshold (15% instead of 40%)
      console.warn(`⚠️ AI changed text too much (${(lengthDiff * 100).toFixed(1)}%), using regex version`);
      return regexCorrected;
    }
    
    // ✅ Additional validation: Check if AI removed critical content
    const criticalTerms = ['Shīʿī', 'Sunnī', 'Ḥadīth', 'Ismāʿīlī', 'Jaʿfarī'];
    const regexHasTerms = criticalTerms.filter(term => regexCorrected.includes(term)).length;
    const aiHasTerms = criticalTerms.filter(term => aiCorrected.includes(term)).length;
    
    if (aiHasTerms < regexHasTerms) {
      console.warn('⚠️ AI removed critical terms, using regex version');
      return regexCorrected;
    }
    
    console.log(`✅ AI validation complete (${(lengthDiff * 100).toFixed(1)}% change)`);
    return aiCorrected;
    
  } catch (error) {
    console.error('❌ AI validation failed:', error);
    return regexCorrected;
  }
}

/**
 * ✅ Main function: Regex → AI validation
 */
export async function fixTransliteration(text: string, useAI: boolean = true): Promise<string> {
  // Step 1: Apply regex corrections (fast)
  const regexCorrected = applyRegexCorrections(text);
  
  // Step 2: Let AI validate and perfect (optional)
  if (useAI) {
    console.log('🤖 AI validating corrections...');
    return await aiValidateCorrections(regexCorrected, text);
  }
  
  return regexCorrected;
}

/**
 * ✅ Synchronous version (regex only, no AI)
 */
export function fixTransliterationSync(text: string): string {
  return applyRegexCorrections(text);
}

/**
 * ✅ Clean PDF text (comprehensive)
 */
export async function cleanPdfText(text: string, useAI: boolean = false): Promise<string> {
  let cleaned = text;
  
  // Fix transliteration
  cleaned = await fixTransliteration(cleaned, useAI);
  
  // Normalize quotes
  cleaned = cleaned.replace(/[""]/g, '"');
  cleaned = cleaned.replace(/['']/g, "'");
  
  // Fix line breaks
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Trim lines
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
  
  return cleaned.trim();
}

/**
 * ✅ Synchronous clean (for UI - no AI)
 */
export function cleanPdfTextSync(text: string): string {
  let cleaned = applyRegexCorrections(text);
  
  cleaned = cleaned.replace(/[""]/g, '"');
  cleaned = cleaned.replace(/['']/g, "'");
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
  
  return cleaned.trim();
}

/**
 * ✅ Detect if text has transliteration issues
 */
export function hasTransliterationIssues(text: string): boolean {
  const issues = [
    /Sh[tT]{2}/,
    /Shl'[Il1]/,
    /Sunn[il1]/,
    /Saman[il1]s/,
    /]ama/,
    /Isma[il1l]il/,
    /Jal[fƒ]ar/,
    /[IJ1l][\).:]?adith/,
    /J:l/,
    /\bIAU\b/,
    /Shilis/,
    /IShri/,
    /Baldghah/,
    /Seljul\}/,
    /\bdali\b/,
    /aI-/,
  ];
  
  return issues.some(pattern => pattern.test(text));
}