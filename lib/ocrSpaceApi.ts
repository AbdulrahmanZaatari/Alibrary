/**
 * OCR.space API integration for Arabic OCR
 * Free tier: 25,000 requests/month
 * https://ocr.space/ocrapi
 * Max file size: 1MB - images are compressed if larger
 */

import sharp from 'sharp';

const MAX_FILE_SIZE = 900 * 1024; // 900KB to be safe (limit is 1MB)

interface OcrSpaceResponse {
  ParsedResults?: Array<{
    ParsedText: string;
    ErrorMessage?: string;
    FileParseExitCode: number;
  }>;
  OCRExitCode: number;
  IsErroredOnProcessing: boolean;
  ErrorMessage?: string[];
}

/**
 * Compress image to fit within OCR.space size limit
 */
async function compressImageForOcr(imageBuffer: Buffer): Promise<Buffer> {
  const originalSize = imageBuffer.length;
  
  if (originalSize <= MAX_FILE_SIZE) {
    console.log('   📦 Image size OK: ' + (originalSize / 1024).toFixed(1) + 'KB');
    return imageBuffer;
  }
  
  console.log('   📦 Image too large (' + (originalSize / 1024).toFixed(1) + 'KB), compressing...');
  
  // Calculate quality based on how much we need to shrink
  const ratio = MAX_FILE_SIZE / originalSize;
  let quality = Math.max(40, Math.min(85, Math.floor(ratio * 100)));
  
  // Try progressively lower quality until we fit
  let compressed = imageBuffer;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      compressed = await sharp(imageBuffer)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      
      if (compressed.length <= MAX_FILE_SIZE) {
        console.log('   ✅ Compressed to ' + (compressed.length / 1024).toFixed(1) + 'KB (quality: ' + quality + ')');
        return compressed;
      }
      
      quality -= 15;
    } catch {
      console.warn('   ⚠️ Compression attempt failed, trying lower quality...');
      quality -= 20;
    }
  }
  
  // Last resort: resize the image
  console.log('   🔄 Quality compression insufficient, resizing image...');
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const newWidth = Math.floor((metadata.width || 1500) * 0.7);
    
    compressed = await sharp(imageBuffer)
      .resize(newWidth)
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
    
    console.log('   ✅ Resized and compressed to ' + (compressed.length / 1024).toFixed(1) + 'KB');
    return compressed;
  } catch {
    console.error('   ❌ Image compression failed, using original');
    return imageBuffer;
  }
}

/**
 * Extract text from image using OCR.space API
 * Optimized for Arabic text extraction
 */
export async function extractTextWithOcrSpace(
  imageBuffer: Buffer | Uint8Array,
  language: 'ara' | 'eng' = 'ara'
): Promise<{
  text: string;
  success: boolean;
  error?: string;
}> {
  const apiKey = process.env.OCR_API_KEY;
  
  if (!apiKey) {
    console.log('⚠️ OCR_API_KEY not configured - OCR.space unavailable');
    return { text: '', success: false, error: 'API key not configured' };
  }
  
  console.log('🔄 [OCR.space] Starting Arabic OCR (language: ' + language + ')...');
  
  try {
    const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    
    // Compress image if too large for OCR.space (1MB limit)
    const compressedBuffer = await compressImageForOcr(buffer);
    const isJpeg = compressedBuffer !== buffer;
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const base64Image = 'data:' + mimeType + ';base64,' + compressedBuffer.toString('base64');
    
    // Create form data for POST request
    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('base64Image', base64Image);
    formData.append('language', language);
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');  // Internal upscaling for better results
    formData.append('OCREngine', '1');  // Engine 1 for Arabic
    formData.append('isTable', 'false');
    
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [OCR.space] HTTP error: ' + response.status + ' - ' + errorText);
      return { text: '', success: false, error: 'HTTP ' + response.status };
    }
    
    const data: OcrSpaceResponse = await response.json();
    
    // Check for errors
    if (data.IsErroredOnProcessing || data.OCRExitCode !== 1) {
      const errorMsg = data.ErrorMessage?.join(', ') || 
                       data.ParsedResults?.[0]?.ErrorMessage || 
                       'Unknown error';
      console.error('❌ [OCR.space] Processing error: ' + errorMsg);
      return { text: '', success: false, error: errorMsg };
    }
    
    // Extract text from parsed results
    const parsedText = data.ParsedResults?.[0]?.ParsedText?.trim() || '';
    
    if (parsedText && parsedText.length > 10) {
      console.log('✅ [OCR.space] Success: ' + parsedText.length + ' characters extracted');
      console.log('   📝 Preview: "' + parsedText.substring(0, 80) + '..."');
      return { text: parsedText, success: true };
    } else {
      console.warn('⚠️ [OCR.space] Insufficient text extracted (' + parsedText.length + ' chars)');
      return { text: parsedText, success: false, error: 'Insufficient text' };
    }
    
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('❌ [OCR.space] Exception: ' + errorMsg);
    return { text: '', success: false, error: errorMsg };
  }
}

/**
 * Check if OCR.space API is available
 */
export function isOcrSpaceAvailable(): boolean {
  const hasKey = !!process.env.OCR_API_KEY;
  console.log('🔑 [OCR.space] API key: ' + (hasKey ? 'CONFIGURED' : 'NOT CONFIGURED'));
  return hasKey;
}
