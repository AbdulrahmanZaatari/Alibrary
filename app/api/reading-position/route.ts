import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
    }

    const db = getDb();
    const position = db.prepare(
      'SELECT page_number FROM reading_positions WHERE document_id = ?'
    ).get(documentId) as { page_number: number } | undefined;

    return NextResponse.json(position || { page_number: 1 });
  } catch (error) {
    console.error('Error fetching reading position:', error);
    return NextResponse.json({ error: 'Failed to fetch reading position' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { documentId, pageNumber } = await request.json();
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO reading_positions (document_id, page_number, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        page_number = excluded.page_number,
        updated_at = excluded.updated_at
    `).run(documentId, pageNumber, now);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving reading position:', error);
    return NextResponse.json({ error: 'Failed to save reading position' }, { status: 500 });
  }
}