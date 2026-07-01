import request from 'supertest';
import { createServer } from './server';
import { Embedder } from './embeddings';
import { Store, StoredChunk, SearchHit, SearchOptions } from './weaviateStore';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function fakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async embed(texts: string[]) {
      calls.push(texts);
      return texts.map(() => [0.1, 0.2, 0.3]);
    },
  };
}

function fakeStore(hits: SearchHit[] = []): Store & {
  inserted: StoredChunk[];
  searches: Array<{ vector: number[]; opts: SearchOptions }>;
  schemaEnsured: boolean;
} {
  const state = { inserted: [] as StoredChunk[], searches: [] as any[], schemaEnsured: false };
  return {
    ...state,
    async ensureSchema() {
      this.schemaEnsured = true;
    },
    async insertChunks(chunks: StoredChunk[]) {
      this.inserted.push(...chunks);
    },
    async search(vector: number[], opts: SearchOptions) {
      this.searches.push({ vector, opts });
      return hits;
    },
  } as any;
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line${i + 1}`).join('\n');

describe('GET /health', () => {
  test('returns 200', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    await request(app).get('/health').expect(200);
  });
});

describe('POST /index', () => {
  test('chunks, embeds, stores, and returns counts', async () => {
    const embedder = fakeEmbedder();
    const store = fakeStore();
    const app = createServer({ embedder, store });

    const res = await request(app)
      .post('/index')
      .send({
        codebase_id: 'cb1',
        codebase_name: 'Demo',
        files: [{ path: 'a.ts', content: b64(lines(50)) }],
      })
      .expect(200);

    expect(res.body.codebase_id).toBe('cb1');
    expect(res.body.files_indexed).toBe(1);
    expect(res.body.chunks_created).toBeGreaterThan(0);
    expect(store.inserted.length).toBe(res.body.chunks_created);
    expect(store.inserted[0]).toMatchObject({ codebase_id: 'cb1', codebase_name: 'Demo', file: 'a.ts' });
    expect(store.inserted[0].vector).toEqual([0.1, 0.2, 0.3]);
  });

  test('returns 400 when codebase_id is missing', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    await request(app)
      .post('/index')
      .send({ codebase_name: 'x', files: [{ path: 'a.ts', content: b64('x') }] })
      .expect(400);
  });

  test('returns 503 when the embedder is unavailable', async () => {
    const embedder: Embedder = {
      async embed() {
        throw new Error('connect ECONNREFUSED');
      },
    };
    const app = createServer({ embedder, store: fakeStore() });
    await request(app)
      .post('/index')
      .send({ codebase_id: 'c', codebase_name: 'n', files: [{ path: 'a.ts', content: b64('x') }] })
      .expect(503);
  });
});

describe('POST /search', () => {
  test('embeds the query and maps store hits into the response shape', async () => {
    const embedder = fakeEmbedder();
    const hit: SearchHit = {
      file: 'a.ts',
      line_start: 1,
      line_end: 40,
      relevance: 0.9,
      snippet: 'code',
    };
    const store = fakeStore([hit]);
    const app = createServer({ embedder, store });

    const res = await request(app)
      .post('/search')
      .send({ query: 'find x', codebase_id: 'cb1', limit: 5 })
      .expect(200);

    expect(embedder.calls[0]).toEqual(['find x']);
    expect(store.searches[0].opts).toMatchObject({ codebaseId: 'cb1', limit: 5 });
    expect(res.body.results).toEqual([hit]);
    expect(typeof res.body.query_time_ms).toBe('number');
  });

  test('returns 400 when query is missing', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    await request(app).post('/search').send({ codebase_id: 'cb1' }).expect(400);
  });

  test('returns 503 when the store is unavailable', async () => {
    const store = fakeStore();
    store.search = async () => {
      throw new Error('weaviate connect ECONNREFUSED');
    };
    const app = createServer({ embedder: fakeEmbedder(), store });
    await request(app)
      .post('/search')
      .send({ query: 'q', codebase_id: 'cb1' })
      .expect(503);
  });
});
