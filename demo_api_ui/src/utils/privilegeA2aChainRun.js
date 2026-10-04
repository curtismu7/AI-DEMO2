import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

/**
 * Launch the three-deep Privilege A2A chain (main agent -> gateway ->
 * middle agent -> gateway -> specialist) and feed each hop into the token-chain
 * trace store as it arrives, so the movie reel and sequence view follow the run
 * live. One token event per hop, id `pa2a-<n>`, in arrival order.
 */

export const PRIVILEGE_A2A_CHAIN_USE_CASE_ID = 'privilege-a2a-agent-chain';
export const PRIVILEGE_A2A_CHAIN_EVENT_PREFIX = 'pa2a-';
const API_URL = '/api/privilege-a2a/chain';

const str = (value) => (typeof value === 'string' ? value : '');

/** A `trace` payload from the stream, as a token event the reel can draw. */
export function chainHopToTokenEvent(payload, index) {
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
    useCaseId: PRIVILEGE_A2A_CHAIN_USE_CASE_ID,
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
} = {}) {
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

  if (failure) {
    store.completeTrace(false, null, failure);
    return { ok: false, error: failure };
  }
  if (answer) store.ingestLlmReply(answer);
  store.completeTrace(true);
  return { ok: true, answer };
}
