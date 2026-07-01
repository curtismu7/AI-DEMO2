import { mapHits } from './weaviateStore';

const obj = (over: Partial<Record<string, unknown>> = {}) => ({
  file: 'src/app.ts',
  line_start: 1,
  line_end: 40,
  snippet: 'const x = 1;',
  _additional: { certainty: 0.87 },
  ...over,
});

describe('mapHits', () => {
  test('maps weaviate fields and uses certainty as relevance', () => {
    const hits = mapHits([obj()]);
    expect(hits).toEqual([
      { file: 'src/app.ts', line_start: 1, line_end: 40, relevance: 0.87, snippet: 'const x = 1;' },
    ]);
  });

  test('defaults relevance to 0 when certainty is absent', () => {
    const hits = mapHits([obj({ _additional: {} })]);
    expect(hits[0].relevance).toBe(0);
  });

  test('keeps only files matching the file filter', () => {
    const objects = [
      obj({ file: 'src/app.ts' }),
      obj({ file: 'test/app.test.ts' }),
    ];
    const hits = mapHits(objects, 'src/**');
    expect(hits.map((h) => h.file)).toEqual(['src/app.ts']);
  });

  test('returns all hits when no file filter is given', () => {
    const objects = [obj({ file: 'a.ts' }), obj({ file: 'b/c.ts' })];
    expect(mapHits(objects)).toHaveLength(2);
  });
});
