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

// --- User-Requested Fallback Models ---
const FALLBACK_MODELS = [
  'gemini-2.0-flash', 
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-exp',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',   
];

// Removed metadataSchema as structured output is no longer being used.

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

    // Sanitize filename for Supabase storage key
    const originalFileName = file.name;
    const fileExtension = '.pdf';
    
    // Storage key: Use only bookId + .pdf (safe for Supabase)
    const storageFileName = `${bookId}${fileExtension}`;
    const supabasePath = `books/${storageFileName}`;

    // Extract title from original filename (preserves Arabic)
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

    // 🤖 AI METADATA EXTRACTION (with fallback and retry)
    let author: string | null = null;
    let publisher: string | null = null;
    let year: string | null = null;
    let language = 'Arabic'; // Default language
    let metadataResponseText: string | null = null;
    let usedModel: string | null = null;

    // Only try AI if it's a meaningful title (not test files)
    const shouldExtractMetadata = title.length > 5 && !title.toLowerCase().includes('test');

    if (shouldExtractMetadata) {
      // NOTE: Restored prompt to request raw JSON output (for regex parsing)
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
1. Common patterns: Extract author from patterns like "Author - Title" or "Title by Author".
2. Well-known Islamic authors: e.g., Ibn Kathir, Al-Ghazali, Al-Bukhari. Extract full name if present.
3. Publishers: e.g., Dar al-Kutub. Only if clearly inferable from the title.
4. Year: Prefer Gregorian year (YYYY).
5. Language detection: If the title contains Arabic characters, the language is "Arabic". Otherwise, detect based on script (English, French, etc.).
6. Return ONLY valid JSON, no explanations
7. Use null (not "null" string) for unknown fields`;

      let delay = 1000; // Initial delay of 1 second

      for (const modelName of FALLBACK_MODELS) {
        try {
          console.log(`🤖 Attempting metadata extraction with model: ${modelName}`);
          
          const model = genAI.getGenerativeModel({ model: modelName });
          
          // NOTE: Removed generationConfig for structured output
          const result = await model.generateContent(metadataPrompt);
          metadataResponseText = result.response.text().trim();
          usedModel = modelName;
          
          console.log('AI Response:', metadataResponseText);
          console.log(`✅ Success with model ${modelName}.`);
          break; // Exit the loop on success

        } catch (aiError: any) {
          // Check for rate limit status (though SDK error structure can vary)
          const isRateLimit = aiError.message.includes('429') || aiError.message.includes('Rate limit exceeded');
          
          if (isRateLimit) {
            console.warn(`⏳ Model ${modelName} hit rate limit. Waiting ${delay / 1000}s and trying next model...`);
          } else {
            console.warn(`⚠️ Model ${modelName} failed. Error: ${aiError.message}. Trying next model after ${delay / 1000}s...`);
          }
          
          // Implement exponential backoff before trying the next model
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for the next attempt
          // Cap the max delay to prevent excessive waiting
          if (delay > 8000) delay = 8000;
        }
      }
      
      // --- Final Parsing and Assignment (Restored Regex Parsing) ---
      if (metadataResponseText) {
        // Use regex to extract the JSON object
        const jsonMatch = metadataResponseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const metadata = JSON.parse(jsonMatch[0]);
                
                // Validate and assign
                author = (metadata.author && metadata.author !== 'null') ? String(metadata.author) : null;
                publisher = (metadata.publisher && metadata.publisher !== 'null') ? String(metadata.publisher) : null;
                year = (metadata.year && metadata.year !== 'null') ? String(metadata.year) : null;
                language = String(metadata.language || 'Arabic');
                
                console.log(`✅ Extracted metadata (Used: ${usedModel}):`, { author, publisher, year, language });
            } catch (parseError) {
                console.error('Failed to parse AI JSON:', parseError);
            }
        } else {
            console.warn('No valid JSON found in AI response');
        }
      } else {
        console.warn('❌ AI metadata extraction failed after all retries. Saving with default metadata.');
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

      stmt.run(
        bookId,
        originalFileName,  // Original name with Arabic preserved
        title,             // Title with Arabic preserved
        author,
        publisher,
        year,
        language,
        buffer.length,
        numPages,
        supabasePath       // Sanitized storage path
      );

      console.log('✅ Book saved to database with metadata');

      return NextResponse.json({
        success: true,
        bookId,
        title,
        filename: originalFileName,  // Return original name
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