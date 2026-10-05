import { randomUUID } from 'node:crypto';

import type { Profile } from '../profile.js';

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
  kind: 'card' | 'delegate' | 'result' | 'error';
  from: string;
  to: string;
  text: string;
  detail?: string;
  elapsedMs?: number;
  /** The HTTP request this agent sent, as text, with the agent key masked. */
  request?: string;
  /** The HTTP response this agent received, as text. */
  response?: string;
  /** On a `card` event: what the callee's A2A Agent Card said about it. */
  card?: CardSummary;
  /** Protocol facts of the request or response this event stands for. */
  wire?: WireFacts;
  /** The key this agent presented, masked to its recognisable prefix. */
  credential?: string;
  /** On a refused call: the message that was sent (`detail` holds the reason). */
  message?: string;
  /** Display names, present only when a vertical profile was supplied. */
  fromLabel?: string;
  toLabel?: string;
}

/** The fields of an A2A Agent Card the trace shows. */
export interface CardSummary {
  name: string;
  description: string;
  protocolVersion: string;
  url: string;
  preferredTransport: string;
  skills: string[];
  version: string;
  /** Each capability the card states, as `name: yes` or `name: no`. */
  capabilities: string[];
  inputModes: string[];
  outputModes: string[];
  skillDetails: Array<{ id: string; name: string; description: string; tags: string[] }>;
  /** Each security scheme the card declares, with the scopes it requires. */
  security: string[];
}

/** What the trace shows of one HTTP exchange, beyond its text. */
export interface WireFacts {
  status?: number;
  /** JSON-RPC `id`: sent on a request, echoed on a response. */
  rpcId?: string;
  /** A2A `messageId` of the message this event carried. */
  messageId?: string;
  errorCode?: number;
  /** The specialist the caller asked the callee to hand on to. */
  delegateTo?: string;
  delegatedTo?: string;
  delegatedBy?: string;
  kind?: string;
  role?: string;
}

/** One entry of the middle agent's report: a card it read, or a call it made. */
interface Hop {
  kind?: unknown;
  from?: unknown;
  to?: unknown;
  status?: unknown;
  detail?: unknown;
  elapsedMs?: unknown;
  /** What crossed the wire, when the middle agent reports it (key already masked). */
  message?: unknown;
  reply?: unknown;
  request?: unknown;
  response?: unknown;
  credential?: unknown;
  wire?: unknown;
  card?: unknown;
}

export interface ChainOptions {
  url: string;
  bearer: string;
  message: string;
  specialist: string;
  emit: (event: ChainEvent) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Per-vertical display names; adds fromLabel/toLabel only, never changes keys or routes. */
  profile?: Profile | null;
}

/** Display name for a chain key under a profile, or undefined for a key it does not rename. */
function chainLabel(profile: Profile, key: string): string | undefined {
  const label = key === MAIN ? profile.agentName
    : key === 'refunds' ? profile.specialistName
      : key === 'restricted' ? `Ungranted ${profile.specialistName}`
        : key === MIDDLE ? 'LangChain agent' : undefined;
  return label?.slice(0, 80);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const record = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** The card's security schemes, each with its kind and the scopes the card requires for it. */
function cardSecurity(body: Record<string, unknown>): string[] {
  const required: Record<string, string[]> = {};
  for (const entry of Array.isArray(body.securityRequirements) ? body.securityRequirements : (Array.isArray(body.security) ? body.security : [])) {
    for (const [name, scopes] of Object.entries(record(entry))) required[name] = texts(scopes);
  }
  return Object.entries(record(body.securitySchemes)).map(([name, scheme]) => {
    const fields = record(scheme);
    const kind = text(fields.type) || Object.keys(fields)[0] || 'unspecified';
    const scopes = required[name] ?? [];
    return `${name} (${kind})${scopes.length ? `, scopes: ${scopes.join(' ')}` : ''}`;
  });
}

const MAX_WIRE_TEXT = 4000;

/** An agent key as it may be shown: its recognisable prefix only. */
export const maskKey = (key: string): string => `${key.slice(0, 13)}… (masked)`;

export const pretty = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw.trim();
  }
};

/**
 * Turn the middle agent's hop report into chain events. A current middle agent
 * reports what crossed its own hop (the card it read, its request, the reply).
 * An older one reports only that the hop happened; it forwards the caller's
 * text and returns the specialist's reply unchanged, so `message` and `answer`
 * stand in for them.
 */
