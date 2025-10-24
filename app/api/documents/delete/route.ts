// app/api/documents/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { deleteDocument } from '@/lib/db';
import { deleteDocumentEmbeddings } from '@/lib/vectorStore';
import { unlink } from 'fs/promises';
import { join } from 'path';

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    
    // Get document info
    const { getDocumentById } = await import('@/lib/db');
    const doc = getDocumentById(id) as { filename: string } | null;
    
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Delete from vector store
    try {
      await deleteDocumentEmbeddings(id);
    } catch (error) {
      console.error('Error deleting embeddings:', error);
    }

    // Delete file
    try {
      const filepath = join(process.cwd(), 'public', 'books', doc.filename);
      await unlink(filepath);
    } catch (error) {
      console.error('Error deleting file:', error);
    }

    // Delete from database
    deleteDocument(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}