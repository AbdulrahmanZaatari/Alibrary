import { supabaseAdmin } from './supabase';
import fs from 'fs';
import path from 'path';

const BOOKS_BUCKET = 'reader-books';
const LOCAL_CACHE_DIR = path.join(process.cwd(), '.cache', 'books');

// Initialize bucket and local cache
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
  
  // Create local cache directory
  if (!fs.existsSync(LOCAL_CACHE_DIR)) {
    fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    console.log(`✅ Created local cache directory: ${LOCAL_CACHE_DIR}`);
  }
}

initBucket().catch(console.error);

/**
 * Get local cache path for a book
 */
function getLocalCachePath(bookId: string): string {
  return path.join(LOCAL_CACHE_DIR, `${bookId}.pdf`);
}

/**
 * Check if book exists in local cache
 */
function isInLocalCache(bookId: string): boolean {
  const cachePath = getLocalCachePath(bookId);
  return fs.existsSync(cachePath);
}

/**
 * Save book to local cache
 */
function saveToLocalCache(bookId: string, buffer: Buffer): void {
  try {
    const cachePath = getLocalCachePath(bookId);
    fs.writeFileSync(cachePath, buffer);
    console.log(`✅ Cached locally: ${bookId}`);
  } catch (error) {
    console.error(`⚠️ Failed to cache locally: ${error}`);
  }
}

/**
 * Load book from local cache
 */
function loadFromLocalCache(bookId: string): Buffer | null {
  try {
    const cachePath = getLocalCachePath(bookId);
    if (fs.existsSync(cachePath)) {
      console.log(`⚡ Loading from local cache: ${bookId}`);
      return fs.readFileSync(cachePath);
    }
  } catch (error) {
    console.error(`⚠️ Failed to load from cache: ${error}`);
  }
  return null;
}

/**
 * Delete book from local cache
 */
function deleteFromLocalCache(bookId: string): void {
  try {
    const cachePath = getLocalCachePath(bookId);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      console.log(`✅ Deleted from cache: ${bookId}`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to delete from cache: ${error}`);
  }
}

/**
 * Upload book to Supabase with correct path
 */
export async function uploadBookToSupabase(
  bookId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  // Save to local cache first
  saveToLocalCache(bookId, fileBuffer);
  
  // Then upload to Supabase
  const path = `books/${bookId}.pdf`;
  
  const { error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .upload(path, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false
    });
  
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  
  console.log('✅ Uploaded to Supabase:', path);
  return path;
}

/**
 * Get book buffer - from local cache or Supabase
 */
export async function getBookBuffer(bookId: string, supabasePath: string): Promise<Buffer> {
  // Try local cache first
  const cached = loadFromLocalCache(bookId);
  if (cached) {
    return cached;
  }
  
  // Download from Supabase
  console.log(`📥 Downloading from Supabase: ${bookId}`);
  const { data, error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .download(supabasePath);
  
  if (error || !data) {
    throw new Error(`Failed to download from Supabase: ${error?.message || 'No data'}`);
  }
  
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Save to local cache for next time
  saveToLocalCache(bookId, buffer);
  
  return buffer;
}

/**
 * Get signed URL for book download (legacy, prefer getBookBuffer)
 */
export async function getBookDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .createSignedUrl(path, 3600); // 1 hour expiry
  
  if (error || !data?.signedUrl) {
    throw new Error('Failed to get download URL');
  }
  return data.signedUrl;
}

/**
 * Delete book from Supabase and local cache
 */
export async function deleteBookFromSupabase(bookId: string, path: string): Promise<void> {
  // Delete from local cache
  deleteFromLocalCache(bookId);
  
  // Delete from Supabase
  const { error } = await supabaseAdmin.storage
    .from(BOOKS_BUCKET)
    .remove([path]);
  
  if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  
  console.log('✅ Deleted from Supabase:', path);
}

/**
 * Clear local cache (useful for maintenance)
 */
export function clearLocalCache(): void {
  try {
    if (fs.existsSync(LOCAL_CACHE_DIR)) {
      const files = fs.readdirSync(LOCAL_CACHE_DIR);
      files.forEach(file => {
        fs.unlinkSync(path.join(LOCAL_CACHE_DIR, file));
      });
      console.log(`✅ Cleared ${files.length} cached files`);
    }
  } catch (error) {
    console.error('⚠️ Failed to clear cache:', error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { count: number; sizeBytes: number } {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      return { count: 0, sizeBytes: 0 };
    }
    
    const files = fs.readdirSync(LOCAL_CACHE_DIR);
    let totalSize = 0;
    
    files.forEach(file => {
      const filePath = path.join(LOCAL_CACHE_DIR, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    });
    
    return { count: files.length, sizeBytes: totalSize };
  } catch (error) {
    console.error('⚠️ Failed to get cache stats:', error);
    return { count: 0, sizeBytes: 0 };
  }
}