function emitHops(hops: unknown, emit: ChainOptions['emit'], message: string, answer = ''): void {
  if (!Array.isArray(hops)) return;
  for (const hop of hops as Hop[]) {
    const from = text(hop.from) || MIDDLE;
    const to = text(hop.to);
    if (!to) continue;
    const elapsedMs = typeof hop.elapsedMs === 'number' ? hop.elapsedMs : undefined;
    const reported = record(hop.wire);
    const number = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const shared = {
      ...(text(hop.request) ? { request: text(hop.request) } : {}),
      ...(text(hop.credential) ? { credential: text(hop.credential) } : {}),
    };
    if (hop.kind === 'card') {
      const card = record(hop.card);
      emit({
        kind: 'card',
        from,
        to,
        text: `${from} reads ${to}'s Agent Card`,
        detail: text(hop.detail),
        elapsedMs,
        ...shared,
        ...(text(hop.response) ? { response: text(hop.response) } : {}),
        ...(typeof card.name === 'string' ? { card: card as unknown as CardSummary } : {}),
        ...(number(reported.status) ? { wire: { status: number(reported.status) } } : {}),
      });
    } else if (hop.status === 'ok') {
      const sent: WireFacts = { rpcId: text(reported.rpcId), messageId: text(reported.messageId) };
      emit({ kind: 'delegate', from, to, text: `${from} → ${to}`, detail: text(hop.message) || message, elapsedMs, ...shared, ...(sent.rpcId ? { wire: sent } : {}) });
      emit({
        kind: 'result',
        from: to,
        to: from,
        text: `${to} returned`,
        detail: text(hop.reply) || answer,
        ...(text(hop.response) ? { response: text(hop.response) } : {}),
        ...(number(reported.status) ? { wire: { status: number(reported.status), rpcId: text(reported.rpcId), messageId: text(reported.replyMessageId), kind: text(reported.kind), role: text(reported.role) } } : {}),
      });
    } else {
      emit({
        kind: 'error',
        from,
        to,
        text: `${from} → ${to} refused`,
        detail: text(hop.detail),
        elapsedMs,
        ...shared,
        ...(text(hop.message) ? { message: text(hop.message) } : {}),
        ...(text(hop.response) ? { response: text(hop.response) } : {}),
        ...(number(reported.status) ? { wire: { status: number(reported.status), rpcId: text(reported.rpcId), messageId: text(reported.messageId), ...(number(reported.errorCode) !== undefined ? { errorCode: number(reported.errorCode) } : {}) } } : {}),
      });
    }
  }
}

/** Where an agent's card lives, given the JSON-RPC endpoint the gateway routes to it. */
export const cardUrlFor = (jsonRpcUrl: string): string =>
  `${jsonRpcUrl.replace(/\/jsonrpc\/?$/, '')}/.well-known/agent-card.json`;

/**
 * Read the middle agent's A2A Agent Card through the gateway, with this
 * agent's own key, and report it. Discovery only: the chain still calls the
 * gateway's route, whatever endpoint the card names. A card that cannot be
 * read is reported and the run carries on, because the call does not need it.
 */
async function discover(options: ChainOptions, fetchImpl: typeof fetch): Promise<void> {
  const { url, bearer, emit, signal } = options;
  const cardUrl = cardUrlFor(url);
  const request = [`GET ${cardUrl}`, ...(bearer ? [`Authorization: Bearer ${maskKey(bearer)}`] : [])].join('\n');
  const credential = bearer ? maskKey(bearer) : undefined;
  const report = (detail: string, response?: string, card?: CardSummary, status?: number): void =>
    emit({ kind: 'card', from: MAIN, to: MIDDLE, text: `${MAIN} reads ${MIDDLE}'s Agent Card`, detail, request, response, card, credential, ...(status ? { wire: { status } } : {}) });
  try {
    const response = await fetchImpl(cardUrl, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal });
    const raw = await response.text();
    const wire = `HTTP ${response.status}\n\n${pretty(raw).slice(0, MAX_WIRE_TEXT)}`;
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(raw);
    } catch { /* The gateway refuses with plain text. */ }
    if (!response.ok || !body || typeof body.name !== 'string') {
      report(`No Agent Card returned (HTTP ${response.status})`, wire, undefined, response.status);
      return;
    }
    const skills = Array.isArray(body.skills) ? body.skills : [];
    report(`Agent Card for ${body.name}`, wire, {
      name: body.name,
      description: text(body.description),
      protocolVersion: text(body.protocolVersion),
      url: text(body.url),
      preferredTransport: text(body.preferredTransport),
      skills: skills.map(skill => text((skill as { name?: unknown })?.name)).filter(Boolean),
      version: text(body.version),
      capabilities: Object.entries(record(body.capabilities))
        .filter(([, value]) => typeof value === 'boolean')
        .map(([name, value]) => `${name}: ${value ? 'yes' : 'no'}`),
      inputModes: texts(body.defaultInputModes),
      outputModes: texts(body.defaultOutputModes),
      skillDetails: skills.map(skill => record(skill)).map(skill => ({
        id: text(skill.id),
        name: text(skill.name),
        description: text(skill.description),
        tags: texts(skill.tags),
      })).filter(skill => skill.name),
      security: cardSecurity(body),
    }, response.status);
  } catch (error) {
    if (signal?.aborted) throw error;
    report(`No Agent Card returned (${error instanceof Error ? error.message : 'request failed'})`);
  }
}

