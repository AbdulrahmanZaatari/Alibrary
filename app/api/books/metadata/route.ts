import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'data.db'); // ✅ Changed to data.db

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