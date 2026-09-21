import { chunkDocument } from './documentChunker';

describe('document chunker', () => {
  it('keeps headings and page boundaries in stable chunks', () => {
    const input = { documentId: 'doc-1', collectionId: 'learning-hub', title: 'Guide', text: '# Intro\nAlpha paragraph.\n\f## Details\nBeta paragraph.', documentHash: 'hash-1' };
    const first = chunkDocument(input, { targetChars: 25, overlapChars: 5 });
    const second = chunkDocument(input, { targetChars: 25, overlapChars: 5 });
    expect(first.length).toBeGreaterThan(1);
    expect(first.map((c) => c.chunkId)).toEqual(second.map((c) => c.chunkId));
    expect(first.some((c) => c.section === 'Intro' && c.pageNumber === 1)).toBe(true);
    expect(first.some((c) => c.section === 'Details' && c.pageNumber === 2)).toBe(true);
  });
});
