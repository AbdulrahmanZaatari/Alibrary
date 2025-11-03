import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mupdf from 'mupdf';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const BOOKS_BUCKET = 'reader-books';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Get PDF page count using MuPDF
    let numPages = 0;
    try {
      const document = mupdf.Document.openDocument(buffer, 'application/pdf');
      numPages = document.countPages();
    } catch (mupdfError) {
      console.error('Error reading PDF with MuPDF:', mupdfError);
      return NextResponse.json(
        { error: 'Failed to read PDF file' },
        { status: 500 }
      );
    }

    // Generate unique ID
    const timestamp = Date.now();
    const bookId = `${timestamp}`;

    // ✅ FIX: Sanitize filename for Supabase (remove Arabic/special chars from storage key)
    // Original filename (with Arabic) is preserved in database
    const originalFileName = file.name;
    const fileExtension = '.pdf';
    
    // Storage key: Use only timestamp + .pdf (safe for Supabase)
    const storageFileName = `${bookId}${fileExtension}`;
    const supabasePath = `books/${storageFileName}`;

    // ✅ Extract title from original filename (preserves Arabic)
    const title = originalFileName.replace(/\.pdf$/i, '');

    console.log('📤 Uploading file:');
    console.log('  - Original name:', originalFileName);
    console.log('  - Storage key:', supabasePath);
    console.log('  - Title:', title);

    // Upload to Supabase Storage with sanitized key
    const { error: uploadError } = await supabase.storage
      .from(BOOKS_BUCKET)
      .upload(supabasePath, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file to storage' },
        { status: 500 }
      );
    }

    console.log('✅ Uploaded to Supabase:', supabasePath);

    // 🤖 AI METADATA EXTRACTION (with rate limit handling)
    let author = null;
    let publisher = null;
    let year = null;
    let language = 'Arabic';

    // Only try AI if it's a meaningful title (not test files)
    const shouldExtractMetadata = title.length > 5 && !title.toLowerCase().includes('test');

    if (shouldExtractMetadata) {
      try {
        console.log('🤖 Extracting metadata with AI for:', title);
        
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        
        const metadataPrompt = `Analyze this book title and extract metadata. This is likely an Islamic/Arabic scholarly text.

Title: "${title}"

Extract and return ONLY a valid JSON object with these exact fields:
{
  "author": "author name or null",
  "publisher": "publisher name or null", 
  "year": "publication year (YYYY) or null",
  "language": "Arabic/English/French/Urdu/Persian/Turkish/Other"
}

EXTRACTION RULES:
1. Common patterns:
   - "Author - Title" → extract Author
   - "Title by Author" → extract Author  
   - "Title (Author)" → extract Author
   - "Ibn X", "Al-X", "Imam X" are authors
   
2. Well-known Islamic authors:
   - Ibn Kathir, Al-Ghazali, Ibn Taymiyyah, Al-Bukhari, Muslim, An-Nawawi, Ibn Qayyim, etc.
   - Extract full name if present
   
3. Publishers:
   - Dar al-Kutub, Maktabah, Dar al-Salam, Dar Ibn Hazm, etc.
   - Only if clearly mentioned in title
   
4. Year:
   - Extract if present (1400, 2020, etc.)
   - Prefer Gregorian year
   
5. Language detection:
   - Arabic script → "Arabic"
   - English/Latin script → "English"
   - If title contains Arabic characters, language is "Arabic"
   
6. Return ONLY valid JSON, no explanations
7. Use null (not "null" string) for unknown fields

Example valid response:
{"author":"Ibn Kathir","publisher":null,"year":"1999","language":"Arabic"}`;

        const result = await model.generateContent(metadataPrompt);
        const responseText = result.response.text().trim();
        
        console.log('AI Response:', responseText);
        
        // Parse AI response - try to extract JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const metadata = JSON.parse(jsonMatch[0]);
            
            // Validate and assign
            author = metadata.author && metadata.author !== 'null' ? metadata.author : null;
            publisher = metadata.publisher && metadata.publisher !== 'null' ? metadata.publisher : null;
            year = metadata.year && metadata.year !== 'null' ? metadata.year : null;
            language = metadata.language || 'Arabic';
            
            console.log('✅ Extracted metadata:', { author, publisher, year, language });
          } catch (parseError) {
            console.error('Failed to parse AI JSON:', parseError);
          }
        } else {
          console.warn('No valid JSON found in AI response');
        }
      } catch (aiError: any) {
        if (aiError.status === 429) {
          console.warn('⏳ AI rate limit hit. Saving without metadata. User can add later in Metadata Manager.');
        } else {
          console.error('⚠️ AI metadata extraction failed:', aiError);
        }
        // Continue with null values - not critical
      }
    } else {
      console.log('⏭️ Skipping AI extraction for test/short filename');
    }

    // Save to database with metadata
    const db = getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO books (
          id, filename, title, author, publisher, year, language,
          size, page_count, supabase_path, uploaded_at, last_read
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      // ✅ Store original filename in database (with Arabic chars)
      // ✅ Store sanitized path for Supabase
      stmt.run(
        bookId,
        originalFileName,  // Original name with Arabic preserved
        title,             // Title with Arabic preserved
        author,
        publisher,
        year,
        language,
        buffer.length,
        numPages,
        supabasePath       // Sanitized storage path
      );

      console.log('✅ Book saved to database with metadata');

      return NextResponse.json({
        success: true,
        bookId,
        title,
        filename: originalFileName,  // Return original name
        pageCount: numPages,
        metadata: {
          author,
          publisher,
          year,
          language,
        },
      });
    } catch (dbError) {
      // If database insert fails, clean up uploaded file
      await supabase.storage.from(BOOKS_BUCKET).remove([supabasePath]);
      
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: 'Failed to save book to database' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to upload file',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}