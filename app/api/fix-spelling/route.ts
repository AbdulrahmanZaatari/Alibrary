import { NextRequest, NextResponse } from 'next/server';
import { correctArabicWithAI } from '@/lib/arabicTextCleaner';
import { fixTransliteration } from '@/lib/transliterationMapper';

export async function POST(request: NextRequest) {
  try {
    const { text, useAI, language } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    console.log('🔧 Fixing spelling:', text.substring(0, 100), '...');
    console.log(`   📝 Input length: ${text.length} chars`);
    
    let fixed: string;
    
    // ✅ Detect language if not provided
    const isArabic = language === 'ar' || /[\u0600-\u06FF]/.test(text);
    
    if (isArabic) {
      console.log('🔤 Processing Arabic text with AI...');
      // ✅ ALWAYS use AI for Arabic (like Gemini website)
      fixed = await correctArabicWithAI(text);
    } else {
      console.log('🔤 Processing English/transliterated text...');
      // ✅ Use AI for English transliteration
      fixed = await fixTransliteration(text, useAI !== false);
    }
    
    console.log(`   ✅ Output length: ${fixed.length} chars`);
    console.log(`   📊 Changed: ${text !== fixed ? 'Yes' : 'No'}`);

    return NextResponse.json({ 
      success: true, 
      fixed,
      changed: fixed !== text,
      language: isArabic ? 'ar' : 'en',
      method: 'ai',
      stats: {
        originalLength: text.length,
        fixedLength: fixed.length,
        changePercentage: ((Math.abs(fixed.length - text.length) / text.length) * 100).toFixed(2)
      }
    });
  } catch (error) {
    console.error('❌ Spell fix error:', error);
    return NextResponse.json({ 
      error: 'Failed to fix spelling',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}