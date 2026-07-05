/**
 * Weaviate persistence for code chunks, using bring-your-own vectors
 * (Weaviate vectorizer is `none`; this service supplies the embeddings).
 *
 * A single class `CodeChunk` holds every chunk; results are filtered by
 * `codebase_id`. The pure result-mapping (`mapHits`) is separated from the
 * client builder chain so it can be tested without a live Weaviate.
 */

import weaviate, { WeaviateClient } from 'weaviate-ts-client';
import { globToMatcher } from './fileFilter';

export const CLASS_NAME = 'CodeChunk';

// Minimal shape of a single weaviate-ts-client batch result element; the client
// returns one of these per submitted object, with per-object errors attached.
interface BatchResultItem {
  result?: { errors?: { error?: Array<{ message?: string }> } };
}

export interface SearchHit {
  file: string;
  line_start: number;
  line_end: number;
  relevance: number;
  snippet: string;
}

export interface StoredChunk {
  codebase_id: string;
  codebase_name: string;
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
  vector: number[];
}

export interface SearchOptions {
  codebaseId: string;
  limit: number;
  fileFilter?: string;
}

export interface Codebase {
  id: string;
  name: string;
  chunks: number;
}

export interface CodeRange {
  file: string;
  line_start: number;
  line_end: number;
  code: string;
}

export interface Store {
  ensureSchema(): Promise<void>;
  insertChunks(chunks: StoredChunk[]): Promise<void>;
  search(vector: number[], opts: SearchOptions): Promise<SearchHit[]>;
  listCodebases(): Promise<Codebase[]>;
  getCode(opts: { codebaseId: string; file: string; lineStart: number; lineEnd: number }): Promise<CodeRange | null>;
}

interface RawObject {
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
  _additional?: { certainty?: number };
}

interface RawChunk {
  line_start: number;
  line_end: number;
  snippet: string;
}

/** Map raw Weaviate objects to search hits, applying an optional file glob. */
export function mapHits(objects: RawObject[], fileFilter?: string): SearchHit[] {
  const matches = fileFilter ? globToMatcher(fileFilter) : () => true;
  return objects
    .filter((o) => matches(o.file))
    .map((o) => ({
      file: o.file,
      line_start: o.line_start,
      line_end: o.line_end,
      relevance: o._additional?.certainty ?? 0,
      snippet: o.snippet,
    }));
}

/** Rebuild lines [from..to] from overlapping 40-line chunks. Null if empty. */
export function stitchRange(chunks: RawChunk[], from: number, to: number): string | null {
  if (!chunks.length) return null;
  const byLine = new Map<number, string>();
  for (const c of chunks) {
    const lines = c.snippet.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = c.line_start + i;
      if (ln <= c.line_end && !byLine.has(ln)) byLine.set(ln, lines[i]);
    }
  }
  const present = [...byLine.keys()];
  if (!present.length) return null;
  const lo = Math.max(from, Math.min(...present));
  const hi = Math.min(to, Math.max(...present));
  const out: string[] = [];
  for (let ln = lo; ln <= hi; ln++) if (byLine.has(ln)) out.push(byLine.get(ln)!);
  return out.length ? out.join('\n') : null;
}

const SCHEMA = {
  class: CLASS_NAME,
  description: 'A chunk of source code with its embedding vector',
  vectorizer: 'none',
  properties: [
    { name: 'codebase_id', dataType: ['text'] },
    { name: 'codebase_name', dataType: ['text'] },
    { name: 'file', dataType: ['text'] },
    { name: 'line_start', dataType: ['int'] },
    { name: 'line_end', dataType: ['int'] },
    { name: 'snippet', dataType: ['text'] },
  ],
};

