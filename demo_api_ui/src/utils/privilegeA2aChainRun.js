import { loadGatewayRecord } from '../services/gatewayEvents';
import { profileLabel } from './privilegeA2aProfile';
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
  'Which grants on prod-db-primary have never been used?',
  'Open a ticket to review Carol Nguyen\'s access to prod-db-primary.',
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
export function chainHopToTokenEvent(payload, index, useCaseId = PRIVILEGE_A2A_CHAIN_USE_CASE_ID, profile = null) {
  const from = str(payload?.from);
  const to = str(payload?.to);
  if (!from || !to) return null;
  const kind = str(payload.kind) || 'delegate';
  return {
    id: `${PRIVILEGE_A2A_CHAIN_EVENT_PREFIX}${index}`,
    kind,
    from,
    to,
    // Display names only (real keys stay in from/to): the agent's own, else the vertical profile's.
    fromLabel: str(payload.fromLabel) || profileLabel(profile, from),
    toLabel: str(payload.toLabel) || profileLabel(profile, to),
    status: kind === 'error' ? 'error' : 'ok',
    label: str(payload.text) || `${from} → ${to}`,
    detail: str(payload.detail),
    elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : undefined,
    // What crossed the wire, as the main agent reports it (key already masked).
    request: str(payload.request) || undefined,
    response: str(payload.response) || undefined,
    // On a `card` hop: what the callee's A2A Agent Card said about it.
    card: payload.card && typeof payload.card === 'object' ? payload.card : undefined,
    // Protocol facts of the exchange (ids, status), the key the agent presented
    // (already masked), and how far into the run the agent reported this.
    wire: payload.wire && typeof payload.wire === 'object' ? payload.wire : undefined,
    credential: str(payload.credential) || undefined,
    // On a refused call the detail is the reason; this is the message that was sent.
    message: str(payload.message) || undefined,
    at: str(payload.at) || undefined,
    useCaseId,
  };
}

// Every run is bracketed on the reel: a first node for the client starting the
// flow and a last node when it is done. `client` is the browser and the app's
// server together; they carry the request to the main agent.
export const PRIVILEGE_A2A_START_ID = `${PRIVILEGE_A2A_CHAIN_EVENT_PREFIX}start`;
export const PRIVILEGE_A2A_DONE_ID = `${PRIVILEGE_A2A_CHAIN_EVENT_PREFIX}done`;
const CLIENT = 'client';
const MAIN = 'main';

const startEvent = (message, entry, useCaseId, profile) => ({
  id: PRIVILEGE_A2A_START_ID,
  kind: 'start',
  from: CLIENT,
  to: MAIN,
  toLabel: profileLabel(profile, MAIN),
  status: 'ok',
  label: 'Client started flow',
  detail: str(message),
  entry,
  useCaseId,
});

/** `text` is the final answer when the run completed, the reason when it did not. */
const doneEvent = (ok, text, useCaseId, profile) => ({
  id: PRIVILEGE_A2A_DONE_ID,
  kind: 'done',
  from: MAIN,
  to: CLIENT,
  fromLabel: profileLabel(profile, MAIN),
  status: ok ? 'ok' : 'error',
  label: 'Done',
  detail: str(text),
  useCaseId,
});

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
  profile,
  relayCardText = false,
  store = tokenChainTraceStore,
  fetchImpl = fetch,
  signal,
  loadRecord = loadGatewayRecord,
  recordDelayMs = RECORD_DELAY_MS,
} = {}) {
  const startedAt = Date.now();
  store.beginTrace({ prompt: `${message} (via ${specialist})` });
  store.ingestTokenEvent({
    ...startEvent(message, `POST ${API_URL}`, PRIVILEGE_A2A_CHAIN_USE_CASE_ID, profile),
    // What is unusual about this run, for the reel's first node.
    ...(relayCardText ? { note: "The middle agent is asked to pass its specialist's Agent Card text back unchecked. That specialist is the hostile demo agent, so the gateway should block the reply." } : {}),
  });
  let hops = 0;
  const seen = [];
  let answer = '';
  let failure = '';
  const handle = ({ event, payload }) => {
    if (event === 'trace') {
      const tokenEvent = chainHopToTokenEvent(payload, hops, PRIVILEGE_A2A_CHAIN_USE_CASE_ID, profile);
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
      body: JSON.stringify({ message, specialist, ...(relayCardText ? { relayCardText: true } : {}) }),
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

  store.ingestTokenEvent(doneEvent(!failure, failure || answer, PRIVILEGE_A2A_CHAIN_USE_CASE_ID, profile));
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
  mode,
  onEvent,
  profile,
  store = tokenChainTraceStore,
  fetchImpl = fetch,
  signal,
} = {}) {
  store.beginTrace({ prompt: message });
  store.ingestTokenEvent(startEvent(message, `POST ${CHAT_API_URL}`, PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID, profile));
  let hops = 0;
  const seen = [];
  let answer = '';
  let failure = '';
  const handle = ({ event, payload }) => {
    if (event === 'trace') {
      const tokenEvent = chainHopToTokenEvent(payload, hops, PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID, profile);
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
      body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}), ...(mode ? { mode } : {}) }),
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
    const reason = signal?.aborted ? 'Request cancelled.' : error?.message || 'The A2A request failed.';
    store.ingestTokenEvent(doneEvent(false, reason, PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID, profile));
    store.completeTrace(false, null, reason);
    throw error;
  }
  store.ingestTokenEvent(doneEvent(!failure, failure || answer, PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID, profile));
  if (failure) {
    store.completeTrace(false, null, failure);
    return { ok: false, error: failure };
  }
  if (answer) store.ingestLlmReply(answer);
  store.completeTrace(true);
  return { ok: true, answer };
}