/**
 * Run the chain and report each step through `emit`. Resolves with the final
 * answer; rejects with the reason when any hop is refused or fails.
 */
export async function runChain(options: ChainOptions): Promise<string> {
  const { url, bearer, message, specialist, signal, profile } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const emit: ChainOptions['emit'] = profile
    ? event => {
      const fromLabel = chainLabel(profile, event.from);
      const toLabel = chainLabel(profile, event.to);
      options.emit({ ...event, ...(fromLabel ? { fromLabel } : {}), ...(toLabel ? { toLabel } : {}) });
    }
    : options.emit;
  await discover({ ...options, emit }, fetchImpl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const rpcId = randomUUID();
  const messageId = randomUUID();
  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: rpcId,
    method: 'message/send',
    params: {
      metadata: { delegateTo: specialist },
      message: { role: 'user', messageId, parts: [{ kind: 'text', text: message }] },
    },
  });
  const request = [
    `POST ${url}`,
    'Content-Type: application/json',
    ...(bearer ? [`Authorization: Bearer ${maskKey(bearer)}`] : []),
    '',
    pretty(requestBody),
  ].join('\n');
  emit({
    kind: 'delegate',
    from: MAIN,
    to: MIDDLE,
    text: `${MAIN} → ${MIDDLE}`,
    detail: message,
    request,
    wire: { rpcId, messageId, delegateTo: specialist },
    ...(bearer ? { credential: maskKey(bearer) } : {}),
  });

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
  let body: {
    id?: unknown;
    result?: { kind?: unknown; role?: unknown; messageId?: unknown; parts?: Array<{ text?: unknown }>; metadata?: { hops?: unknown; delegatedTo?: unknown; delegatedBy?: unknown } };
    error?: { code?: unknown; message?: unknown; data?: { hops?: unknown } };
  } | null = null;
  try {
    body = JSON.parse(raw);
  } catch { /* The gateway refuses with plain text. */ }

  if (body?.result && response.ok) {
    const answer = (body.result.parts ?? []).map(part => text(part.text)).filter(Boolean).join('\n').trim();
    emitHops(body.result.metadata?.hops, emit, message, answer);
    emit({
      kind: 'result',
      from: MIDDLE,
      to: MAIN,
      text: `${MIDDLE} returned`,
      detail: answer,
      elapsedMs,
      response: wire,
      wire: {
        status: response.status,
        rpcId: text(body.id),
        messageId: text(body.result.messageId),
        kind: text(body.result.kind),
        role: text(body.result.role),
        delegatedTo: text(body.result.metadata?.delegatedTo),
        delegatedBy: text(body.result.metadata?.delegatedBy),
      },
    });
    return answer;
  }

  // A JSON-RPC error with a hop report came from the middle agent (its own
  // hand-off was refused). Anything else was refused before reaching it.
  const hops = body?.error?.data?.hops;
  emitHops(hops, emit, message);
  const detail = text(body?.error?.message) || raw.trim().slice(0, 200) || `HTTP ${response.status}`;
  if (!Array.isArray(hops) || hops.length === 0) {
    emit({
      kind: 'error',
      from: MAIN,
      to: MIDDLE,
      text: `${MAIN} → ${MIDDLE} refused`,
      detail: `${response.status}: ${detail}`,
      elapsedMs,
      response: wire,
      wire: { status: response.status, ...(typeof body?.error?.code === 'number' ? { errorCode: body.error.code } : {}) },
    });
  }
  throw new Error(detail);
}