export function createStore(host: string): Store {
  const client: WeaviateClient = weaviate.client({ scheme: 'http', host });

  return {
    async ensureSchema(): Promise<void> {
      const schema = await client.schema.getter().do();
      const exists = (schema.classes ?? []).some((c) => c.class === CLASS_NAME);
      if (!exists) {
        await client.schema.classCreator().withClass(SCHEMA).do();
      }
    },

    async insertChunks(chunks: StoredChunk[]): Promise<void> {
      if (chunks.length === 0) return;
      let batcher = client.batch.objectsBatcher();
      for (const c of chunks) {
        batcher = batcher.withObject({
          class: CLASS_NAME,
          properties: {
            codebase_id: c.codebase_id,
            codebase_name: c.codebase_name,
            file: c.file,
            line_start: c.line_start,
            line_end: c.line_end,
            snippet: c.snippet,
          },
          vector: c.vector,
        });
      }
      // batcher.do() resolves even when individual objects fail (e.g. wrong
      // vector dimension, null vector, class validation): each element carries
      // its own `result.errors`. Inspect them so a partial/failed insert surfaces
      // as an error instead of being reported as a fully-successful index.
      const results = (await batcher.do()) as unknown as BatchResultItem[];
      const failed = (results ?? []).filter(
        (r) => (r?.result?.errors?.error?.length ?? 0) > 0
      );
      if (failed.length > 0) {
        const firstMsg =
          failed[0]?.result?.errors?.error?.[0]?.message ?? 'unknown error';
        throw new Error(
          `Weaviate batch insert failed for ${failed.length}/${results.length} objects: ${firstMsg}`
        );
      }
    },

    async search(vector: number[], opts: SearchOptions): Promise<SearchHit[]> {
      // When filtering by file, over-fetch so the post-filter can still fill `limit`.
      const fetchLimit = opts.fileFilter ? Math.min(opts.limit * 5, 100) : opts.limit;

      const res = await client.graphql
        .get()
        .withClassName(CLASS_NAME)
        .withFields('file line_start line_end snippet _additional { certainty }')
        .withNearVector({ vector })
        .withWhere({
          path: ['codebase_id'],
          operator: 'Equal',
          valueText: opts.codebaseId,
        })
        .withLimit(fetchLimit)
        .do();

      const objects: RawObject[] = res?.data?.Get?.[CLASS_NAME] ?? [];
      return mapHits(objects, opts.fileFilter).slice(0, opts.limit);
    },

    async listCodebases(): Promise<Codebase[]> {
      // Distinct codebases (with chunk counts) straight from Weaviate, so the UI
      // can list what is actually indexed instead of relying on per-browser
      // localStorage.
      const agg = await client.graphql
        .aggregate()
        .withClassName(CLASS_NAME)
        .withGroupBy(['codebase_id'])
        .withFields('groupedBy { value } meta { count }')
        .do();

      const groups: Array<{ groupedBy?: { value?: string }; meta?: { count?: number } }> =
        agg?.data?.Aggregate?.[CLASS_NAME] ?? [];

      // One name lookup per codebase, all in flight concurrently (latency ≈ a
      // single query). Deliberately NOT a single ContainsAny Get: that can't
      // guarantee one hit per codebase_id within any limit window (one large
      // codebase's chunks could starve the others out of the results).
      const codebases = await Promise.all(
        groups.map(async (g) => {
          const id = g.groupedBy?.value ?? '';
          // codebase_name isn't part of the groupBy result — fetch one chunk's.
          const one = await client.graphql
            .get()
            .withClassName(CLASS_NAME)
            .withFields('codebase_name')
            .withWhere({ path: ['codebase_id'], operator: 'Equal', valueText: id })
            .withLimit(1)
            .do();
          const name =
            one?.data?.Get?.[CLASS_NAME]?.[0]?.codebase_name ?? id;
          return { id, name, chunks: g.meta?.count ?? 0 };
        })
      );

      return codebases
        .filter((c) => c.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getCode(opts): Promise<CodeRange | null> {
      const res = await client.graphql
        .get()
        .withClassName(CLASS_NAME)
        .withFields('line_start line_end snippet')
        .withWhere({
          operator: 'And',
          operands: [
            { path: ['codebase_id'], operator: 'Equal', valueText: opts.codebaseId },
            { path: ['file'], operator: 'Equal', valueText: opts.file },
          ],
        })
        .withLimit(500)
        .do();
      const chunks = (res?.data?.Get?.[CLASS_NAME] ?? []) as RawChunk[];
      const code = stitchRange(chunks, opts.lineStart, opts.lineEnd);
      if (code === null) return null;
      return { file: opts.file, line_start: opts.lineStart, line_end: opts.lineEnd, code };
    },
  };
}
