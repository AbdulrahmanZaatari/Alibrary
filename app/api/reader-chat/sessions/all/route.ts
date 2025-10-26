import { NextResponse } from 'next/server';
import { getChatSessions } from '@/lib/db';

export async function GET() {
  try {
    const allSessions = getChatSessions();
    
    // ✅ Filter to only reader sessions (those with book_id)
    const readerSessions = allSessions.filter((session: any) => session.book_id);
    
    return NextResponse.json(readerSessions);
  } catch (error) {
    console.error('Error fetching all reader sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reader sessions' },
      { status: 500 }
    );
  }
}