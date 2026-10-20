/**
 * Shared call model for the MCP / PingOne Authorize / Agent Gateway inspectors.
 * Pure functions only: no React, no DOM.
 *
 * @typedef {{ tone: 'ok'|'warn'|'err'|'idle', label: string }} Chip
 * @typedef {{ label: string, where?: string, body: any }} Payload
 * @typedef {{ label: string, role: string, alg: string|null, rfc: string|null, status: Chip,
 *   claims: object, hidden: string[], header: object|null, raw?: string, diff?: Record<string,string> }} TokenView
 * @typedef {{ dir: string, call: string, what: string, status: Chip, ms: number|null,
 *   request: any, response: any }} Hop
 * @typedef {{ status: Chip, title: string, text: string, tag?: string, kv?: [string,string][],
 *   policyTree?: { policies: any[], result: object } }} Step
 * @typedef {{ id: string, at: number, kind: string, title: string, src: 'you'|'agent'|'log', ms: number|null,
 *   status: Chip, chips: Chip[],
 *   banner: null | { tone: string, title: string, text: string, testId?: string, actions?: {label: string, onClick: Function}[] },
 *   corr: string|null, request: Payload, response: Payload, tokens: TokenView[], hops: Hop[], steps: Step[],
 *   audit?: Record<'Who'|'What'|'When'|'Where'|'Why'|'How', [string,string][]>, logs?: string[], input?: object }} InspectorCall
 */
import { deepParse } from '../shared/JsonHighlight.jsx';

export const ok = (label) => ({ tone: 'ok', label });
export const warn = (label) => ({ tone: 'warn', label });
export const err = (label) => ({ tone: 'err', label });
export const idle = (label) => ({ tone: 'idle', label });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const b64urlJson = (seg) => {
  const bin = atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};
/** Client-side, unverified JWT decode. @returns {{header: object|null, claims: object}|null} */
export function decodeJwtClient(token) {
  try {
    const [h, p] = token.split('.');
    const claims = b64urlJson(p);
    if (!isObj(claims)) return null;
    let header = null;
    try { const hd = b64urlJson(h); if (isObj(hd)) header = hd; } catch { /* header optional */ }
    return { header, claims };
  } catch { return null; }
}

export const SRC_LABEL = { you: 'You', agent: 'AI agent', log: 'PingOne log' };

const words = (s) => String(s).split(/\s+/).filter(Boolean);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** @returns {Record<string,string>} claim name -> added|removed|changed|narrowed */
export function diffClaims(before = {}, after = {}) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (!(k in before)) { out[k] = 'added'; continue; }
    const b = before[k];
    const a = after[k];
    if (Array.isArray(b) && Array.isArray(a)) {
      if (!sameSet(b.map(String), a.map(String))) out[k] = 'changed';
    } else if (k === 'scope' && typeof b === 'string' && typeof a === 'string') {
      const bw = words(b);
      const aw = words(a);
      if (sameSet(bw, aw)) continue;
      out[k] = aw.length < bw.length && aw.every((w) => bw.includes(w)) ? 'narrowed' : 'changed';
    } else if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = 'changed';
  }
  for (const k of Object.keys(before)) if (!(k in after)) out[k] = 'removed';
  return out;
}

const STATUS_CHIPS = {
  active: ok('Valid'),
  exchanged: ok('Exchanged'),
  warning: warn('Warning'),
  failed: err('Failed'),
  skipped: idle('skipped'),
};

export function tokenStatusChip(status) {
  const c = STATUS_CHIPS[status];
  return c ? { ...c } : idle(String(status ?? 'unknown'));
}

/** @returns {TokenView[]} */
export function tokensFromEvents(events) {
  const evs = Array.isArray(events) ? events : [];
  const user = evs.find((e) => e.id === 'user-token');
  return evs
    .filter((e) => e.claims && Object.keys(e.claims).length > 0)
    .map((e) => {
      const view = {
        label: e.label,
        role: e.explanation ?? '',
        alg: e.alg ?? null,
        rfc: e.rfc ?? null,
        status: tokenStatusChip(e.status),
        claims: e.claims,
        hidden: e.hiddenClaims ?? [],
        header: e.jwtFullDecode?.header ?? null,
      };
      if (e.raw) view.raw = e.raw;
      if (e.id === 'exchanged-token' && user?.claims) view.diff = diffClaims(user.claims, e.claims);
      return view;
    });
}

