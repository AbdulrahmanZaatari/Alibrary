import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getBookBuffer } from '@/lib/supabaseStorage';
import mupdf from 'mupdf';

const dbPath = path.join(process.cwd(), 'data', 'data.db'); // ✅ Changed to data.db

// Initialize Gemini for metadata extraction
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface BookMetadata {
  id: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  edition?: string;
  language?: string;
  filename: string;
  page_count: number;
  current_page: number;
  size: number;
  uploaded_at: string;
  last_read: string;
}

function ensureMetadataColumns(db: Database.Database) {
  const columns = db.pragma('table_info(books)') as Array<{ name: string }>;
  
  if (!columns.some(col => col.name === 'author')) {
    db.exec('ALTER TABLE books ADD COLUMN author TEXT');
  }
  if (!columns.some(col => col.name === 'publisher')) {
    db.exec('ALTER TABLE books ADD COLUMN publisher TEXT');
  }
  if (!columns.some(col => col.name === 'year')) {
    db.exec('ALTER TABLE books ADD COLUMN year TEXT');
  }
  if (!columns.some(col => col.name === 'isbn')) {
    db.exec('ALTER TABLE books ADD COLUMN isbn TEXT');
  }
  if (!columns.some(col => col.name === 'edition')) {
    db.exec('ALTER TABLE books ADD COLUMN edition TEXT');
  }
  if (!columns.some(col => col.name === 'language')) {
    db.exec('ALTER TABLE books ADD COLUMN language TEXT DEFAULT "Arabic"');
  }
}

// GET: Fetch single book metadata
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookId = searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    const db = new Database(dbPath);

    try {
      ensureMetadataColumns(db);

      const stmt = db.prepare(`
        SELECT id, title, author, publisher, year, isbn, edition, language,
               filename, page_count, current_page, size, uploaded_at, last_read
        FROM books 
        WHERE id = ?
      `);

      const book = stmt.get(bookId) as BookMetadata | undefined;
      db.close();

      if (!book) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }

      return NextResponse.json(book);

    } catch (dbError) {
      db.close();
      throw dbError;
    }

  } catch (error) {
    console.error('Get metadata error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metadata' },
      { status: 500 }
    );
  }
}

