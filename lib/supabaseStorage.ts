import { supabaseAdmin } from './supabase';

const BOOKS_BUCKET = 'reader-books';

// Initialize bucket
async function initBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BOOKS_BUCKET);

  if (!exists) {
    await supabaseAdmin.storage.createBucket(BOOKS_BUCKET, {
      public: false,
      fileSizeLimit: 52428800,
    });
    console.log(`✅ Created bucket: ${BOOKS_BUCKET}`);
  }
}

initBucket().catch(console.error);

// ✅ FIX: Upload book to Supabase with correct path
export async function uploadBookToSupabase(
  bookId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  // ✅ CORRECT PATH: "books/bookId.pdf" instead of "bookId/bookId.pdf"
  const path = `books/${bookId}.pdf`;
  
  const { error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .upload(path, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  
  console.log('✅ Uploaded to path:', path);
  return path;
}

// Get signed URL for book download
export async function getBookDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .createSignedUrl(path, 3600); // 1 hour expiry

  if (error || !data?.signedUrl) {
    throw new Error('Failed to get download URL');
  }
  return data.signedUrl;
}

// Delete book from Supabase
export async function deleteBookFromSupabase(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .remove([path]);

  if (error) throw new Error(`Supabase delete failed: ${error.message}`);
}