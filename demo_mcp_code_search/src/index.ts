/**
 * Bootstrap for the code-search service: read config, wire the real embedder
 * and Weaviate store, ensure the schema exists, then start the HTTP server.
 */

import 'dotenv/config';
import pino from 'pino';
import { createEmbedder } from './embeddings';
import { createStore } from './weaviateStore';
import { createServer } from './server';
import { createDocumentExtractor } from './documentExtractor';

const log = pino({ name: 'code-search' });

const PORT = Number(process.env.PORT || 8095);
const EMBEDDING_URL = process.env.EMBEDDING_URL || 'http://embeddings:8080';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text-v1.5';
const WEAVIATE_HOST = (process.env.WEAVIATE_URL || 'http://weaviate:8080').replace(
  /^https?:\/\//,
  ''
);
const TIKA_URL = process.env.TIKA_URL || 'http://tika:9998';

async function main(): Promise<void> {
  const embedder = createEmbedder({ baseUrl: EMBEDDING_URL, model: EMBEDDING_MODEL });
  const store = createStore(WEAVIATE_HOST);

  try {
    await store.ensureSchema();
    await store.ensureDocumentSchema();
    log.info({ class: 'CodeChunk' }, 'Weaviate schema ready');
  } catch (err) {
    // Don't crash if Weaviate is slow to come up — health stays green and
    // index/search requests surface 503 until the dependency is reachable.
    log.warn({ err: (err as Error).message }, 'Could not ensure schema at startup');
  }

  const app = createServer({ embedder, store, documentExtractor: createDocumentExtractor({
    baseUrl: TIKA_URL,
    timeoutMs: Number(process.env.DOCUMENT_PARSE_TIMEOUT_MS || 30_000),
    maxBytes: Number(process.env.DOCUMENT_MAX_BYTES || 10_485_760),
    maxExtractedChars: Number(process.env.DOCUMENT_MAX_EXTRACTED_CHARS || 2_000_000),
  }) });
  app.listen(PORT, () => {
    log.info(
      { port: PORT, embedding: EMBEDDING_URL, weaviate: WEAVIATE_HOST },
      'code-search listening'
    );
  });
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, 'fatal startup error');
  process.exit(1);
});
