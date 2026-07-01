import { chunkFile } from './chunker';

const lines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `line${i + 1}`).join('\n');

describe('chunkFile', () => {
  test('returns a single chunk when the file is shorter than the window', () => {
    const chunks = chunkFile(
      { path: 'a.ts', content: lines(10) },
      { windowLines: 40, overlapLines: 8 }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ file: 'a.ts', line_start: 1, line_end: 10 });
    expect(chunks[0].snippet).toContain('line1');
    expect(chunks[0].snippet).toContain('line10');
  });

  test('splits a long file into overlapping windows with correct line ranges', () => {
    const chunks = chunkFile(
      { path: 'big.ts', content: lines(100) },
      { windowLines: 40, overlapLines: 8 }
    );
    // step = window - overlap = 32; stop once a window reaches the last line
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ line_start: 1, line_end: 40 });
    expect(chunks[1]).toMatchObject({ line_start: 33, line_end: 72 });
    expect(chunks[2]).toMatchObject({ line_start: 65, line_end: 100 });
  });

  test('the last chunk captures the remainder up to the final line', () => {
    const chunks = chunkFile(
      { path: 'r.ts', content: lines(50) },
      { windowLines: 40, overlapLines: 8 }
    );
    expect(chunks[chunks.length - 1].line_end).toBe(50);
  });

  test('returns no chunks for an empty file', () => {
    expect(chunkFile({ path: 'empty.ts', content: '' }, { windowLines: 40, overlapLines: 8 })).toEqual([]);
  });

  test('snippet contains the exact source lines for the window', () => {
    const chunks = chunkFile(
      { path: 's.ts', content: lines(5) },
      { windowLines: 2, overlapLines: 0 }
    );
    expect(chunks[0].snippet).toBe('line1\nline2');
    expect(chunks[0]).toMatchObject({ line_start: 1, line_end: 2 });
    expect(chunks[1].snippet).toBe('line3\nline4');
  });
});
