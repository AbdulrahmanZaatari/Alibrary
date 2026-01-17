import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WordOccurrence {
  before: string;
  match: string;
  after: string;
}

interface PageResult {
  pageNumber: number;
  documentName: string;
  documentId: string;
  occurrenceCount: number;
  excerpts: WordOccurrence[];
}

interface WordScanResponse {
  word: string;
  totalOccurrences: number;
  totalPages: number;
  totalDocuments: number;
  results: PageResult[];
}

/**
 * Find all occurrences of a word in a text and extract context
 */
function findWordOccurrences(
  text: string,
  word: string,
  contextLength: number = 40
): WordOccurrence[] {
  const occurrences: WordOccurrence[] = [];
  
  // Escape special regex characters in the word
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Build regex - for Arabic, we need to be careful with word boundaries
  // Use lookahead/lookbehind for Arabic word boundaries (spaces, punctuation, start/end)
  const arabicBoundary = '(?:^|[\\s\\u060C\\u061B\\u061F\\u0640\\u066A-\\u066D\\u06D4.,!?;:\'"()\\[\\]{}]|$)';
  
  // Try whole word match first
  let regex: RegExp;
  try {
    regex = new RegExp(`${arabicBoundary}(${escapedWord})${arabicBoundary}`, 'gi');
  } catch {
    // Fallback to simple search if regex fails
    regex = new RegExp(escapedWord, 'gi');
  }
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchedText = match[1] || match[0];
    
    // Extract context before and after
    const beforeStart = Math.max(0, matchIndex - contextLength);
    const afterEnd = Math.min(text.length, matchIndex + matchedText.length + contextLength);
    
    let before = text.slice(beforeStart, matchIndex);
    let after = text.slice(matchIndex + matchedText.length, afterEnd);
    
    // Trim to word boundaries for cleaner display
    if (beforeStart > 0) {
      const spaceIndex = before.indexOf(' ');
      if (spaceIndex > 0 && spaceIndex < 15) {
        before = '...' + before.slice(spaceIndex + 1);
      } else {
        before = '...' + before;
      }
    }
    
    if (afterEnd < text.length) {
      const spaceIndex = after.lastIndexOf(' ');
      if (spaceIndex > after.length - 15 && spaceIndex > 0) {
        after = after.slice(0, spaceIndex) + '...';
      } else {
        after = after + '...';
      }
    }
    
    occurrences.push({
      before: before.trim(),
      match: matchedText,
      after: after.trim()
    });
    
    // Prevent infinite loop on zero-width matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
  
  // If regex approach found nothing, try simple includes
  if (occurrences.length === 0 && text.includes(word)) {
    let searchIndex = 0;
    while (true) {
      const foundIndex = text.indexOf(word, searchIndex);
      if (foundIndex === -1) break;
      
      const beforeStart = Math.max(0, foundIndex - contextLength);
      const afterEnd = Math.min(text.length, foundIndex + word.length + contextLength);
      
      let before = text.slice(beforeStart, foundIndex);
      let after = text.slice(foundIndex + word.length, afterEnd);
      
      if (beforeStart > 0) before = '...' + before;
      if (afterEnd < text.length) after = after + '...';
      
      occurrences.push({
        before: before.trim(),
        match: word,
        after: after.trim()
      });
      
      searchIndex = foundIndex + word.length;
    }
  }
  
  return occurrences;
}

/**
 * POST: Scan documents for all occurrences of a word
 */
export async function POST(req: NextRequest) {
  try {
    const { word, documentIds } = await req.json();
    
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      return NextResponse.json(
        { error: 'Word parameter is required' },
        { status: 400 }
      );
    }
    
    const searchWord = word.trim();
    console.log(`🔍 Word Scan: "${searchWord}" in ${documentIds?.length || 'all'} documents`);
    
    // Build query to fetch ALL chunks containing the word
    // Note: Table is 'embeddings' with 'chunk_text' column
    let query = supabaseAdmin
      .from('embeddings')
      .select('id, chunk_text, page_number, document_id, metadata')
      .ilike('chunk_text', `%${searchWord}%`);
    
    // Filter by document IDs if provided
    if (documentIds && documentIds.length > 0) {
      query = query.in('document_id', documentIds);
    }
    
    // Execute query - get ALL matching chunks (no limit)
    const { data: chunks, error } = await query.order('page_number', { ascending: true });
    
    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json(
        { error: 'Database query failed' },
        { status: 500 }
      );
    }
    
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        word: searchWord,
        totalOccurrences: 0,
        totalPages: 0,
        totalDocuments: 0,
        results: []
      } as WordScanResponse);
    }
    
    console.log(`   Found ${chunks.length} chunks containing "${searchWord}"`);
    
    // Get document names for display
    const uniqueDocIds = [...new Set(chunks.map(c => c.document_id))];
    const { data: documents } = await supabaseAdmin
      .from('documents')
      .select('id, name')
      .in('id', uniqueDocIds);
    
    const docNameMap = new Map(documents?.map(d => [d.id, d.name]) || []);
    
    // Process chunks and count occurrences
    const pageResultsMap = new Map<string, PageResult>();
    let totalOccurrences = 0;
    
    for (const chunk of chunks) {
      // Note: column is 'chunk_text' not 'content'
      const occurrences = findWordOccurrences(chunk.chunk_text, searchWord);
      
      if (occurrences.length === 0) continue;
      
      totalOccurrences += occurrences.length;
      
      // Create unique key for page + document combination
      const pageKey = `${chunk.document_id}-${chunk.page_number}`;
      
      if (pageResultsMap.has(pageKey)) {
        // Add to existing page result
        const existing = pageResultsMap.get(pageKey)!;
        existing.occurrenceCount += occurrences.length;
        existing.excerpts.push(...occurrences);
      } else {
        // Create new page result
        pageResultsMap.set(pageKey, {
          pageNumber: chunk.page_number || 0,
          documentName: docNameMap.get(chunk.document_id) || 'Unknown Document',
          documentId: chunk.document_id,
          occurrenceCount: occurrences.length,
          excerpts: occurrences
        });
      }
    }
    
    // Convert to array and sort by page number
    const results = Array.from(pageResultsMap.values())
      .sort((a, b) => a.pageNumber - b.pageNumber);
    
    // Limit excerpts per page to prevent huge responses
    const MAX_EXCERPTS_PER_PAGE = 10;
    for (const result of results) {
      if (result.excerpts.length > MAX_EXCERPTS_PER_PAGE) {
        const totalCount = result.excerpts.length;
        result.excerpts = result.excerpts.slice(0, MAX_EXCERPTS_PER_PAGE);
        // Add indicator that there are more
        result.excerpts.push({
          before: '',
          match: `... و ${totalCount - MAX_EXCERPTS_PER_PAGE} حالات أخرى`,
          after: ''
        });
      }
    }
    
    const response: WordScanResponse = {
      word: searchWord,
      totalOccurrences,
      totalPages: results.length,
      totalDocuments: uniqueDocIds.length,
      results
    };
    
    console.log(`   ✅ Total: ${totalOccurrences} occurrences across ${results.length} pages`);
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Word scan error:', error);
    return NextResponse.json(
      { error: 'Failed to scan for word occurrences' },
      { status: 500 }
    );
  }
}
