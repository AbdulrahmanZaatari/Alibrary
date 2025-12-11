/**
 * Test script for Arabic OCR correction
 * Run with: npx ts-node scripts/testArabicCorrection.ts
 */

import { quickArabicOcrFix, correctArabicOcrWithAI, hasArabicOcrIssues } from '../lib/arabicOcrCorrection';

const testText = `عبد الرحمن بن عوف: الصحابي الذي صلي خلفه رسول الله ولادته واسلامه: انفجر نور رساله الاسلام من مكه المكرمه، فبدا غريبا، وكان اصحابه غرباء بين عباده الاوثان، محاطين ببرايق الشهوات ومخالب الجاهليه التي حاولت اخفاء الحق واسكات الذي صلي الله عليه وسلم ومنعه من نشر الهدي ولا مانع الا الله.  ومن بين اوليك الفرسان الاوايل، الذين بنوا الا ان يكونوا اول المسلمين، واول الاعمده لهذا الدين القيم، الذين يسجلون علي عاتقهم من الدعوه في الدنيا لينالوا جنه الله في الاخره، الصحابي الجليل عبد الرحمن بن عوف رضي الله عنه، الملقب بالغني الشاكر، والذي ترك بصمه عميقه في تاريخ الاسلام من خلال دوره الفعال في نشر الدعوه ودعم المجتمع المسلم.`;

const expectedCorrections = [
  { wrong: 'صلي', right: 'صلى' },
  { wrong: 'رساله', right: 'رسالة' },
  { wrong: 'الاسلام', right: 'الإسلام' },
  { wrong: 'مكه', right: 'مكة' },
  { wrong: 'المكرمه', right: 'المكرمة' },
  { wrong: 'اصحابه', right: 'أصحابه' },
  { wrong: 'عباده', right: 'عبادة' },
  { wrong: 'الاوثان', right: 'الأوثان' },
  { wrong: 'الجاهليه', right: 'الجاهلية' },
  { wrong: 'الهدي', right: 'الهدى' },
  { wrong: 'اوليك', right: 'أولئك' },
  { wrong: 'الاوايل', right: 'الأوائل' },
  { wrong: 'الاعمده', right: 'الأعمدة' },
  { wrong: 'علي', right: 'على' },
  { wrong: 'الدعوه', right: 'الدعوة' },
  { wrong: 'جنه', right: 'جنة' },
  { wrong: 'الاخره', right: 'الآخرة' },
  { wrong: 'بصمه', right: 'بصمة' },
  { wrong: 'عميقه', right: 'عميقة' },
];

async function runTest() {
  console.log('='.repeat(60));
  console.log('🧪 ARABIC OCR CORRECTION TEST');
  console.log('='.repeat(60));
  
  console.log('\n📝 Original text (OCR output):');
  console.log(testText.substring(0, 200) + '...\n');
  
  // Step 1: Test quick rule-based fix
  console.log('─'.repeat(60));
  console.log('1️⃣ QUICK RULE-BASED FIX:');
  console.log('─'.repeat(60));
  
  const quickFixed = quickArabicOcrFix(testText);
  
  let quickFixCount = 0;
  for (const { wrong, right } of expectedCorrections) {
    const wrongInOriginal = testText.includes(wrong);
    const wrongInFixed = quickFixed.includes(wrong);
    const rightInFixed = quickFixed.includes(right);
    
    if (wrongInOriginal && !wrongInFixed && rightInFixed) {
      quickFixCount++;
      console.log(`  ✅ ${wrong} → ${right}`);
    } else if (wrongInOriginal && wrongInFixed) {
      console.log(`  ❌ ${wrong} NOT fixed`);
    }
  }
  
  console.log(`\n📊 Quick fix corrected: ${quickFixCount}/${expectedCorrections.length} words`);
  
  // Step 2: Test AI correction
  console.log('\n' + '─'.repeat(60));
  console.log('2️⃣ AI-POWERED CORRECTION (using Gemma 27B):');
  console.log('─'.repeat(60));
  
  try {
    const aiResult = await correctArabicOcrWithAI(testText);
    
    console.log(`\n📝 AI-corrected text preview:`);
    console.log(aiResult.correctedText.substring(0, 300) + '...\n');
    
    console.log(`📊 AI Correction Results:`);
    console.log(`   - Model used: ${aiResult.modelUsed}`);
    console.log(`   - Corrections made: ${aiResult.corrections.length}`);
    console.log(`   - Confidence: ${(aiResult.confidence * 100).toFixed(1)}%`);
    
    // Check expected corrections
    let aiFixCount = 0;
    console.log('\n📋 Checking expected corrections:');
    for (const { wrong, right } of expectedCorrections) {
      const wrongInOriginal = testText.includes(wrong);
      const wrongInCorrected = aiResult.correctedText.includes(wrong);
      const rightInCorrected = aiResult.correctedText.includes(right);
      
      if (wrongInOriginal && !wrongInCorrected && rightInCorrected) {
        aiFixCount++;
        console.log(`  ✅ ${wrong} → ${right}`);
      } else if (wrongInOriginal && wrongInCorrected) {
        console.log(`  ❌ ${wrong} NOT fixed`);
      }
    }
    
    console.log(`\n📊 AI fix corrected: ${aiFixCount}/${expectedCorrections.length} words`);
    
  } catch (error) {
    console.error('❌ AI correction failed:', error);
  }
  
  // Step 3: Detection test
  console.log('\n' + '─'.repeat(60));
  console.log('3️⃣ OCR ISSUE DETECTION:');
  console.log('─'.repeat(60));
  
  const hasIssues = hasArabicOcrIssues(testText);
  console.log(`\n   Original has OCR issues: ${hasIssues ? '✅ YES (correctly detected)' : '❌ NO (should be YES)'}`);
  
  const quickFixedHasIssues = hasArabicOcrIssues(quickFixed);
  console.log(`   Quick-fixed has issues: ${quickFixedHasIssues ? '⚠️ YES (some remain)' : '✅ NO (all fixed)'}`);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(60));
}

runTest().catch(console.error);
