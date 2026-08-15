import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import DashboardShell from './dashboard/DashboardShell';
import StatStrip from './dashboard/StatStrip';
import EventStream from './dashboard/EventStream';

const WINDOWS = ['30m', '1h', '24h', '7d', '14d'];
// 24h, not 1h: exchange traffic is sparse (RFC 8693 telemetry is new), and a
// 1h default would show an empty page most of the time. Same reasoning as
// the P1AZ page.
const DEFAULT_WINDOW = '24h';
const POLL_MS = 30000;

// The six code paths that call _emitTokenExchangeEvent (oauthService.js).
// Fixed so a variant that never fires in this window still renders as 0 —
// its absence is the signal, same as P1AZ's posture strip.
const VARIANTS = [
  { key: 'exchange-as', label: 'exchange-as' },
  { key: 'subject', label: 'subject' },
  { key: 'subject+actor', label: 'subject+actor' },
  { key: 'id-token', label: 'id-token' },
  { key: 'id-token+actor', label: 'id-token+actor' },
  { key: 'dedicated-app', label: 'dedicated-app' },
];

const STREAM_COLUMNS = [
  { key: 'time', label: 'Time', className: 'dash-mono' },
  { key: 'exchangeVariant', label: 'Variant' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'audience', label: 'Audience' },
  { key: 'scope', label: 'Scope' },
  {
    key: 'exchangeClientId',
    label: 'Client',
    className: 'dash-mono',
    // UUIDs overflow a table cell — truncate for display but keep the full
    // value reachable via `title`, and the trailing ellipsis marks it as
    // partial rather than silently passing off a prefix as the whole id.
    render: (row) => (
      row.exchangeClientId
        ? <span title={row.exchangeClientId}>{row.exchangeClientId.slice(0, 8)}…</span>
        : ''
    ),
  },
  { key: 'nestedAct', label: 'Nested act' },
  { key: 'latencyMs', label: 'Latency ms', className: 'dash-mono' },
  { key: 'httpStatus', label: 'Status', className: 'dash-mono' },
  { key: 'pingoneError', label: 'PingOne error' },
];

