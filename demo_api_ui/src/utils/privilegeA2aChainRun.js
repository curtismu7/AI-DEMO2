import { loadGatewayRecord } from '../services/gatewayEvents';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

/**
 * Launch the three-deep Privilege A2A chain (main agent -> gateway ->
 * middle agent -> gateway -> specialist) and feed each hop into the token-chain
 * trace store as it arrives, so the movie reel and sequence view follow the run
 * live. One token event per hop, id `pa2a-<n>`, in arrival order.
 */

export const PRIVILEGE_A2A_CHAIN_USE_CASE_ID = 'privilege-a2a-agent-chain';
export const PRIVILEGE_A2A_CHAIN_EVENT_PREFIX = 'pa2a-';
export const PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID = 'privilege-a2a-access-review';
// Step 25A: the same review, run inside the embedded agent instead of on the A2A page.
export const PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID = 'privilege-a2a-access-review-agent';
export const PRIVILEGE_A2A_DEMO_QUESTIONS = [
  'Review access on prod-db-primary.',
  'List all entitlements for Carol Nguyen.',
  'Who has the prod-db-admin role?',
  'Who is offboarding and still has active access?',
];
const API_URL = '/api/privilege-a2a/chain';
// The token event that carries the gateway's own record of the run (see
// services/gatewayEvents.js). It has no `from`/`to`, so it is never a hop.
export const PRIVILEGE_A2A_GATEWAY_RECORD_ID = `${PRIVILEGE_A2A_CHAIN_EVENT_PREFIX}gateway-record`;
// The gateway's shipper posts a line as it is written; the index needs a
// moment to make it searchable.
const RECORD_DELAY_MS = 1500;
const CHAT_API_URL = '/api/privilege-a2a/chat';

const str = (value) => (typeof value === 'string' ? value : '');

/** A `trace` payload from the stream, as a token event the reel can draw. */
export function chainHopToTokenEvent(payload, index, useCaseId = PRIVILEGE_A2A_CHAIN_USE_CASE_ID) {
  const from = str(payload?.from);
  const to = str(payload?.to);
  if (!from || !to) return null;
  const kind = str(payload.kind) || 'delegate';
  return {
    id: `${PRIVILEGE_A2A_CHAIN_EVENT_PREFIX}${index}`,
    kind,
    from,
    to,
    status: kind === 'error' ? 'error' : 'ok',
    label: str(payload.text) || `${from} → ${to}`,
    detail: str(payload.detail),
    elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : undefined,
    // What crossed the wire, as the main agent reports it (key already masked).
    request: str(payload.request) || undefined,
    response: str(payload.response) || undefined,
    // On a `card` hop: what the callee's A2A Agent Card said about it.
    card: payload.card && typeof payload.card === 'object' ? payload.card : undefined,
    useCaseId,
  };
}

function readFrame(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, payload: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * Run the chain. Resolves `{ ok, answer?, error? }` once the stream ends; the
 * trace store is updated hop by hop while it runs.
 */
export async function startPrivilegeA2aChainRun({
  message,
  specialist,
  store = tokenChainTraceStore,
  fetchImpl = fetch,
  signal,
  loadRecord = loadGatewayRecord,
  recordDelayMs = RECORD_DELAY_MS,
} = {}) {
  const startedAt = Date.now();
  store.beginTrace({ prompt: `${message} (via ${specialist})` });
  let hops = 0;
  const seen = [];
  let answer = '';
  let failure = '';
  const handle = ({ event, payload }) => {
    if (event === 'trace') {
      const tokenEvent = chainHopToTokenEvent(payload, hops);
      if (tokenEvent) {
        hops += 1;
        store.ingestTokenEvent(tokenEvent);
        // The Simple Stepper and the token-chain panels read their events from
        // TokenChainContext, not the store; this is the bus it listens on.
        seen.push(tokenEvent);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('token-chain-inject', { detail: { tool: 'privilege-a2a-chain', events: [...seen] } }));
        }
      }
    } else if (event === 'token') {
      answer += str(payload?.text);
    } else if (event === 'error') {
      failure = str(payload?.error) || 'The chain failed.';
    }
  };

  try {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, specialist }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      failure = str(body?.error) || 'The A2A service is unavailable.';
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const parsed = readFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (parsed) handle(parsed);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    }
  } catch (error) {
    failure = error?.name === 'AbortError' ? 'Request cancelled.' : 'The A2A service is unavailable.';
  }

  // The run is settled either way; the gateway's own record follows it. It is
  // evidence beside the run, so it is not awaited and cannot fail the run.
  const attachRecord = () => {
    if (!hops || !loadRecord) return;
    setTimeout(async () => {
      const record = await loadRecord({ since: startedAt - 2000, until: Date.now() + 2000 });
      store.ingestTokenEvent({ id: PRIVILEGE_A2A_GATEWAY_RECORD_ID, ...record });
    }, recordDelayMs);
  };

  if (failure) {
    store.completeTrace(false, null, failure);
    attachRecord();
    return { ok: false, error: failure };
  }
  if (answer) store.ingestLlmReply(answer);
  store.completeTrace(true);
  attachRecord();
  return { ok: true, answer };
}

/**
 * Run one UC46 access-review chat (main agent -> gateway -> analyst -> MCP) and
 * feed each trace frame into the token-chain trace store, as the chain run does.
 * Every SSE frame is also handed to `onEvent(event, payload)` so the caller keeps
 * its own UI. Resolves `{ ok, answer?, error? }`; throws on a transport or HTTP failure
 * (after closing the trace).
 */
export async function runPrivilegeA2aChatRun({
  message,
  sessionId,
  onEvent,
  store = tokenChainTraceStore,
  fetchImpl = fetch,
  signal,
} = {}) {
  store.beginTrace({ prompt: message });
  let hops = 0;
  const seen = [];
  let answer = '';
  let failure = '';
  const handle = ({ event, payload }) => {
    if (event === 'trace') {
      const tokenEvent = chainHopToTokenEvent(payload, hops, PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID);
      if (tokenEvent) {
        hops += 1;
        store.ingestTokenEvent(tokenEvent);
        seen.push(tokenEvent);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('token-chain-inject', { detail: { tool: 'privilege-a2a-chat', events: [...seen] } }));
        }
      }
    } else if (event === 'token') {
      answer += str(payload?.text);
    } else if (event === 'error') {
      failure = str(payload?.error) || 'The A2A request failed.';
    }
    onEvent?.(event, payload);
  };
  try {
    const response = await fetchImpl(CHAT_API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { message, sessionId } : { message }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(str(body?.error) || 'The A2A service is unavailable.');
    }
    if (!response.body) throw new Error('The A2A service returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const parsed = readFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) handle(parsed);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const parsed = readFrame(buffer);
      if (parsed) handle(parsed);
    }
  } catch (error) {
    store.completeTrace(false, null, signal?.aborted ? 'Request cancelled.' : error?.message || 'The A2A request failed.');
    throw error;
  }
  if (failure) {
    store.completeTrace(false, null, failure);
    return { ok: false, error: failure };
  }
  if (answer) store.ingestLlmReply(answer);
  store.completeTrace(true);
  return { ok: true, answer };
}
