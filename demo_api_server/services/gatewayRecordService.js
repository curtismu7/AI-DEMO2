'use strict';

// The Agent Privilege's own record of one run, read straight from the OpenSearch the gateway ships its lines to.
//
// The log-tailer beside the gateway posts a line per guardrail verdict, model call, accepted A2A request and
// refusal to the `gateway-events` index. Reading it through the gateway's OpenSearch door needs a person to sign
// in to that door (its auth server has no client-credentials grant), so this reads the index server-side instead,
// read-only, and hands the browser only the fields the page shows. The shipper has already cut the working key
// down to a prefix; the allow-list below also drops it.

const DEFAULT_URL = 'http://opensearch.ping-devops-curtismuir.svc.cluster.local:9200';
const INDEX = 'gateway-events';
const MAX_WINDOW_MS = 60 * 60 * 1000;
const MAX_HITS = 100;
const TIMEOUT_MS = Number(process.env.GATEWAY_EVENTS_TIMEOUT_MS) || 5000;

// The kinds of line the page shows, and the fields of each it reads. Anything else is left behind.
const KINDS = ['AIGuard', 'LLM request', 'Received HTTP request', 'A2A policy denied'];
const FIELDS = [
  'msg', 'time', 'RequestTS',
  'Event', 'Category', 'Direction', 'Client', 'KeyType', 'ElapsedMs', 'ComplianceMappings',
  'Provider', 'Model', 'HTTPStatus', 'PromptTokens', 'CompletionTokens', 'TotalTokens', 'CostUSD', 'LatencyMs',
  'Domain', 'Method', 'Path', 'User', 'Tenant',
  'Principal', 'App', 'Reason',
];

function baseUrl() {
  return (process.env.GATEWAY_EVENTS_URL || DEFAULT_URL).replace(/\/+$/, '');
}

/** The window as epoch ms, or null when it is not two finite numbers in order and within an hour. */
function parseWindow(since, until) {
  const from = Number(since);
  const to = Number(until);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < from) return null;
  if (to - from > MAX_WINDOW_MS) return null;
  return { from, to };
}

function allowed(source) {
  const out = {};
  for (const field of FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  // Only the shape the page reads from the mappings.
  if (Array.isArray(out.ComplianceMappings)) {
    out.ComplianceMappings = out.ComplianceMappings.map((m) => ({ Framework: m?.Framework, Identifier: m?.Identifier, Source: m?.Source }));
  }
  return out;
}

/**
 * The gateway's lines between two instants (epoch ms), oldest first.
 * Resolves `{ ok: true, hits, tookMs }` or `{ ok: false, status, error }`. Never rejects.
 */
async function readGatewayRecord({ since, until, fetchImpl = fetch } = {}) {
  const window = parseWindow(since, until);
  if (!window) return { ok: false, status: 400, error: 'since and until must be epoch milliseconds, in order, at most an hour apart' };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl()}/${INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query: {
          bool: {
            filter: [
              { range: { time: { gte: new Date(window.from).toISOString(), lte: new Date(window.to).toISOString() } } },
              { terms: { 'msg.keyword': KINDS } },
            ],
          },
        },
        sort: [{ time: { order: 'asc' } }],
        size: MAX_HITS,
        _source: FIELDS,
      }),
    });
    if (!res.ok) return { ok: false, status: 502, error: `the gateway's event store answered HTTP ${res.status}` };
    const body = await res.json();
    const hits = (body?.hits?.hits || []).map((hit) => allowed(hit?._source || {}));
    return { ok: true, hits, tookMs: Date.now() - started };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return { ok: false, status: 503, error: timedOut ? 'the gateway\'s event store did not answer in time' : 'the gateway\'s event store is not reachable from this server' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readGatewayRecord, parseWindow, allowed, KINDS, FIELDS, MAX_WINDOW_MS, MAX_HITS };
