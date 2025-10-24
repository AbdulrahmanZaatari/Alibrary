import { NextRequest, NextResponse } from 'next/server';
import { deleteDocument, getDocumentById, updateDocument } from '@/lib/db';
import { deleteDocumentEmbeddings } from '@/lib/vectorStore';

// GET single document by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // ✅ Changed to Promise
) {
  try {
    const { id } = await params; // ✅ Await params
    const document = getDocumentById(id);
    
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error('Error fetching document:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 }
    );
  }
}

// PATCH - Update document (rename)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // ✅ Changed to Promise
) {
  try {
    const { id } = await params; // ✅ Await params
    const { displayName } = await request.json();

    if (!displayName || displayName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Display name is required' },
        { status: 400 }
      );
    }

    updateDocument(id, { display_name: displayName.trim() });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating document:', error);
    return NextResponse.json(
      { error: 'Failed to update document' },
      { status: 500 }
    );
  }
}

// DELETE document by ID
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // ✅ Changed to Promise
) {
  try {
    const { id } = await params; // ✅ Await params
    const documentId = id;

    // Check if document exists
    const document = getDocumentById(documentId);
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Delete embeddings from Supabase
    try {
      await deleteDocumentEmbeddings(documentId);
      console.log(`✅ Deleted embeddings for document: ${documentId}`);
    } catch (error) {
      console.error('Error deleting embeddings:', error);
      // Continue even if embedding deletion fails
    }

    // Delete from SQLite database
    deleteDocument(documentId);

    console.log(`✅ Deleted document: ${documentId}`);

    return NextResponse.json({ 
      success: true,
      message: 'Document deleted successfully'
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return NextResponse.json(
      { error: 'Failed to delete document', details: error.message },
      { status: 500 }
    );
  }
}