// app/api/documents/toggle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { toggleDocumentSelection } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { id, selected } = await request.json();
    toggleDocumentSelection(id, selected);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to toggle selection' }, { status: 500 });
  }
}