// PATCH: Update book metadata
export async function PATCH(req: NextRequest) {
  try {
    const { bookId, title, author, publisher, year, isbn, edition, language } = await req.json();

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    if (!title || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const db = new Database(dbPath);

    try {
      ensureMetadataColumns(db);

      const stmt = db.prepare(`
        UPDATE books 
        SET title = ?, author = ?, publisher = ?, year = ?, isbn = ?, edition = ?, language = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        title.trim(),
        author?.trim() || null,
        publisher?.trim() || null,
        year?.trim() || null,
        isbn?.trim() || null,
        edition?.trim() || null,
        language?.trim() || 'Arabic',
        bookId
      );

      db.close();

      if (result.changes === 0) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }

      return NextResponse.json({ 
        success: true, 
        message: 'Metadata updated successfully' 
      });

    } catch (dbError) {
      db.close();
      throw dbError;
    }

  } catch (error) {
    console.error('Update metadata error:', error);
    return NextResponse.json(
      { error: 'Failed to update metadata' },
      { status: 500 }
    );
  }
}

// POST: Fetch all books with metadata (for metadata panel)
export async function POST(req: NextRequest) {
  try {
    const db = new Database(dbPath);

    try {
      ensureMetadataColumns(db);

      const stmt = db.prepare(`
        SELECT id, title, author, publisher, year, isbn, edition, language,
               filename, page_count, size, uploaded_at, last_read
        FROM books 
        ORDER BY last_read DESC
      `);

      const books = stmt.all() as BookMetadata[];
      db.close();

      return NextResponse.json({ books });

    } catch (dbError) {
      db.close();
      throw dbError;
    }

  } catch (error) {
    console.error('Get all metadata error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books metadata' },
      { status: 500 }
    );
  }
}

// PUT: AI-powered metadata extraction from book pages
export async function PUT(req: NextRequest) {
  try {
    const { bookId } = await req.json();

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    // Get book from database
    const db = new Database(dbPath);
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as any;
    
    if (!book) {
      db.close();
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    console.log(`🤖 AI Metadata Extraction for: ${book.title}`);

    // Download PDF from Supabase
    const pdfBytes = await getBookBuffer(bookId, book.supabase_path);
    
    if (!pdfBytes || pdfBytes.length === 0) {
      db.close();
      return NextResponse.json({ error: 'PDF not found in storage' }, { status: 404 });
    }

    // Extract text from first 5 pages and last 3 pages
    let extractedText = '';
    
    try {
      const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
      const pageCount = doc.countPages();
      
      // Extract first 5 pages (title page, copyright, ToC)
      const firstPages = Math.min(5, pageCount);
      for (let i = 0; i < firstPages; i++) {
        const page = doc.loadPage(i);
        const text = page.toStructuredText().asText().trim();
        extractedText += `\n--- PAGE ${i + 1} ---\n${text}\n`;
      }
      
      // Extract last 3 pages (colophon, publisher info)
      if (pageCount > 8) {
        for (let i = Math.max(pageCount - 3, firstPages); i < pageCount; i++) {
          const page = doc.loadPage(i);
          const text = page.toStructuredText().asText().trim();
          extractedText += `\n--- PAGE ${i + 1} (LAST PAGES) ---\n${text}\n`;
        }
      }
      
      doc.destroy();
      console.log(`   ✓ Extracted ${extractedText.length} chars from ${firstPages} + last pages`);
      
    } catch (mupdfError) {
      console.error('   ❌ Text extraction failed:', mupdfError);
      db.close();
      return NextResponse.json({ error: 'Failed to extract text from PDF' }, { status: 500 });
    }

    // Use AI to extract metadata
    const prompt = `You are an expert at extracting book metadata from Arabic and English Islamic texts.

Analyze the following text extracted from a PDF book and extract the metadata.
The text includes the first few pages (title page, copyright, table of contents) and last few pages (colophon, publisher info).

EXTRACTED TEXT:
${extractedText.substring(0, 15000)}

INSTRUCTIONS:
1. Look for the book title - usually on the first page or title page, often in larger text or centered
2. Look for author name - often after "تأليف" or "المؤلف" in Arabic, or "By" or "Author" in English
3. Look for publisher - often after "الناشر" or "دار" in Arabic, or "Published by" in English
4. Look for publication year - in the copyright page or last pages, look for Hijri and Gregorian dates
5. Look for ISBN - usually on the copyright page, starting with 978 or 979
6. Look for edition - like "الطبعة الأولى" or "First Edition"
7. Determine the language - Arabic, English, or other

Return ONLY a valid JSON object with these fields (use null for unknown):
{
  "title": "the full book title",
  "author": "author name(s)",
  "publisher": "publisher name",
  "year": "publication year (Gregorian)",
  "isbn": "ISBN number if found",
  "edition": "edition info",
  "language": "Arabic" or "English" or other
}

Important: 
- For Arabic names, keep them in Arabic script
- If title is in Arabic, keep it in Arabic
- For year, convert Hijri to Gregorian if only Hijri is given
- Return ONLY the JSON, no explanation`;

    // Model hierarchy for fallback (Gemma first, then others)
    const METADATA_MODELS = [
      'gemma-3-27b-it',
      'gemma-3-12b-it',
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ];

    let lastError: Error | null = null;

    for (const modelName of METADATA_MODELS) {
      try {
        console.log(`   🤖 Trying model: ${modelName}`);
        
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          }
        });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
      
        console.log(`   ✅ ${modelName} succeeded`);
        console.log('   🤖 AI Response:', responseText);
      
        // Parse JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in AI response');
        }
      
        const metadata = JSON.parse(jsonMatch[0]);
      
        console.log('   ✅ Extracted metadata:', metadata);
      
        db.close();
      
        return NextResponse.json({
          success: true,
          title: metadata.title || book.title,
          author: metadata.author || null,
          publisher: metadata.publisher || null,
          year: metadata.year || null,
          isbn: metadata.isbn || null,
          edition: metadata.edition || null,
          language: metadata.language || 'Arabic',
        });
        
      } catch (modelError: any) {
        const isQuotaError = modelError?.status === 429 || 
                            modelError?.status === 503 ||
                            modelError?.message?.includes('quota') || 
                            modelError?.message?.includes('overloaded') ||
                            modelError?.message?.includes('RESOURCE_EXHAUSTED');
        
        lastError = modelError;
        
        if (isQuotaError) {
          console.warn(`   ⚠️ ${modelName} failed (quota/overload), trying next model...`);
          continue;
        }
        
        // For other errors, still try next model
        console.error(`   ❌ ${modelName} failed:`, modelError.message);
      }
    }

    // All models failed
    db.close();
    console.error('   ❌ All models failed for metadata extraction');
    return NextResponse.json({ 
      error: `AI extraction failed: ${lastError instanceof Error ? lastError.message : 'All models failed'}` 
    }, { status: 500 });

  } catch (error) {
    console.error('AI metadata extraction error:', error);
    return NextResponse.json(
      { error: 'Failed to extract metadata' },
      { status: 500 }
    );
  }
}