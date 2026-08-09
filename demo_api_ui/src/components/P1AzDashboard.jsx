import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import DashboardShell from './dashboard/DashboardShell';
import StatStrip from './dashboard/StatStrip';
import EventStream from './dashboard/EventStream';

const WINDOWS = ['30m', '1h', '24h', '7d'];
// 24h, not 1h: authorize decisions are far sparser than pipeline events, and a
// 1h default renders an empty page most of the time.
const DEFAULT_WINDOW = '24h';
const POLL_MS = 30000;

// Fixed so a posture signal that stops appearing still renders as 0 — the
// absence of fail-open is exactly what an operator needs to see.
const POSTURE = [
  { tag: 'authorize/gate-skipped', key: 'gate-skipped', label: 'gate-skipped', tone: 'muted' },
  { tag: 'authorize/policy-not-found', key: 'policy-not-found', label: 'policy-not-found', tone: 'warn' },
  { tag: 'authorize/fail-open', key: 'fail-open', label: 'fail-open', tone: 'bad' },
  { tag: 'authorize/failover', key: 'failover', label: 'failover', tone: 'warn' },
];

const STREAM_COLUMNS = [
  { key: 'time', label: 'Time', className: 'dash-mono' },
  { key: 'decision', label: 'Decision' },
  { key: 'ruleName', label: 'Rule' },
  { key: 'amount', label: 'Amount', className: 'dash-mono' },
  { key: 'type', label: 'Type' },
  { key: 'stepUp', label: 'Step-up' },
  { key: 'latencyMs', label: 'Round trip ms', className: 'dash-mono' },
  { key: 'policyEvalMs', label: 'Policy ms', className: 'dash-mono' },
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
         aria-label={`Authorize volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none" stroke="var(--dash-accent)"
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="dash-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function P1AzDashboard() {
  const [win, setWin] = useState(DEFAULT_WINDOW);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/newrelic/view/authorize?window=${win}`);
      setData(res.data);
      setState('ready');
    } catch (err) {
      setState(err?.response?.status === 503 ? 'unconfigured' : 'error');
    }
  }, [win]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const decisionCounts = {};
  (data?.decisions || []).forEach((r) => { decisionCounts[r.decision] = r.count; });
  const decisionItems = ['PERMIT', 'DENY'].map((d) => ({
    key: d,
    label: d,
    value: decisionCounts[d] || 0,
    tone: d === 'DENY' ? 'bad' : 'default',
  }));

  const postureCounts = {};
  (data?.posture || []).forEach((r) => { postureCounts[r.tag] = r.count; });
  const postureItems = POSTURE.map((p) => ({
    key: p.key,
    label: p.label,
    value: postureCounts[p.tag] || 0,
    tone: (postureCounts[p.tag] || 0) > 0 ? p.tone : 'default',
  }));

  // ruleName is null on events emitted before Task 2 shipped — label rather
  // than hide, so an older window reads honestly instead of looking empty.
  const ruleItems = (data?.rules || []).slice(0, 6).map((r) => ({
    key: r.ruleName || 'unattributed',
    label: r.ruleName || 'unattributed',
    value: r.count,
    tone: /den/i.test(r.ruleName || '') ? 'bad' : 'default',
  }));

  const rows = (data?.stream || []).map((e) => ({
    timestamp: e.timestamp,
    time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
    decision: e.decision || '',
    ruleName: e.ruleName || '—',
    amount: e.amount,
    type: e.type || '',
    stepUp: e.stepUpRequired === true ? 'yes' : 'no',
    latencyMs: e.latencyMs,
    policyEvalMs: e.policyEvalMs,
  }));

  return (
    <DashboardShell
      title="PingOne Authorize"
      subtitle="Decisions and gate posture, from New Relic"
      window={win}
      windows={WINDOWS}
      onWindow={setWin}
      onRefresh={load}
      state={state}
      notConfiguredHint={
        <>New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
        <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.</>
      }
    >
      <section className="dash-card">
        <div className="dash-card-head">Decisions</div>
        <StatStrip items={decisionItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Gate posture</div>
        <StatStrip items={postureItems} />
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Top rules</div>
        {ruleItems.length
          ? <StatStrip items={ruleItems} />
          : <div className="dash-msg" role="status">No rule attribution in this window.</div>}
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Volume</div>
        <div className="dash-card-body"><Sparkline points={data?.timeseries || []} /></div>
      </section>

      <section className="dash-card">
        <div className="dash-card-head">Recent decisions</div>
        <EventStream columns={STREAM_COLUMNS} rows={rows} />
      </section>
    </DashboardShell>
  );
}
