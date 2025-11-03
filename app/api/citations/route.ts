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

    // Build metadata information string
    const metadataLines: string[] = [];
    
    if (book?.author) {
      metadataLines.push(`- Author: ${book.author}`);
    }
    if (book?.publisher) {
      metadataLines.push(`- Publisher: ${book.publisher}`);
    }
    if (book?.year) {
      metadataLines.push(`- Year: ${book.year}`);
    }
    if (book?.edition) {
      metadataLines.push(`- Edition: ${book.edition}`);
    }
    if (book?.isbn) {
      metadataLines.push(`- ISBN: ${book.isbn}`);
    }
    if (book?.language) {
      metadataLines.push(`- Language: ${book.language}`);
    }

    const metadataInfo = metadataLines.length > 0 
      ? metadataLines.join('\n') 
      : '- No metadata available';

    // Use AI to generate citation with metadata
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Generate a proper ${citationStyle} citation for this book excerpt.

BOOK INFORMATION:
- Title: ${bookTitle}
${metadataInfo}
- Page Number: ${pageNumber}
- Excerpt: "${selectedText.substring(0, 200)}..."

INSTRUCTIONS:
1. Use the provided metadata (author, publisher, year, etc.) if available
2. If author is missing, try to extract from title (e.g., "Ibn Kathir - Tafsir" → Author: Ibn Kathir)
3. If no publication date is available, use "n.d." (no date)
4. If no publisher is available, you may omit it or use "Publisher unknown" depending on ${citationStyle} requirements
5. For well-known Islamic texts, use your knowledge to provide accurate information if metadata is incomplete
6. Follow standard ${citationStyle} format EXACTLY
7. Include page number: p. ${pageNumber}

CITATION FORMAT REQUIREMENTS:

${citationStyle === 'APA' ? `
APA 7th Edition Format:
Author, A. A. (Year). Title of book (Edition). Publisher.
Example: Al-Ghazali, A. H. (1993). The alchemy of happiness. Ariel Press. (p. ${pageNumber})
` : ''}

${citationStyle === 'MLA' ? `
MLA 9th Edition Format:
Author Name. Title of Book. Edition, Publisher, Year.
Example: Al-Ghazali, Abu Hamid. The Alchemy of Happiness. Translated by Claud Field, Ariel Press, 1993, p. ${pageNumber}.
` : ''}

${citationStyle === 'Chicago' ? `
Chicago 17th Edition (Notes and Bibliography):
Author Name. Title of Book. Edition. Place of Publication: Publisher, Year.
Example: Al-Ghazali, Abu Hamid. The Alchemy of Happiness. Translated by Claud Field. Ariel Press, 1993, ${pageNumber}.
` : ''}

${citationStyle === 'Harvard' ? `
Harvard Format:
Author, A.A., Year. Title of book. Edition. Publisher.
Example: Al-Ghazali, A.H., 1993. The alchemy of happiness. Ariel Press, p. ${pageNumber}.
` : ''}

IMPORTANT:
- Return ONLY the properly formatted citation
- Do NOT include any explanations, notes, or additional text
- Be as accurate as possible based on available metadata
- If information is missing, follow standard conventions for missing data in ${citationStyle} format`;

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