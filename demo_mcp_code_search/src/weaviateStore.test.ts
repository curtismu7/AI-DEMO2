import { mapHits, stitchRange } from './weaviateStore';

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

describe('stitchRange', () => {
  const chunks = [
    { line_start: 1, line_end: 3, snippet: 'a\nb\nc' },
    { line_start: 3, line_end: 5, snippet: 'c\nd\ne' }, // overlaps line 3
  ];
  test('reconstructs a range across overlapping chunks', () => {
    expect(stitchRange(chunks, 2, 4)).toEqual({ code: 'b\nc\nd', from: 2, to: 4 });
  });
  test('clamps to available lines', () => {
    const result = stitchRange(chunks, 4, 99);
    expect(result).toEqual({ code: 'd\ne', from: 4, to: 5 });
    if (result) expect(result.to).toBe(5); // verify bounds are real, not requested (99)
  });
  test('returns null when no chunk data', () => {
    expect(stitchRange([], 1, 5)).toBeNull();
  });
});
