import { randomUUID } from 'node:crypto';

/**
 * The three-deep run: this agent hands a message to a middle agent through
 * the gateway and names the specialist the middle agent should hand it on to.
 * No model is involved, so the route is the same every time.
 */

/** This agent's name in the chain trace. Ping's reference demo calls it the main agent. */
export const MAIN = 'main';
export const MIDDLE = 'langchainagent';

/** One step of the chain, as the trace pane and the reel draw it. */
export interface ChainEvent {
  kind: 'delegate' | 'result' | 'error';
  from: string;
  to: string;
  text: string;
  detail?: string;
  elapsedMs?: number;
  /** The HTTP request this agent sent, as text, with the agent key masked. */
  request?: string;
  /** The HTTP response this agent received, as text. */
  response?: string;
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

const MAX_WIRE_TEXT = 4000;

/** An agent key as it may be shown: its recognisable prefix only. */
const maskKey = (key: string): string => `${key.slice(0, 13)}… (masked)`;

const pretty = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw.trim();
  }
};

/**
 * Turn the middle agent's hop report into chain events. The middle agent
 * forwards the caller's text unchanged and returns the specialist's reply
 * unchanged, so `message` and `answer` are what crossed its own hop.
 */
function emitHops(hops: unknown, emit: ChainOptions['emit'], message: string, answer = ''): void {
  if (!Array.isArray(hops)) return;
  for (const hop of hops as Hop[]) {
    const from = text(hop.from) || MIDDLE;
    const to = text(hop.to);
    if (!to) continue;
    const elapsedMs = typeof hop.elapsedMs === 'number' ? hop.elapsedMs : undefined;
    if (hop.status === 'ok') {
      emit({ kind: 'delegate', from, to, text: `${from} → ${to}`, detail: message, elapsedMs });
      emit({ kind: 'result', from: to, to: from, text: `${to} returned`, detail: answer });
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      metadata: { delegateTo: specialist },
      message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: message }] },
    },
  });
  const request = [
    `POST ${url}`,
    'Content-Type: application/json',
    ...(bearer ? [`Authorization: Bearer ${maskKey(bearer)}`] : []),
    '',
    pretty(requestBody),
  ].join('\n');
  emit({ kind: 'delegate', from: MAIN, to: MIDDLE, text: `${MAIN} → ${MIDDLE}`, detail: message, request });

  let response: Response;
  const startedAt = Date.now();
  try {
    response = await fetchImpl(url, { method: 'POST', headers, signal, body: requestBody });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'request failed';
    emit({ kind: 'error', from: MAIN, to: MIDDLE, text: `${MIDDLE} unreachable`, detail });
    throw new Error(detail);
  }

  const raw = await response.text();
  const elapsedMs = Date.now() - startedAt;
  const wire = `HTTP ${response.status}\n\n${pretty(raw).slice(0, MAX_WIRE_TEXT)}`;
  let body: { result?: { parts?: Array<{ text?: unknown }>; metadata?: { hops?: unknown } }; error?: { message?: unknown; data?: { hops?: unknown } } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch { /* The gateway refuses with plain text. */ }

  if (body?.result && response.ok) {
    const answer = (body.result.parts ?? []).map(part => text(part.text)).filter(Boolean).join('\n').trim();
    emitHops(body.result.metadata?.hops, emit, message, answer);
    emit({ kind: 'result', from: MIDDLE, to: MAIN, text: `${MIDDLE} returned`, detail: answer, elapsedMs, response: wire });
    return answer;
  }

  // A JSON-RPC error with a hop report came from the middle agent (its own
  // hand-off was refused). Anything else was refused before reaching it.
  const hops = body?.error?.data?.hops;
  emitHops(hops, emit, message);
  const detail = text(body?.error?.message) || raw.trim().slice(0, 200) || `HTTP ${response.status}`;
  if (!Array.isArray(hops) || hops.length === 0) {
    emit({ kind: 'error', from: MAIN, to: MIDDLE, text: `${MAIN} → ${MIDDLE} refused`, detail: `${response.status}: ${detail}`, elapsedMs, response: wire });
  }
  throw new Error(detail);
}
