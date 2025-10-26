import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const prompts = db.prepare(`
      SELECT * FROM prompts 
      ORDER BY is_custom DESC, name ASC
    `).all();

    return NextResponse.json(prompts);
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prompts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, template, category } = await request.json();
    
    if (!name || !template) {
      return NextResponse.json(
        { error: 'Name and template are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const id = crypto.randomUUID();
    
    db.prepare(`
      INSERT INTO prompts (id, name, template, category, is_custom, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(id, name, template, category || 'general');

    return NextResponse.json({ id, success: true });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return NextResponse.json(
      { error: 'Failed to create prompt' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    
    const db = getDb();
    db.prepare('DELETE FROM prompts WHERE id = ? AND is_custom = 1').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    return NextResponse.json(
      { error: 'Failed to delete prompt' },
      { status: 500 }
    );
  }
}