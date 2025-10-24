// app/api/documents/rename/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { updateDocumentName } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { id, displayName } = await request.json();
    updateDocumentName(id, displayName);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to rename document' }, { status: 500 });
  }
}