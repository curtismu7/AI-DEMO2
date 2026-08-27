import React, { useCallback, useEffect, useMemo, useState } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import apiClient from '../services/apiClient';
import '../components/shared/InspectorShell.css';

/**
 * Agent Registry — one view over the identity stores that already hold real
 * data: PingOne applications, demo-issued workload clients, and A2A specialists.
 *
 * Nothing here is fabricated and nothing is cached: every row is read live by
 * GET /api/registry/agents, so the page cannot show a stale registry.
 *
 * Two things make it a registry rather than a list, and both are surfaced:
 *  - SCOPE DRIFT, expected (scope-topology, the SSOT) vs actually granted.
 *  - PER-SOURCE degradation. PingOne is a live HTTP call; when it is down the
 *    page shows the other identities and names the failure, rather than
 *    blanking or implying those identities do not exist.
 */

const TYPE_LABELS = {
  agent: 'Agents',
  workload: 'Workload identities',
  service: 'Services',
  external: 'External clients',
};

const TABS = [
  { key: 'scopes', label: 'Scopes' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'raw', label: 'Raw' },
];

export default function AgentRegistryPage() {
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('scopes');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/api/registry/agents');
      setRegistry(data);
    } catch (err) {
      setError(err?.response?.data?.error || 'registry_unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = registry?.rows || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${r.id}`.toLowerCase().includes(q));
  }, [rows, query]);

  const grouped = useMemo(() => {
    const out = {};
    for (const r of filtered) {
      const k = r.identityType || 'agent';
      (out[k] = out[k] || []).push(r);
    }
    return out;
  }, [filtered]);

  const selected = rows.find((r) => r.id === selectedId) || null;
  const driftCount = rows.filter((r) => r.scopeDrift).length;

  // A source that is down is reported, never hidden — a blank section would
  // read as "no such identities" rather than "we could not ask".
  const downSources = Object.entries(registry?.sources || {})
    .filter(([, s]) => s.up === false)
    .map(([name, s]) => ({ name, error: s.error }));

  const left = (
    <>
      <div className="inspector-shell-tree-header">Identities ({rows.length})</div>
      <div className="inspector-shell-tree-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or id"
          aria-label="Filter identities"
        />
      </div>
      <div className="inspector-shell-tree-body">
        {Object.keys(grouped).sort().map((type) => (
          <div key={type}>
            <div className="inspector-shell-tree-group__label">
              {TYPE_LABELS[type] || type} ({grouped[type].length})
            </div>
            {grouped[type].map((r) => (
              <InspectorListItem
                key={r.id}
                label={r.name || r.id}
                active={r.id === selectedId}
                badges={r.scopeDrift ? ['sensitive'] : []}
                onClick={() => setSelectedId(r.id)}
              />
            ))}
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="inspector-shell-form-empty">No identities returned.</div>
        )}
      </div>
    </>
  );

  const middle = selected ? (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{selected.name || selected.id}</div>
        <div className="inspector-shell-form-header__desc">
          {TYPE_LABELS[selected.identityType] || selected.identityType} &middot; {selected.source}
        </div>
      </div>
      <div className="inspector-shell-form-body">
        <div className="inspector-shell-field">
          <label>Identifier</label>
          <div>{selected.id}</div>
        </div>
        <div className="inspector-shell-field">
          <label>Credential type</label>
          <div>{selected.credentialType || '—'}</div>
        </div>
        <div className="inspector-shell-field">
          <label>Status</label>
          <div>{selected.status || '—'}</div>
        </div>
        {selected.lastUsed !== undefined && (
          <div className="inspector-shell-field">
            <label>Last used</label>
            <div>{selected.lastUsed || 'never'}</div>
          </div>
        )}
      </div>
    </>
  ) : (
    <div className="inspector-shell-form-empty">Select an identity to see its detail.</div>
  );

  const right = (
    <>
      <InspectorTabs tabs={TABS} activeKey={tab} onChange={setTab} />
      <div className="inspector-shell-output-body">
        {!selected && <div className="inspector-shell-output-empty">Nothing selected.</div>}

        {selected && tab === 'scopes' && (
          <div>
            {selected.scopeDrift ? (
              <p className="inspector-shell-form-error">
                ⚠️ Scope drift — granted does not match what scope-topology declares.
                Missing: {(selected.missingScopes || []).join(', ')}
              </p>
            ) : (
              <p>✅ Granted scopes match the topology declaration.</p>
            )}
            <div className="inspector-shell-field">
              <label>Granted</label>
              <div>{(selected.grantedScopes || []).join(', ') || '—'}</div>
            </div>
            <div className="inspector-shell-field">
              <label>Expected (scope-topology)</label>
              <div>{(selected.expectedScopes || []).join(', ') || '—'}</div>
            </div>
          </div>
        )}

        {selected && tab === 'lifecycle' && (
          (selected.lifecycle || []).length === 0
            ? <div className="inspector-shell-output-empty">No lifecycle events recorded.</div>
            : <ul>{selected.lifecycle.map((e, i) => (
                <li key={e.eventId || i}>{e.timestamp} — {e.eventType} {e.reason ? `(${e.reason})` : ''}</li>
              ))}</ul>
        )}

        {selected && tab === 'raw' && (
          <pre className="inspector-shell-output-code">{JSON.stringify(selected, null, 2)}</pre>
        )}
      </div>
    </>
  );

  const banner = downSources.length > 0 ? (
    <div className="inspector-shell-form-error">
      ⚠️ {downSources.length} source unavailable — showing the rest.{' '}
      {downSources.map((s) => `${s.name}: ${s.error}`).join(' · ')}
    </div>
  ) : null;

  return (
    <InspectorShell
      title="Agent Registry"
      statusOn={!error && downSources.length === 0}
      statusText={
        error ? 'registry unavailable'
          : loading ? 'loading'
          : `${rows.length} identities · ${driftCount} with scope drift`
      }
      banner={banner}
      actions={
        <button type="button" className="inspector-shell-topbar__btn" onClick={load} disabled={loading}>
          Refresh
        </button>
      }
      left={left}
      middle={middle}
      right={right}
    />
  );
}
