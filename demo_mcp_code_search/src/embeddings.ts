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
  const post: PostFn =
    opts.post ?? ((url, body) => axios.post(url, body, { timeout: 30000 }));
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/embeddings`;

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const res = await post(url, { input: texts, model: opts.model });
      const items = ((res.data as { data?: EmbeddingItem[] })?.data ?? []);

      const vectors: number[][] = new Array(texts.length);
      for (const item of items) {
        vectors[item.index] = item.embedding;
      }
      // Fail loud on a partial/short/out-of-order response rather than letting
      // `undefined` vectors flow silently into the store (which Weaviate would
      // then reject or index without a usable vector).
      for (let i = 0; i < texts.length; i++) {
        if (!Array.isArray(vectors[i]) || vectors[i].length === 0) {
          throw new Error(
            `Embedding response is incomplete: missing vector for input index ${i} ` +
            `(${items.length} vectors returned for ${texts.length} inputs)`
          );
        }
      }
      return vectors;
    },
  };
}
