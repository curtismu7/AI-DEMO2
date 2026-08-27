import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../services/apiClient';
import './ControlPlanePage.css';

/**
 * Agentic Control Plane — the five zones of the reference architecture, read
 * live from GET /api/control-plane/overview. Nothing here is fabricated and
 * nothing is cached.
 *
 * Two views. Landscape is the board; Triage is what is actually wrong. The
 * "needs attention" count and the triage list are the SAME array, so they
 * cannot disagree — which is why the KPI is itself the button into triage.
 */

const SEVERITY_ORDER = { critical: 0, advisory: 1, structural: 2 };
const SEVERITY_LABEL = { critical: 'critical', advisory: 'advisory', structural: 'structural' };

// A finding's domain routes to the page where it is actionable. A domain with
// no mapping renders no action rather than a dead link.
const DOMAIN_ROUTE = {
  governance: { label: 'Kill-switch roster', href: '/ai-control-plane' },
  registry: { label: 'Open registry', href: '/agent-registry' },
  discovery: { label: 'Platform gaps', href: '/platform-gaps' },
  observability: { label: 'Grafana', href: '/grafana' },
};

// Compact, readable evidence — not a JSON dump. Arrays join and truncate so a
// long list can't flood the row.
function formatEvidence(evidence) {
  const entries = Object.entries(evidence || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => {
    if (Array.isArray(v)) {
      const shown = v.slice(0, 5).join(', ');
      return `${k}: ${shown}${v.length > 5 ? `, +${v.length - 5} more` : ''}`;
    }
    return `${k}: ${v}`;
  }).join(' · ');
}

// A zone's dot reflects what its source actually reported, never a hardcoded
// "everything is fine". `down` is the only state that changes the color —
// `structural`/`not-wired` read as the existing neutral gap dot.
function dotClass(state) {
  if (state === 'down') return 'cp-dot--crit';
  if (state === 'structural' || state === 'not-wired') return 'cp-dot--gap';
  return 'cp-dot--ok';
}

