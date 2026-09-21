import crypto from 'node:crypto';

export interface DocumentChunkInput { documentId: string; collectionId: string; title: string; text: string; documentHash?: string; mediaType?: string; sourceUrl?: string; sourcePath?: string; }
export interface DocumentChunk { chunkId: string; documentId: string; collectionId: string; title: string; text: string; documentHash?: string; mediaType?: string; section?: string; pageNumber?: number; sourceUrl?: string; sourcePath?: string; }

export function chunkDocument(input: DocumentChunkInput, options: { targetChars?: number; overlapChars?: number } = {}): DocumentChunk[] {
  const target = options.targetChars ?? 3500;
  const overlap = options.overlapChars ?? 400;
  const pages = input.text.split(/\f/);
  const chunks: DocumentChunk[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex].replace(/\r/g, '').trim();
    if (!page) continue;
    let section: string | undefined;
    const paragraphs = page.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      const identity = `${input.collectionId}:${input.documentHash ?? crypto.createHash('sha256').update(input.text).digest('hex')}:${pageIndex + 1}:${section ?? ''}:${chunks.length}`;
      chunks.push({ chunkId: crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24), documentId: input.documentId, collectionId: input.collectionId, title: input.title, text: buffer.trim(), documentHash: input.documentHash, mediaType: input.mediaType, section, pageNumber: pageIndex + 1, sourceUrl: input.sourceUrl, sourcePath: input.sourcePath });
      buffer = overlap ? buffer.slice(-overlap) : '';
    };
    for (const paragraph of paragraphs) {
      const heading = paragraph.match(/^#{1,6}\s+(.+)$/m);
      if (heading) section = heading[1].trim();
      if (buffer && buffer.length + paragraph.length + 2 > target) flush();
      buffer += `${buffer ? '\n\n' : ''}${paragraph}`;
    }
    flush();
  }
  return chunks;
}
