import { NextRequest, NextResponse } from 'next/server';
import { getDocuments, getDb } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';

interface Document {
  id: string;
  display_name: string;
  filename: string;
  total_pages: number;
  embedding_status: string;
  chunks_count: number;
  is_selected: number;
  uploaded_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    // Get documents from SQLite
    const documents = getDocuments() as Document[];

    // ✅ Enrich with real-time Supabase chunk counts
    const enrichedDocs = await Promise.all(
      documents.map(async (doc) => {
        try {
          // Get actual chunk count from Supabase
          const { count, error } = await supabaseAdmin
            .from('embeddings')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', doc.id);

          if (error) {
            console.error(`⚠️ Error fetching chunks for ${doc.display_name}:`, error.message);
            return {
              ...doc,
              chunks_count: 0,
            };
          }

          return {
            ...doc,
            chunks_count: count || 0, // ✅ Real count from Supabase
          };
        } catch (err) {
          console.error(`❌ Failed to fetch chunk count for ${doc.id}:`, err);
          return {
            ...doc,
            chunks_count: 0,
          };
        }
      })
    );

    // ✅ FIX: Return object with documents property (consistent with ChatPanel expectation)
    return NextResponse.json({ documents: enrichedDocs });
  } catch (error) {
    console.error('❌ Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' }, 
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { documentId, isSelected } = await request.json();
    
    const db = getDb();
    db.prepare(`
      UPDATE documents 
      SET is_selected = ?
      WHERE id = ?
    `).run(isSelected ? 1 : 0, documentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating document selection:', error);
    return NextResponse.json(
      { error: 'Failed to update selection' },
      { status: 500 }
    );
  }
}