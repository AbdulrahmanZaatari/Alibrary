export function chunkText(
  text: string,
  targetChunkSize: number = 1000,
  minChunkSize: number = 200
): string[] {
  const chunks: string[] = [];
  
  // Split by double newline (paragraphs), then filter out empty strings
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  let currentChunk = "";
  for (const paragraph of paragraphs) {
    // If a single paragraph is *already* too big, split it.
    if (paragraph.length > targetChunkSize) {
      // If we have a chunk built up, push it first.
      if (currentChunk.length > minChunkSize) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      
      // Split the oversized paragraph by sentences and group them.
      const sentences = paragraph.split(/(?<=[.!?])\s+/); // Split on sentence end
      let sentenceChunk = "";
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > targetChunkSize) {
          if (sentenceChunk.length > 0) {
            chunks.push(sentenceChunk);
          }
          sentenceChunk = sentence;
        } else {
          sentenceChunk += (sentenceChunk.length > 0 ? " " : "") + sentence;
        }
      }
      // Push the last sentence chunk from this paragraph
      if (sentenceChunk.length > 0) {
        chunks.push(sentenceChunk);
      }
    } 
    // If adding the new paragraph makes the chunk too big, push the current chunk.
    else if (currentChunk.length + paragraph.length > targetChunkSize) {
      if (currentChunk.length > minChunkSize) {
        chunks.push(currentChunk);
      }
      currentChunk = paragraph;
    } 
    // Otherwise, add the paragraph to the current chunk.
    else {
      currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + paragraph;
    }
  }

  // Push the last remaining chunk
  if (currentChunk.length > minChunkSize) {
    chunks.push(currentChunk);
  }

  return chunks;
}