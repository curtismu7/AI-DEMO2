import { executeCodeSearch, executeGetCode, executeListCodebases } from '../codeSearchHandlers';

const deps: any = { apiClient: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };
const okFetch = (body: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('code-search handlers', () => {
  afterEach(() => { (global as any).fetch = undefined; });

  test('code_search returns ranked results as text + structuredContent', async () => {
    (global as any).fetch = okFetch({ results: [{ file: 'a.ts', line_start: 1, line_end: 5, relevance: 0.9, snippet: 'x' }] });
    const r = await executeCodeSearch(deps, 'tok', { query: 'find x', limit: 5 });
    expect(r.type).toBe('text');
    expect(r.structuredContent!.results).toHaveLength(1);
    expect(r.text).toContain('a.ts');
  });

  test('code_search clamps limit to 1-25', async () => {
    const f = okFetch({ results: [] });
    (global as any).fetch = f;
    await executeCodeSearch(deps, 'tok', { query: 'q', limit: 100000 });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.limit).toBe(25);
  });

  test('get_code returns the code range', async () => {
    (global as any).fetch = okFetch({ file: 'a.ts', line_start: 1, line_end: 3, code: 'l1\nl2\nl3' });
    const r = await executeGetCode(deps, 'tok', { file: 'a.ts', line_start: 1, line_end: 3 });
    expect(r.text).toContain('l2');
  });

  test('list_codebases lists indexed codebases', async () => {
    (global as any).fetch = okFetch({ codebases: [{ id: 'ai-demo2', name: 'AI-DEMO2', chunks: 100 }] });
    const r = await executeListCodebases(deps, 'tok', {});
    expect(r.text).toContain('AI-DEMO2');
  });

  test('service 503 surfaces as an error result', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '{"error":"service_unavailable"}' });
    const r = await executeCodeSearch(deps, 'tok', { query: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/unavailable/i);
  });

  test('list_codebases 503 surfaces an unavailable error', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), text: async () => '{}' });
    const r = await executeListCodebases(deps, 'tok', {});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/unavailable/i);
  });
});
