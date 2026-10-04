import { randomUUID } from 'node:crypto';

/**
 * The three-deep run: this agent hands a message to a middle agent through
 * the gateway and names the specialist the middle agent should hand it on to.
 * No model is involved, so the route is the same every time.
 */

export const PRIMARY = 'primary';
export const MIDDLE = 'langchainagent';

/** One step of the chain, as the trace pane and the reel draw it. */
export interface ChainEvent {
  kind: 'delegate' | 'result' | 'error';
  from: string;
  to: string;
  text: string;
  detail?: string;
  elapsedMs?: number;
}

interface Hop {
  from?: unknown;
  to?: unknown;
  status?: unknown;
  detail?: unknown;
  elapsedMs?: unknown;
}

export interface ChainOptions {
  url: string;
  bearer: string;
  message: string;
  specialist: string;
  emit: (event: ChainEvent) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Turn the middle agent's hop report into chain events. */
function emitHops(hops: unknown, emit: ChainOptions['emit']): void {
  if (!Array.isArray(hops)) return;
  for (const hop of hops as Hop[]) {
    const from = text(hop.from) || MIDDLE;
    const to = text(hop.to);
    if (!to) continue;
    const elapsedMs = typeof hop.elapsedMs === 'number' ? hop.elapsedMs : undefined;
    if (hop.status === 'ok') {
      emit({ kind: 'delegate', from, to, text: `${from} → ${to}`, elapsedMs });
      emit({ kind: 'result', from: to, to: from, text: `${to} returned` });
    } else {
      emit({ kind: 'error', from, to, text: `${from} → ${to} refused`, detail: text(hop.detail), elapsedMs });
    }
  }
}

/**
 * Run the chain and report each step through `emit`. Resolves with the final
 * answer; rejects with the reason when any hop is refused or fails.
 */
export async function runChain(options: ChainOptions): Promise<string> {
  const { url, bearer, message, specialist, emit, signal } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  emit({ kind: 'delegate', from: PRIMARY, to: MIDDLE, text: `${PRIMARY} → ${MIDDLE}`, detail: message });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'message/send',
        params: {
          metadata: { delegateTo: specialist },
          message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: message }] },
        },
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'request failed';
    emit({ kind: 'error', from: PRIMARY, to: MIDDLE, text: `${MIDDLE} unreachable`, detail });
    throw new Error(detail);
  }

  const raw = await response.text();
  let body: { result?: { parts?: Array<{ text?: unknown }>; metadata?: { hops?: unknown } }; error?: { message?: unknown; data?: { hops?: unknown } } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch { /* The gateway refuses with plain text. */ }

  if (body?.result && response.ok) {
    emitHops(body.result.metadata?.hops, emit);
    const answer = (body.result.parts ?? []).map(part => text(part.text)).filter(Boolean).join('\n').trim();
    emit({ kind: 'result', from: MIDDLE, to: PRIMARY, text: `${MIDDLE} returned`, detail: answer });
    return answer;
  }

  // A JSON-RPC error with a hop report came from the middle agent (its own
  // hand-off was refused). Anything else was refused before reaching it.
  const hops = body?.error?.data?.hops;
  emitHops(hops, emit);
  const detail = text(body?.error?.message) || raw.trim().slice(0, 200) || `HTTP ${response.status}`;
  if (!Array.isArray(hops) || hops.length === 0) {
    emit({ kind: 'error', from: PRIMARY, to: MIDDLE, text: `${PRIMARY} → ${MIDDLE} refused`, detail: `${response.status}: ${detail}` });
  }
  throw new Error(detail);
}
