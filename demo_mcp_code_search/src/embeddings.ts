/**
 * Embedding client for a llama.cpp server running in `--embedding` mode.
 * Talks the OpenAI-compatible `POST /v1/embeddings` endpoint.
 */

import axios from 'axios';

export interface Embedder {
  /** Embed a batch of texts, returning one vector per input in input order. */
  embed(texts: string[]): Promise<number[][]>;
}

type PostFn = (url: string, body: unknown) => Promise<{ data: unknown }>;

export interface EmbedderOptions {
  baseUrl: string;
  model: string;
  /** Injectable for testing; defaults to a real axios POST. */
  post?: PostFn;
}

interface EmbeddingItem {
  index: number;
  embedding: number[];
}

export function createEmbedder(opts: EmbedderOptions): Embedder {
  // Indexing a whole repo embeds thousands of chunks on a single-slot CPU
  // embedder — 30s was never enough for a 400-file batch. Each internal
  // slice (EMBED_BATCH inputs) gets its own generous window instead.
  const post: PostFn =
    opts.post ?? ((url, body) => axios.post(url, body, { timeout: 600000 }));
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/embeddings`;

  // nomic-embed-text v1.5's trained context is 2048 tokens and llama.cpp
  // rejects longer inputs outright ("input ... is larger than the max context
  // size"), which failed the whole index batch on any oversized chunk (giant
  // single-line JSON/markdown). Truncate defensively: punctuation-dense
  // content tokenizes at ~2 chars/token (a 6000-char chunk measured 2727
  // tokens), so 3500 chars keeps the worst case under the 2048 cap; only the
  // pathological chunk loses tail recall, everything else is untouched.
  // Keep under the SE embeddings physical batch (-b 2048) as well.
  const MAX_EMBED_CHARS = 3500;

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const input = texts.map((t) =>
        t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t
      );
      // SE CPU embedder (~2–3s/chunk): keep each HTTP call short so axios
      // timeouts don't abort mid-batch.
      const EMBED_BATCH = 8;
      const vectors: number[][] = new Array(texts.length);
      for (let off = 0; off < input.length; off += EMBED_BATCH) {
        const slice = input.slice(off, off + EMBED_BATCH);
        const res = await post(url, { input: slice, model: opts.model });
        const items = ((res.data as { data?: EmbeddingItem[] })?.data ?? []);
        for (const item of items) {
          vectors[off + item.index] = item.embedding;
        }
      }
      // Fail loud on a partial/short/out-of-order response rather than letting
      // `undefined` vectors flow silently into the store (which Weaviate would
      // then reject or index without a usable vector).
      for (let i = 0; i < texts.length; i++) {
        if (!Array.isArray(vectors[i]) || vectors[i].length === 0) {
          throw new Error(
            `Embedding response is incomplete: missing vector for input index ${i} ` +
            `of ${texts.length} inputs`
          );
        }
      }
      return vectors;
    },
  };
}
