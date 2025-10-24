import { supabaseAdmin } from './supabase';

const BOOKS_BUCKET = 'reader-books';

// Initialize bucket
async function initBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  
  if (!buckets?.find(b => b.name === BOOKS_BUCKET)) {
    await supabaseAdmin.storage.createBucket(BOOKS_BUCKET, {
      public: false,
      fileSizeLimit: 104857600, // 100MB
    });
    console.log('✅ Created Supabase bucket:', BOOKS_BUCKET);
  }
}

initBucket().catch(console.error);

// Upload book to Supabase
export async function uploadBookToSupabase(
  bookId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const path = `${bookId}/${filename}`;
  
  const { error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .upload(path, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
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