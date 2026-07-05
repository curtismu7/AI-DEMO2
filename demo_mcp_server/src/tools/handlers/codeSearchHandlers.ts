import type { HandlerFn } from './types';

const BASE = () => process.env.MCP_CODE_SEARCH_URL || 'http://demo-mcp-code-search:8095';
const CODEBASE_ID = 'ai-demo2';

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 503) throw new Error('code-search service unavailable');
  if (!res.ok) throw new Error(`code-search ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { type: 'text' as const, text: `Code search error: ${msg}`, success: false, error: msg };
}

export const executeCodeSearch: HandlerFn = async (_deps, _token, params) => {
  try {
    // Clamp to the 1-25 the tool description advertises, so an agent can't send an unbounded limit.
    const limit = Math.min(25, Math.max(1, Number(params.limit) || 10));
    const data = await call('/search', { query: params.query, codebase_id: CODEBASE_ID, limit });
    const results = data.results || [];
    const text = results.length
      ? results.map((r: any) => `${r.file}:${r.line_start}-${r.line_end} (${Math.round((r.relevance || 0) * 100)}%)\n${r.snippet}`).join('\n\n---\n\n')
      : 'No matches found.';
    return { type: 'text', text, success: true, structuredContent: { results } };
  } catch (err) { return errorResult(err); }
};

export const executeGetCode: HandlerFn = async (_deps, _token, params) => {
  try {
    const data = await call('/code', {
      codebase_id: CODEBASE_ID, file: params.file, line_start: params.line_start, line_end: params.line_end,
    });
    return { type: 'text', text: data.code ?? '', success: true, structuredContent: data };
  } catch (err) { return errorResult(err); }
};

export const executeListCodebases: HandlerFn = async (_deps, _token, _params) => {
  try {
    const res = await fetch(`${BASE()}/codebases`);
    if (res.status === 503) throw new Error('code-search service unavailable');
    if (!res.ok) throw new Error(`code-search ${res.status}`);
    const data = await res.json() as any;
    const list = data.codebases || [];
    const text = list.map((c: any) => `${c.name} (${c.id}) — ${c.chunks} chunks`).join('\n') || 'No codebases indexed.';
    return { type: 'text', text, success: true, structuredContent: { codebases: list } };
  } catch (err) { return errorResult(err); }
};
