/**
 * What a tool actually said, pulled out of whatever shape the result arrived in.
 * Pure function — no React, no side effects.
 *
 * The inspector stores the raw body, so the same answer can arrive as:
 *   - a JSON-RPC frame      { jsonrpc, id, result: { content:[{type:'text',text}], isError?, structuredContent? } }
 *   - a JSON-RPC error      { jsonrpc, id, error:{ code, message } }
 *   - a gateway wrapper     { status, server, result: <MCP result> }
 *   - a refusal             { denied:true, status:403, error, message }  /  { error:true, message }
 *   - a local-fallback bare { accounts: [...] } or { error: '...' }
 * A text part that is itself JSON (the banking tools do this) is parsed into data;
 * anything else stays prose exactly as the tool wrote it.
 *
 * `ranTool` separates "the tool ran and said this" (including an isError result)
 * from "the call was refused / failed before or around the tool" (a denial, an
 * auth failure, a JSON-RPC protocol error): those are not the tool's words.
 *
 * @typedef {{type:'text', text:string} | {type:'data', value:unknown}} Block
 * @typedef {{kind:'text'|'data'|'error'|'empty', isError:boolean, ranTool:boolean, blocks:Block[], summary:string}} Readable
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
const textBlock = (text) => ({ type: 'text', text });

/** Same conditions as mcpCalls.refusalOf: a 200 can still carry a refusal. */
function refusalText(b) {
  if (!isObj(b)) return null;
  const code = Number(b.status);
  const strErr = typeof b.error === 'string' && b.error !== '';
  if (!b.denied && b.error !== true && !strErr && !(code >= 400)) return null;
  const msg = typeof b.message === 'string' ? b.message : '';
  const errCode = strErr ? b.error : '';
  const reason = typeof b.reason === 'string' ? b.reason : '';
  const main = msg || errCode || reason;
  if (!main) return `HTTP ${b.status ?? 200} refusal`;
  const tags = [msg ? errCode : '', msg || errCode ? reason : ''].filter(Boolean);
  return tags.length ? `${main} (${tags.join(', ')})` : main;
}

/** @returns {Readable} */
export function readableResult(body) {
  if (body === null || body === undefined || body === '') return { kind: 'empty', isError: false, ranTool: true, blocks: [], summary: '' };

  // A JSON-RPC error has no result at all: the protocol refused, the tool did not speak.
  if (isObj(body) && isObj(body.error) && body.result === undefined) {
    const text = [body.error.message, body.error.code != null ? `(code ${body.error.code})` : ''].filter(Boolean).join(' ');
    return { kind: 'error', isError: true, ranTool: false, blocks: [textBlock(text)], summary: firstLine(text) };
  }

  // A refusal wrapper (gateway DENY, PingOne flag off, HTTP >= 400, bare {error}).
  const refusal = refusalText(body);
  if (refusal !== null && !(isObj(body) && (Array.isArray(body.content) || isObj(body.result)))) {
    return { kind: 'error', isError: true, ranTool: false, blocks: [textBlock(refusal)], summary: firstLine(refusal) };
  }

  const r = unwrap(body);

  if (isObj(r) && Array.isArray(r.content)) {
    const blocks = [];
    for (const part of r.content) {
      if (part && part.type === 'text' && typeof part.text === 'string') blocks.push(parsedTextBlock(part.text));
      else if (part && part.type) blocks.push(textBlock(`[${part.type} content — see the JSON]`));
    }
    if (!blocks.length && r.structuredContent !== undefined) blocks.push({ type: 'data', value: r.structuredContent });
    const isError = r.isError === true;
    const lead = blocks.find((b) => b.type === 'text');
    return {
      kind: isError ? 'error' : blocks.length ? (blocks.every((b) => b.type === 'data') ? 'data' : 'text') : 'empty',
      isError,
      ranTool: true,
      blocks,
      summary: lead ? firstLine(lead.text) : '',
    };
  }

  if (isObj(r) && r.structuredContent !== undefined) {
    return { kind: r.isError === true ? 'error' : 'data', isError: r.isError === true, ranTool: true, blocks: [{ type: 'data', value: r.structuredContent }], summary: '' };
  }

  // Wrapped refusal reached after unwrapping (e.g. {response:{result:{error:'x'}}}).
  const inner = refusalText(r);
  if (inner !== null) return { kind: 'error', isError: true, ranTool: false, blocks: [textBlock(inner)], summary: firstLine(inner) };

  if (typeof r === 'string') {
    return { kind: 'text', isError: false, ranTool: true, blocks: [parsedTextBlock(r)], summary: firstLine(r) };
  }
  if (isObj(r) || Array.isArray(r)) {
    return { kind: 'data', isError: false, ranTool: true, blocks: [{ type: 'data', value: r }], summary: '' };
  }
  return { kind: 'text', isError: false, ranTool: true, blocks: [textBlock(String(r))], summary: String(r) };
}

/** The words for a failure: the text blocks, else the data as JSON, else a plain sentence. Never empty. */
export function failureMessage(readable) {
  const text = readable.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (text) return text;
  const data = readable.blocks.find((b) => b.type === 'data');
  if (data) return JSON.stringify(data.value);
  return 'The tool reported an error.';
}

/** `{ message, ranTool }` when the body is a failure of any kind, else null. */
export function failureOf(body) {
  const r = readableResult(body);
  return r.isError ? { message: failureMessage(r), ranTool: r.ranTool } : null;
}
