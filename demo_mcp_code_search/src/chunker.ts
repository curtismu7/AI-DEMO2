/**
 * Line-based code chunking.
 *
 * Splits a file into fixed-size windows of lines with a small overlap so a
 * construct that straddles a window boundary still appears whole in one chunk.
 * Line numbers are 1-based and inclusive.
 */

export interface SourceFile {
  path: string;
  content: string;
}

export interface Chunk {
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
}

export interface ChunkOptions {
  windowLines: number;
  overlapLines: number;
}

export function chunkFile(file: SourceFile, opts: ChunkOptions): Chunk[] {
  const lines = file.content.split('\n');
  const total = lines.length;

  // An empty file splits to a single empty string — nothing to index.
  if (total === 0 || (total === 1 && lines[0] === '')) {
    return [];
  }

  const step = Math.max(1, opts.windowLines - opts.overlapLines);
  const chunks: Chunk[] = [];

  for (let start = 1; start <= total; start += step) {
    const end = Math.min(start + opts.windowLines - 1, total);
    chunks.push({
      file: file.path,
      line_start: start,
      line_end: end,
      snippet: lines.slice(start - 1, end).join('\n'),
    });
    if (end >= total) break;
  }

  return chunks;
}