function Sparkline({ points }) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const step = points.length > 1 ? 540 / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = 40 + i * step;
    const y = 140 - (p.count / max) * 102;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 600 160" className="dash-spark" role="img"
         aria-label={`Token exchange volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none" stroke="var(--dash-accent)"
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="dash-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function TokenExchangeDashboard() {
  const [win, setWin] = useState(DEFAULT_WINDOW);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    try {
      const q = search ? `&q=${encodeURIComponent(search)}` : '';
      const res = await apiClient.get(`/api/newrelic/view/tokenexchange?window=${win}${q}`);
      setData(res.data);
      setState('ready');
    } catch (err) {
      setState(err?.response?.status === 503 ? 'unconfigured' : 'error');
    }
  }, [win, search]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Outcome strip: ok/fail always render (0 is a valid, meaningful reading).
  // Unsettled is derived, not fetched — attempts minus what actually
  // resolved — and only shown when non-zero, in the same warning treatment
  // P1AZ uses for fail-open: it means an exchange started and never came back.
  const outcomeCounts = {};
  (data?.outcomes || []).forEach((r) => { outcomeCounts[r.tag] = r.count; });
  const okCount = outcomeCounts['token-exchange/ok'] || 0;
  const failCount = outcomeCounts['token-exchange/fail'] || 0;
  const attemptsCount = (data?.attempts || [])[0]?.count || 0;
  const unsettledCount = Math.max(0, attemptsCount - (okCount + failCount));

  const outcomeItems = [
    { key: 'ok', label: 'ok', value: okCount },
    { key: 'fail', label: 'fail', value: failCount, tone: failCount > 0 ? 'bad' : 'default' },
  ];
  if (unsettledCount > 0) {
    outcomeItems.push({ key: 'unsettled', label: 'unsettled', value: unsettledCount, tone: 'bad' });
  }

  // Delegation: hasActorToken is present on every row's metadata (request,
  // ok, and fail alike), so this reads the whole nested-`act` story for the
  // window, not just settled exchanges. Keyed via String() — NerdGraph can
  // hand back a facet's boolean as a real boolean or its string form.
  const delegationCounts = {};
  (data?.delegation || []).forEach((r) => { delegationCounts[String(r.hasActorToken)] = r.count; });
  const delegationItems = [
    { key: 'nested-act', label: 'nested act (hasActorToken)', value: delegationCounts.true || 0 },
    { key: 'no-actor-token', label: 'no actor token', value: delegationCounts.false || 0 },
  ];

  const variantCounts = {};
  (data?.variants || []).forEach((r) => { variantCounts[r.exchangeVariant] = r.count; });
  const variantItems = VARIANTS.map((v) => ({
    key: v.key,
    label: v.label,
    value: variantCounts[v.key] || 0,
  }));

  // Audience and exchangeClientId aren't fixed enums (they're runtime
  // config — MCP resource URIs and PingOne app client ids), so unlike the
  // variant/posture strips above these are tallied from the stream rows
  // rather than a fixed list. There is no dedicated NRQL facet for either —
  // the stream query already carries both fields per row, and at current
  // volume (well under its LIMIT 50) that tally is exact for the window.
  function _tally(rows, field) {
    const counts = {};
    rows.forEach((r) => {
      const v = r[field];
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, label: key, value }));
  }
  const streamRows = data?.stream || [];
  const audienceItems = _tally(streamRows, 'audience');
  const clientItems = _tally(streamRows, 'exchangeClientId').map((i) => ({
    ...i,
    label: i.key.length > 12 ? `${i.key.slice(0, 8)}…` : i.key,
  }));

  const okLatencies = streamRows
    .filter((r) => r.tag === 'token-exchange/ok' && typeof r.latencyMs === 'number')
    .map((r) => r.latencyMs);
  const avgLatency = okLatencies.length
    ? Math.round(okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length)
    : 0;
  const maxLatency = okLatencies.length ? Math.max(...okLatencies) : 0;
  const latencyItems = [
    { key: 'avg-latency', label: 'avg ms (ok)', value: avgLatency },
    { key: 'max-latency', label: 'max ms (ok)', value: maxLatency },
  ];

  const rows = streamRows.map((e) => ({
    timestamp: e.timestamp,
    time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
    exchangeVariant: e.exchangeVariant || '',
    outcome: (e.tag || '').replace('token-exchange/', ''),
    audience: e.audience || '',
    scope: e.scope || '',
    exchangeClientId: e.exchangeClientId || '',
    nestedAct: e.hasActorToken === true ? 'yes' : 'no',
    latencyMs: e.latencyMs,
    httpStatus: e.tag === 'token-exchange/fail' ? e.httpStatus : undefined,
    pingoneError: e.tag === 'token-exchange/fail' ? e.pingoneError : undefined,
  }));

  // data?.q — not the local `search` state — is what the server actually
  // applied, so the empty-state message reflects reality even if the
  // client's debounced value hasn't caught up yet. The no-search case says
  // so explicitly rather than defaulting to a bare "no events" line: this
  // telemetry is new (PR #1523) and a wide window will look sparse for a
  // while — that's expected, not a sign anything is broken.
  const appliedSearch = data?.q || '';
  const streamEmptyMessage = appliedSearch
    ? `No exchanges match "${appliedSearch}".`
    : 'No token exchanges in this window. RFC 8693 telemetry is new — wider windows will look partial until more history accumulates.';

  return (
    <DashboardShell
      title="Token Exchange"
      subtitle="RFC 8693 exchanges, from New Relic"
      window={win}
      windows={WINDOWS}
      onWindow={setWin}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search exchanges…"
      onRefresh={load}
      state={state}
      notConfiguredHint={
        <>New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
        <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.</>
      }
    >
      <section className="dash-card">
        <div className="dash-card-head">Outcomes</div>
        <StatStrip items={outcomeItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Delegation (nested act)</div>
        <StatStrip items={delegationItems} />
      </section>

      <div className="dash-grid-2">
        <section className="dash-card">
          <div className="dash-card-head">By audience</div>
          {audienceItems.length
            ? <StatStrip items={audienceItems} />
            : <div className="dash-msg" role="status">No exchanges in this window.</div>}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">By client</div>
          {clientItems.length
            ? <StatStrip items={clientItems} />
            : <div className="dash-msg" role="status">No exchanges in this window.</div>}
        </section>
      </div>

      <section className="dash-card">
        <div className="dash-card-head">Variants</div>
        <StatStrip items={variantItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Latency</div>
        <StatStrip items={latencyItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Volume</div>
        <div className="dash-card-body"><Sparkline points={data?.timeseries || []} /></div>
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Exchange stream</div>
        <EventStream columns={STREAM_COLUMNS} rows={rows} emptyMessage={streamEmptyMessage} />
      </section>
    </DashboardShell>
  );
}