export default function ControlPlanePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('landscape');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/api/control-plane/overview');
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'overview_unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const findings = useMemo(
    () => [...(data?.findings || [])].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    ),
    [data],
  );
  const declared = data?.declared || [];
  const downSources = Object.entries(data?.sources || {})
    .filter(([, s]) => s.state === 'down')
    .map(([name, s]) => ({ name, error: s.error }));

  const zones = data?.zones || {};
  const catalog = zones.catalog || { services: 0, mcpServers: 0, items: [], links: [] };
  const registry = zones.registry || { total: 0, bySource: {}, byType: {}, revoked: 0, drift: 0, unverified: 0, links: [] };
  const discovery = zones.discovery || { surfaces: [], wired: 0 };
  const governance = zones.governance || { totalEvents: 0, byEventType: {}, recent: [], links: [] };
  const observability = zones.observability || { backends: [], links: [] };
  const enforcement = data?.enforcement || [];

  const registrySourceCount = Object.keys(registry.bySource).length;
  const verifiedCount = Math.max(0, registry.total - registry.unverified);
  const critCount = findings.filter((f) => f.severity === 'critical').length;
  const advisoryCount = findings.filter((f) => f.severity === 'advisory').length;

  const sources = data?.sources || {};
  const catalogDown = sources.catalog?.state === 'down';
  const registryDown = sources.registry?.state === 'down';
  const governanceDown = sources.lifecycle?.state === 'down';

  if (loading && !data) {
    return <div className="cp-page cp-page--loading">Loading control plane…</div>;
  }

  if (error && !data) {
    return (
      <div className="cp-page">
        <p className="cp-fatal">⚠️ control plane unavailable — {error}</p>
      </div>
    );
  }

  return (
    <div className="cp-page">
      <header className="cp-topbar">
        <div className="cp-brand">
          <span className="cp-brand__mark" />
          <span className="cp-brand__name">Agentic Control Plane</span>
          <span className="cp-brand__sub">Visibility across the agent landscape</span>
        </div>
        <span className="cp-topbar__ts" data-testid="generated-at">
          {data?.generatedAt ? `Generated ${new Date(data.generatedAt).toLocaleString()}` : ''}
        </span>
        <button type="button" className="cp-btn" onClick={load} disabled={loading}>Refresh</button>
      </header>

      <div className="cp-viewbar" role="tablist" aria-label="Control plane views">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'landscape'}
          className="cp-viewtab"
          onClick={() => setView('landscape')}
        >
          Landscape
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'triage'}
          className="cp-viewtab"
          onClick={() => setView('triage')}
        >
          Triage <span className="cp-viewtab__badge">{findings.length}</span>
        </button>
      </div>

      {error && data && (
        <p className="cp-banner" data-testid="refresh-error-banner">
          ⚠️ Refresh failed — {error}. Showing the last successful load{data.generatedAt
            ? ` (generated ${new Date(data.generatedAt).toLocaleString()})` : ''}.
        </p>
      )}

      {downSources.length > 0 && (
        <p className="cp-banner">
          ⚠️ {downSources.map((s) => `${s.name}: ${s.error || 'unavailable'}`).join(' · ')} — showing the rest.
        </p>
      )}

      {view === 'landscape' ? (
        <section role="tabpanel" aria-label="Landscape">
          <div className="cp-head">
            <h1>Landscape</h1>
            <p>Every non-human identity this environment issues, governs, or observes — read live from the
              stores that already hold it. Nothing here is cached, so the view cannot go stale.</p>
          </div>

          <section className="cp-kpis" aria-label="Summary">
            <div className="cp-kpi" data-testid="kpi-identities">
              <div className="cp-kpi__label">Identities</div>
              <div className="cp-kpi__val">{registryDown ? '—' : registry.total}</div>
              <div className="cp-kpi__note">
                {registryDown
                  ? 'registry source is down — could not ask'
                  : `across ${registrySourceCount} identity source${registrySourceCount === 1 ? '' : 's'}`}
              </div>
            </div>
            <button
              type="button"
              className="cp-kpi cp-kpi--attention"
              data-testid="kpi-attention"
              onClick={() => setView('triage')}
            >
              <div className="cp-kpi__label">Needs attention <span className="cp-kpi__go">→</span></div>
              <div className="cp-kpi__val" data-testid="kpi-attention-value">{findings.length}</div>
              <div className="cp-kpi__note">{critCount} critical · {advisoryCount} advisory · {declared.length} structural</div>
            </button>
            <div className="cp-kpi">
              <div className="cp-kpi__label">Scope drift</div>
              <div className="cp-kpi__val">{registry.drift}<span className="cp-kpi__unit">/ {verifiedCount}</span></div>
              <div className="cp-kpi__note">
                {verifiedCount === 0
                  ? 'nothing verified — no declared expectation'
                  : registry.drift > 0
                    ? `${registry.drift} of ${verifiedCount} drifting from scope-topology`
                    : 'granted matches scope-topology'}
              </div>
            </div>
            <div className="cp-kpi">
              <div className="cp-kpi__label">Lifecycle events</div>
              <div className="cp-kpi__val">{governanceDown ? '—' : governance.totalEvents}</div>
              <div className="cp-kpi__note">
                {governanceDown
                  ? 'lifecycle source is down — could not ask'
                  : governance.recent && governance.recent.length > 0
                    ? `most recent: ${governance.recent[0].eventType || governance.recent[0].timestamp || ''}`
                    : 'none recorded'}
              </div>
            </div>
          </section>

          <div className="cp-zones">
            <section className="cp-zone">
              <div className="cp-zone__head">
                <span className={`cp-dot ${dotClass(catalogDown ? 'down' : 'live')}`} />
                <span className="cp-zone__title">Agent / MCP Catalog</span>
                {catalogDown
                  ? <span className="cp-zone__count cp-zone__count--down">could not ask</span>
                  : <span className="cp-zone__count">{catalog.services} services</span>}
              </div>
              <div className="cp-zone__body">
                {catalogDown ? (
                  <p className="cp-stat__cap">Catalog source is down — could not ask.</p>
                ) : (
                  <>
                    <div className="cp-stat">
                      <span className="cp-stat__big">{catalog.mcpServers}</span>
                      <span className="cp-stat__cap">MCP servers registered</span>
                    </div>
                    <ul className="cp-mini">
                      {catalog.items.map((it) => (
                        <li key={it.key}>
                          <span className="cp-mini__name">{it.name}</span>
                          <span className="cp-mini__meta">{it.lang}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {catalog.links.length > 0 && (
                <div className="cp-zone__foot">
                  {catalog.links.map((l) => (
                    <a key={l.href} className="cp-link" href={l.href}>{l.label} →</a>
                  ))}
                </div>
              )}
            </section>

            <section className="cp-zone cp-zone--wide">
              <div className="cp-zone__head">
                <span className={`cp-dot ${dotClass(registryDown ? 'down' : 'live')}`} />
                <span className="cp-zone__title">Agent Registry</span>
                {registryDown
                  ? <span className="cp-zone__count cp-zone__count--down">could not ask</span>
                  : <span className="cp-zone__count">{registry.total} identities · {registrySourceCount} sources</span>}
              </div>
              <div className="cp-zone__body">
                <ul className="cp-legend">
                  {Object.entries(registry.bySource).map(([name, count]) => (
                    <li key={name} className="cp-legend__row">
                      <span className="cp-legend__name">{name}</span>
                      <span className="cp-legend__num">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="cp-zone__foot">
                {registry.links.map((l) => (
                  <a key={l.href} className="cp-link" href={l.href}>{l.label} →</a>
                ))}
                <span className="cp-foot-note">
                  {registryDown ? 'could not ask' : `${registry.revoked} revoked · ${registry.unverified} unverified`}
                </span>
              </div>
            </section>

            <section className="cp-zone">
              <div className="cp-zone__head">
                <span className="cp-dot cp-dot--gap" />
                <span className="cp-zone__title">Agent Discovery</span>
                <span className="cp-zone__count">{discovery.wired} of {discovery.surfaces.length} surfaces</span>
              </div>
              <div className="cp-zone__body">
                <div className="cp-gapstate">
                  {discovery.surfaces.map((surface) => (
                    <div key={surface} className="cp-gapstate__row">
                      {surface} <span className="cp-pill cp-pill--gap">no source</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="cp-zone">
              <div className="cp-zone__head">
                <span className={`cp-dot ${dotClass(governanceDown ? 'down' : 'live')}`} />
                <span className="cp-zone__title">Agent Governance</span>
                {governanceDown
                  ? <span className="cp-zone__count cp-zone__count--down">could not ask</span>
                  : <span className="cp-zone__count">{governance.totalEvents} events</span>}
              </div>
              <div className="cp-zone__body">
                <ul className="cp-legend">
                  {Object.entries(governance.byEventType).map(([type, count]) => (
                    <li key={type} className="cp-legend__row">
                      <span className="cp-legend__name">{type}</span>
                      <span className="cp-legend__num">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {governance.links.length > 0 && (
                <div className="cp-zone__foot">
                  {governance.links.map((l) => (
                    <a key={l.href} className="cp-link" href={l.href}>{l.label} →</a>
                  ))}
                </div>
              )}
            </section>

            <section className="cp-zone cp-zone--wide">
              <div className="cp-zone__head">
                <span className="cp-dot cp-dot--ok" />
                <span className="cp-zone__title">Agent Observability</span>
                <span className="cp-zone__count">{observability.backends.length} backends</span>
              </div>
              <div className="cp-zone__body">
                <ul className="cp-mini">
                  {observability.backends.map((b) => (
                    <li key={b.name}>
                      {/* The NAME is the link. A backend with no declared browser
                          URL stays plain text rather than becoming a link that
                          cannot work. */}
                      {b.href ? (
                        <a
                          className="cp-mini__name cp-mini__name--link"
                          href={b.href}
                          {...(b.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        >
                          {b.name}
                        </a>
                      ) : (
                        <span className="cp-mini__name">{b.name}</span>
                      )}
                      <span className="cp-mini__meta">{b.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {observability.links.length > 0 && (
                <div className="cp-zone__foot">
                  {observability.links.map((l) => (
                    <a key={l.href} className="cp-link" href={l.href}>{l.label} →</a>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="cp-enforcement" aria-label="Enforcement">
            <h2 className="cp-enforcement__title">Enforcement</h2>
            <div className="cp-enforcement__row">
              {enforcement.map((e) => (
                <div key={e.id} className="cp-enforcement__card">
                  {/* The card NAME is the link to where that data lives today —
                      "Today →" named nothing and gave the reader no idea where
                      it would land. */}
                  <a className="cp-enforcement__name cp-enforcement__name--link" href={e.today}>
                    {e.name}
                  </a>
                  <div className="cp-enforcement__will">Will show: {e.willShow}</div>
                  <div className="cp-enforcement__today">
                    Today: <a className="cp-link" href={e.today}>{e.todayLabel || e.today} →</a>
                  </div>
                  <span className={`cp-pill ${e.state === 'not-wired' ? 'cp-pill--gap' : 'cp-pill--ok'}`}>
                    {e.state === 'not-wired' ? 'not wired' : e.state}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : (
        <section role="tabpanel" aria-label="Triage">
          <div className="cp-head">
            <h1>Triage</h1>
            <p>What is actually wrong, worst first.</p>
          </div>

          <div className="cp-counters">
            <div className="cp-counter"><span className="cp-counter__n cp-counter__n--crit">{critCount}</span><span className="cp-counter__l">critical</span></div>
            <div className="cp-counter"><span className="cp-counter__n cp-counter__n--warn">{advisoryCount}</span><span className="cp-counter__l">advisory</span></div>
            <div className="cp-counter"><span className="cp-counter__n cp-counter__n--gap">{declared.length}</span><span className="cp-counter__l">structural gap{declared.length === 1 ? '' : 's'}</span></div>
          </div>

          <section className="cp-queue" aria-label="Triage queue">
            {findings.map((f) => {
              const evidenceText = formatEvidence(f.evidence);
              const action = DOMAIN_ROUTE[f.domain];
              return (
                <article key={f.id} className={`cp-item cp-item--${f.severity === 'critical' ? 'crit' : 'warn'}`}>
                  <div className="cp-item__stripe" />
                  <div className="cp-item__main">
                    <div className="cp-item__top">
                      <span className={`cp-pill cp-pill--${f.severity === 'critical' ? 'crit' : 'warn'}`}>{SEVERITY_LABEL[f.severity]}</span>
                      <span className="cp-pill cp-pill--domain">{f.domain}</span>
                      <span className="cp-item__title" data-testid="finding-title">{f.title}</span>
                    </div>
                    <p className="cp-item__body">{f.detail}</p>
                    {evidenceText && <p className="cp-item__evidence" data-testid="finding-evidence">{evidenceText}</p>}
                  </div>
                  {action && (
                    <div className="cp-item__action">
                      <a className="cp-link" href={action.href}>{action.label} →</a>
                    </div>
                  )}
                </article>
              );
            })}
            {declared.map((d) => (
              <article key={d.id} className="cp-item cp-item--gap">
                <div className="cp-item__stripe" />
                <div className="cp-item__main">
                  <div className="cp-item__top">
                    <span className="cp-pill cp-pill--gap">structural</span>
                    <span className="cp-pill cp-pill--domain">{d.domain}</span>
                    <span className="cp-item__title">{d.title}</span>
                  </div>
                  <p className="cp-item__body">{d.detail}</p>
                </div>
              </article>
            ))}
          </section>
        </section>
      )}
    </div>
  );
}
