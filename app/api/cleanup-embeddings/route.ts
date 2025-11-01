import { NextRequest, NextResponse } from 'next/server';
import { cleanupPoorQualityEmbeddings, cleanupAllDocuments } from '@/lib/cleanupEmbeddings';

/**
 * API endpoint to clean up poor-quality embeddings
 * 
 * Usage:
 * POST /api/cleanup-embeddings
 * Body: { "documentId": "your-doc-id" }  // For single document
 * Body: { "all": true }                   // For all documents
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentId, all } = body;

    if (all) {
      console.log('🧹 Starting cleanup of ALL documents...');
      const results = await cleanupAllDocuments();
      
      return NextResponse.json({
        success: true,
        message: 'Cleanup completed for all documents',
        results
      });
    } else if (documentId) {
      console.log(`🧹 Starting cleanup for document: ${documentId}`);
      const result = await cleanupPoorQualityEmbeddings(documentId);
      const { success, ...rest } = result;
      return NextResponse.json({
        success: true,
        message: `Cleanup completed for document ${documentId}`,
        ...rest
      });
    } else {
      return NextResponse.json(
        { success: false, error: 'Missing documentId or all parameter' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('❌ Cleanup API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}