/** @returns {Step[]} */
export function stepsFromTokenEvents(events) {
  return (Array.isArray(events) ? events : []).map((e) => ({
    title: e.label,
    status: tokenStatusChip(e.status),
    text: e.explanation ?? '',
    tag: e.rfc,
  }));
}

export const isProblem = (call) => call?.status?.tone === 'warn' || call?.status?.tone === 'err';

function leaves(v, path, out) {
  if (v && typeof v === 'object') {
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
    if (keys.length) { keys.forEach((k) => leaves(v[k], path ? `${path}.${k}` : String(k), out)); return; }
  }
  if (path) out.set(path, JSON.stringify(v));
}

/** Leaf paths whose values differ; values are JSON strings, undefined when absent. */
export function diffPaths(a, b) {
  const ma = new Map();
  const mb = new Map();
  leaves(deepParse(a), '', ma);
  leaves(deepParse(b), '', mb);
  const out = [];
  for (const p of new Set([...ma.keys(), ...mb.keys()])) {
    if (ma.get(p) !== mb.get(p)) out.push({ path: p, a: ma.get(p), b: mb.get(p) });
  }
  return out;
}

const GROUPS = {
  client: { label: 'Caller', bg: 'var(--th-status-info)' },
  bff: { label: 'BFF', bg: 'var(--th-bg-emphasis)' },
  pingone: { label: 'PingOne', bg: 'var(--th-status-warning)' },
  authorize: { label: 'PingOne Authorize', bg: '#7c3aed' },
  gateway: { label: 'Agent Gateway', bg: '#d20e0f' },
  mcp: { label: 'MCP server', bg: 'var(--th-status-success)' },
};

const groupOf = (n) =>
  /Browser|AI agent/.test(n) ? 'client'
    : /BFF/.test(n) ? 'bff'
      : /PingOne Authorize/.test(n) ? 'authorize'
        : /PingOne/.test(n) ? 'pingone'
          : /Gateway/.test(n) ? 'gateway' : 'mcp';

const EDGE_OPTS = {
  ok: { color: 'var(--th-status-success)' },
  err: { color: 'var(--th-status-error)' },
  warn: { color: 'var(--th-status-warning)' },
  idle: { dashed: true },
};

/** Build a StaticFlowDiagram config from a call's hops. */
export function diagramConfigFromCall(call, nodeSubs = {}) {
  const hops = call?.hops ?? [];
  const pairs = hops.map((h) => h.dir.split('→').map((s) => s.trim()));
  const names = [];
  for (const [s, t] of pairs) for (const n of [s, t]) if (!names.includes(n)) names.push(n);

  const level = new Map(names.length ? [[names[0], 0]] : []);
  for (let q = [names[0]]; q.length;) {
    const cur = q.shift();
    for (const [s, t] of pairs) {
      if (s === cur && !level.has(t)) { level.set(t, level.get(cur) + 1); q.push(t); }
    }
  }
  const byLevel = new Map();
  for (const n of names) {
    const l = level.get(n) ?? 1;
    byLevel.set(l, [...(byLevel.get(l) ?? []), n]);
  }
  const maxSize = Math.max(0, ...[...byLevel.values()].map((v) => v.length));

  const NODES = names.map((id) => {
    const l = level.get(id) ?? 1;
    const peers = byLevel.get(l);
    const node = {
      id,
      group: groupOf(id),
      label: id,
      x: l * 300,
      y: peers.indexOf(id) * 130 + (maxSize - peers.length) * 65,
    };
    if (nodeSubs[id]) node.sub = nodeSubs[id];
    return node;
  });
  const EDGES = hops.map((h, i) => [pairs[i][0], pairs[i][1], `${i + 1}. ${h.call}`, EDGE_OPTS[h.status?.tone] ?? EDGE_OPTS.idle]);
  const STEPS = hops.map((h, i) => ({ key: 'h' + i, edges: [i], title: h.dir + ': ' + h.call, what: h.what }));
  return { GROUPS, NODES, EDGES, STEPS };
}
