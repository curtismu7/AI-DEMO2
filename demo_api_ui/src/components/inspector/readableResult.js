/**
 * What a tool actually said, pulled out of whatever shape the result arrived in.
 * Pure function — no React, no side effects.
 *
 * The inspector stores the raw body, so the same answer can arrive as:
 *   - a JSON-RPC frame      { jsonrpc, id, result: { content:[{type:'text',text}], isError?, structuredContent? } }
 *   - a JSON-RPC error      { jsonrpc, id, error:{ code, message } }
 *   - a gateway wrapper     { status, server, result: <MCP result> }
 *   - a local-fallback bare { accounts: [...] } or { error: '...' }
 * A text part that is itself JSON (the banking tools do this) is parsed into data;
 * anything else stays prose exactly as the tool wrote it.
 *
 * @typedef {{type:'text', text:string} | {type:'data', value:unknown}} Block
 * @typedef {{kind:'text'|'data'|'error'|'empty', isError:boolean, blocks:Block[], summary:string}} Readable
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parsedTextBlock(text) {
  const trimmed = text.trim();
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      return { type: 'data', value: JSON.parse(trimmed) };
    } catch {
      /* not JSON after all — keep it as the tool wrote it */
    }
  }
  return { type: 'text', text };
}

/** Peel gateway/BFF wrappers until the MCP result (the thing holding `content`) is reached. */
function unwrap(body) {
  let v = body;
  for (let i = 0; i < 3 && isObj(v) && !Array.isArray(v.content) && v.structuredContent === undefined; i += 1) {
    if (isObj(v.result)) v = v.result;
    else if (isObj(v.response) && isObj(v.response.result)) v = v.response.result;
    else break;
  }
  return v;
}

const firstLine = (s) => String(s).split('\n').find((l) => l.trim()) ?? '';

/** @returns {Readable} */
export function readableResult(body) {
  if (body === null || body === undefined || body === '') return { kind: 'empty', isError: false, blocks: [], summary: '' };

  // A JSON-RPC error has no result at all.
  if (isObj(body) && isObj(body.error) && body.result === undefined) {
    const text = [body.error.message, body.error.code != null ? `(code ${body.error.code})` : ''].filter(Boolean).join(' ');
    return { kind: 'error', isError: true, blocks: [{ type: 'text', text }], summary: firstLine(text) };
  }

  const r = unwrap(body);

  if (isObj(r) && Array.isArray(r.content)) {
    const blocks = [];
    for (const part of r.content) {
      if (part && part.type === 'text' && typeof part.text === 'string') blocks.push(parsedTextBlock(part.text));
      else if (part && part.type) blocks.push({ type: 'text', text: `[${part.type} content — see the JSON]` });
    }
    if (!blocks.length && r.structuredContent !== undefined) blocks.push({ type: 'data', value: r.structuredContent });
    const isError = r.isError === true;
    const lead = blocks.find((b) => b.type === 'text');
    return {
      kind: isError ? 'error' : blocks.length ? (blocks.every((b) => b.type === 'data') ? 'data' : 'text') : 'empty',
      isError,
      blocks,
      summary: lead ? firstLine(lead.text) : '',
    };
  }

  if (isObj(r) && r.structuredContent !== undefined) {
    return { kind: 'data', isError: r.isError === true, blocks: [{ type: 'data', value: r.structuredContent }], summary: '' };
  }

  // Local fallback / non-MCP handlers return the payload bare.
  if (isObj(r) && typeof r.error === 'string' && r.error) {
    return { kind: 'error', isError: true, blocks: [{ type: 'text', text: r.message ? `${r.error}: ${r.message}` : r.error }], summary: r.error };
  }
  if (typeof r === 'string') {
    return { kind: 'text', isError: false, blocks: [parsedTextBlock(r)], summary: firstLine(r) };
  }
  if (isObj(r) || Array.isArray(r)) {
    return { kind: 'data', isError: false, blocks: [{ type: 'data', value: r }], summary: '' };
  }
  return { kind: 'text', isError: false, blocks: [{ type: 'text', text: String(r) }], summary: String(r) };
}

/** First line of text from an MCP result, for status chips and the "What happened" step. */
export function toolErrorText(body) {
  const r = readableResult(body);
  return r.isError ? (r.blocks.find((b) => b.type === 'text')?.text ?? r.summary ?? '') : '';
}
