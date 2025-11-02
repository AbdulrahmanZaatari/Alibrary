import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getBookById } from '@/lib/db';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: NextRequest) {
  try {
    const { bookId, bookTitle, selectedText, pageNumber, citationStyle } = await req.json();

    if (!bookId || !bookTitle || !selectedText || !citationStyle) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get book metadata from database
    const book = getBookById(bookId) as any;

    // Use AI to generate citation with book title analysis
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

    const prompt = `Generate a proper ${citationStyle} citation for this book excerpt.

BOOK INFORMATION:
- Title: ${bookTitle}
- Page Number: ${pageNumber}
- Excerpt: "${selectedText.substring(0, 200)}..."

INSTRUCTIONS:
1. Analyze the title for author information (e.g., "Ibn Kathir - Tafsir" → Author: Ibn Kathir)
2. If no publication date is available, use "n.d." (no date)
3. If no publisher is available, omit it or use "Publisher unknown"
4. Search online knowledge for this book's publication details if it's a well-known Islamic text
5. Follow standard ${citationStyle} format exactly
6. Include page number: p. ${pageNumber}

EXAMPLE FORMAT (${citationStyle}):
${citationStyle === 'APA' ? 'Author, A. A. (Year). Title of book. Publisher. (p. XX)' : ''}
${citationStyle === 'MLA' ? 'Author Name. Title of Book. Publisher, Year, p. XX.' : ''}
${citationStyle === 'Chicago' ? 'Author Name. Title of Book. Publisher, Year, XX.' : ''}
${citationStyle === 'Harvard' ? 'Author, A.A., Year. Title of book. Publisher, p. XX.' : ''}

Return ONLY the properly formatted citation, nothing else.`;

    const result = await model.generateContent(prompt);
    const citation = result.response.text().trim();

    return NextResponse.json({ citation });
  } catch (error) {
    console.error('Error generating citation:', error);
    return NextResponse.json({ 
      error: 'Failed to generate citation',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}