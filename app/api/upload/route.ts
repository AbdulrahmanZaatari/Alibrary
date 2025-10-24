import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addDocument, updateDocumentEmbeddingStatus } from '@/lib/db';
import { embedDocumentInBatches } from '@/lib/embeddingProcessor';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'Invalid PDF file' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const documentId = uuidv4();
    const filename = `${documentId}.pdf`;
    const uploadDir = path.join(process.cwd(), 'public', 'books');
    const filepath = path.join(uploadDir, filename);

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Save file
    fs.writeFileSync(filepath, buffer);

    // Save to database
    addDocument({
      id: documentId,
      filename,
      displayName: file.name.replace('.pdf', ''),
      totalPages: 0,
    });

    console.log(`✅ Document uploaded: ${documentId}`);

    // ✅ Pass full filesystem path, not URL
    processEmbeddingsInBackground(documentId, filepath);

    return NextResponse.json({
      success: true,
      documentId,
      message: 'Document uploaded! Embeddings are being processed in the background.',
    });
  } catch (error: unknown) {
    console.error('❌ Upload error:', error);
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'An unexpected error occurred';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processEmbeddingsInBackground(documentId: string, filepath: string) {
  try {
    console.log(`🔄 Starting background embedding for ${documentId}`);
    
    updateDocumentEmbeddingStatus(documentId, 'processing', 0);

    // filepath is already the full path
    await embedDocumentInBatches(
      documentId,
      filepath, // ✅ Pass full path directly
      (current, total) => {
        console.log(`📊 Progress: ${current}/${total} pages (${Math.round(current/total*100)}%)`);
      }
    );

    updateDocumentEmbeddingStatus(documentId, 'completed', 0);
    console.log(`✅ Embedding complete for ${documentId}`);
  } catch (error: unknown) {
    console.error(`❌ Embedding failed for ${documentId}:`, error);
    updateDocumentEmbeddingStatus(documentId, 'failed', 0);
  }
}