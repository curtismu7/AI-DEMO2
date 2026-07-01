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

export interface Store {
  ensureSchema(): Promise<void>;
  insertChunks(chunks: StoredChunk[]): Promise<void>;
  search(vector: number[], opts: SearchOptions): Promise<SearchHit[]>;
}

interface RawObject {
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
  _additional?: { certainty?: number };
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
      await batcher.do();
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
  };
}
