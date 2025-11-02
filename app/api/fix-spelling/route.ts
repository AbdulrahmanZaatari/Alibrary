import { NextRequest, NextResponse } from 'next/server';
import { fixTransliteration } from '@/lib/transliterationMapper';

export async function POST(request: NextRequest) {
  try {
    const { text, useAI } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    console.log('🔧 Fixing spelling:', text.substring(0, 100), '...');
    console.log(`   📝 Input length: ${text.length} chars`);
    
    const fixed = await fixTransliteration(text, useAI !== false);
    
    console.log(`   ✅ Output length: ${fixed.length} chars`);
    console.log(`   📊 Changed: ${text !== fixed ? 'Yes' : 'No'}`);

    // ✅ Log what changed for debugging
    if (text !== fixed) {
      const changes = [];
      const words = text.split(/\s+/);
      const fixedWords = fixed.split(/\s+/);
      
      for (let i = 0; i < Math.min(words.length, fixedWords.length); i++) {
        if (words[i] !== fixedWords[i]) {
          changes.push(`"${words[i]}" → "${fixedWords[i]}"`);
        }
      }
      
      if (changes.length > 0 && changes.length < 20) {
        console.log(`   🔄 Key changes:`, changes.slice(0, 10).join(', '));
      }
    }

    return NextResponse.json({ 
      success: true, 
      fixed,
      changed: fixed !== text,
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