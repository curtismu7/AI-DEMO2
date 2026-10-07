export {};

// Additive migration of a legacy LearningHubDocumentChunk class (word-tokenized document_id/collection_id).

type Obj = { id: string; document_id: string; collection_id: string; document_key?: string | null; collection_key?: string | null; vector: number[] };

const legacyProps = ['document_id', 'collection_id', 'title'].map((name) => ({ name, tokenization: 'word' }));
const migratedProps = [...legacyProps, { name: 'document_key', tokenization: 'field' }, { name: 'collection_key', tokenization: 'field' }];
const legacy = [{ class: 'LearningHubDocumentChunk', properties: legacyProps }];
const migrated = [{ class: 'LearningHubDocumentChunk', properties: migratedProps }];

let objects: Obj[];
let log: string[];
let failIds: Set<string>;

const boot = (classes: unknown[]) => {
  log = [];
  jest.resetModules();
  jest.doMock('weaviate-ts-client', () => ({
    __esModule: true,
    default: {
      client: () => ({
        schema: {
          getter: () => ({ do: async () => ({ classes }) }),
          classDeleter: () => ({ withClassName: (n: string) => ({ do: async () => { log.push(`delete:${n}`); } }) }),
          classCreator: () => ({ withClass: (c: { class: string }) => ({ do: async () => { log.push(`create:${c.class}`); } }) }),
          propertyCreator: () => ({
            withClassName: () => ({ withProperty: (p: { name: string; tokenization: string }) => ({ do: async () => { log.push(`addprop:${p.name}:${p.tokenization}`); } }) }),
          }),
        },
        graphql: {
          get: () => {
            let after = '';
            let limit = 100;
            const q: any = {
              withClassName: () => q,
              withFields: () => q,
              withLimit: (n: number) => { limit = n; return q; },
              withAfter: (a: string) => { after = a; return q; },
              do: async () => {
                const sorted = [...objects].sort((a, b) => a.id.localeCompare(b.id)).filter((o) => !after || o.id > after);
                return { data: { Get: { LearningHubDocumentChunk: sorted.slice(0, limit).map((o) => ({ ...o, _additional: { id: o.id } })) } } };
              },
            };
            return q;
          },
        },
        data: {
          merger: () => {
            let id = '';
            let props: Record<string, string> = {};
            const m: any = {
              withClassName: () => m,
              withId: (i: string) => { id = i; return m; },
              withProperties: (p: Record<string, string>) => { props = p; return m; },
              do: async () => {
                if (failIds.has(id)) throw new Error('boom');
                Object.assign(objects.find((o) => o.id === id)!, props);
                log.push(`merge:${id}`);
              },
            };
            return m;
          },
        },
      }),
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./weaviateStore').createStore('x:1');
};

beforeEach(() => {
  failIds = new Set();
  objects = ['a', 'b', 'c'].map((id) => ({ id, document_id: `learning-hub:${id}.html`, collection_id: 'learning-hub', vector: [1, 2] }));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

test('legacy class: props added, every object merged, nothing deleted, vectors untouched', async () => {
  await boot(legacy).ensureDocumentSchema();
  expect(log.filter((l) => l.startsWith('addprop'))).toEqual(['addprop:document_key:field', 'addprop:collection_key:field']);
  expect(log.filter((l) => l.startsWith('merge'))).toEqual(['merge:a', 'merge:b', 'merge:c']);
  expect(log.some((l) => l.startsWith('delete') || l.startsWith('create'))).toBe(false);
  expect(objects.map((o) => o.document_key)).toEqual(objects.map((o) => o.document_id));
  expect(objects.every((o) => o.collection_key === 'learning-hub' && o.vector.length === 2)).toBe(true);
});

test('already migrated: no writes', async () => {
  objects.forEach((o) => { o.document_key = o.document_id; o.collection_key = o.collection_id; });
  await boot(migrated).ensureDocumentSchema();
  expect(log).toEqual([]);
});

test('re-run backfills only objects written by older code after the schema change', async () => {
  objects.forEach((o) => { o.document_key = o.document_id; o.collection_key = o.collection_id; });
  objects.push({ id: 'd', document_id: 'learning-hub:d.html', collection_id: 'learning-hub', vector: [1] });
  await boot(migrated).ensureDocumentSchema();
  expect(log).toEqual(['merge:d']);
});

test('partial backfill failure: no destructive step, error logged, retried next start', async () => {
  failIds.add('b');
  await boot(legacy).ensureDocumentSchema();
  expect(log.some((l) => l.startsWith('delete'))).toBe(false);
  expect((console.error as jest.Mock).mock.calls.map((c) => c[0]).join('\n')).toMatch(/INCOMPLETE.*retry on next start/);
  expect(objects.find((o) => o.id === 'b')!.document_key).toBeUndefined();
  failIds.clear();
  await boot(migrated).ensureDocumentSchema();
  expect(log).toEqual(['merge:b']);
});

test('pages past the cursor size', async () => {
  objects = Array.from({ length: 250 }, (_, i) => ({ id: `o${String(i).padStart(3, '0')}`, document_id: `d${i}`, collection_id: 'c', vector: [1] }));
  await boot(legacy).ensureDocumentSchema();
  expect(log.filter((l) => l.startsWith('merge'))).toHaveLength(250);
});

test('new class is created in one step', async () => {
  await boot([]).ensureDocumentSchema();
  expect(log).toEqual(['create:LearningHubDocumentChunk']);
});

test('document-path Equal filters never reference the word-tokenized props', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, 'weaviateStore.ts'), 'utf8');
  const docPaths = src.slice(src.indexOf('async replaceDocumentChunks'));
  expect(docPaths).not.toMatch(/path: \['(document_id|collection_id)'\]/);
  expect(docPaths).toMatch(/path: \['document_key'\]/);
});
