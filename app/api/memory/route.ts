import { NextRequest, NextResponse } from 'next/server';
import { 
  getSessionContexts, 
  getSessionSummary, 
  getGlobalMemory,
  searchGlobalMemory 
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const sessionId = searchParams.get('sessionId');
    const topic = searchParams.get('topic');

    switch (action) {
      case 'session-context':
        if (!sessionId) {
          return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
        }
        const contexts = getSessionContexts(sessionId);
        return NextResponse.json({ contexts });

      case 'session-summary':
        if (!sessionId) {
          return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
        }
        const summary = getSessionSummary(sessionId);
        return NextResponse.json({ summary });

      case 'global-memory':
        const memory = getGlobalMemory(20);
        return NextResponse.json({ memory });

      case 'search-memory':
        if (!topic) {
          return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
        }
        const results = searchGlobalMemory(topic);
        return NextResponse.json({ results });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('❌ Memory API error:', error);
    return NextResponse.json(
      { error: 'Failed to process memory request' },
      { status: 500 }
    );
  }
}