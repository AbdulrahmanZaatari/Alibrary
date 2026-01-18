import { NextRequest, NextResponse } from 'next/server';
import { getUserSettings, updateUserSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = getUserSettings();
    return NextResponse.json({
      queryExpansionEnabled: settings?.query_expansion_enabled === 1,
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    updateUserSettings({
      query_expansion_enabled: body.queryExpansionEnabled,
    });
    
    const settings = getUserSettings();
    return NextResponse.json({
      queryExpansionEnabled: settings?.query_expansion_enabled === 1,
      message: 'Settings updated'
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
