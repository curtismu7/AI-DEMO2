import React, { useCallback, useEffect, useState } from 'react';
import AdminSubPageShell from './AdminSubPageShell';
import SignInPrompt from './SignInPrompt';
import '../styles/appShellPages.css';
import './ScopeReferencePage.css';

/**
 * ScopeReferencePage — Live PingOne resource & scope reference.
 *
 * Pulls the real resource servers and their scopes from the PingOne
 * Management API (via the BFF scope-audit endpoint) and renders them
 * as a per-resource reference table. The canonical SCOPE_VOCABULARY.md
 * document remains available in a collapsible section below.
 */
export default function ScopeReferencePage() {
  const [resources, setResources] = useState([]);
  const [envInfo, setEnvInfo] = useState({ environment: '', region: '' });
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const [liveRes, vocabRes] = await Promise.all([
        fetch('/api/admin/scope-audit/resources', { credentials: 'include' }),
        fetch('/api/admin/config/scope-vocabulary', { credentials: 'include' }),
      ]);
      const liveData = await liveRes.json();
      if (liveRes.status === 401 || liveRes.status === 403) {
        setNeedsSignIn(true);
        throw new Error(liveData.error || `HTTP ${liveRes.status}`);
      }
      if (!liveRes.ok) throw new Error(liveData.error || `HTTP ${liveRes.status}`);
      setResources(liveData.resources || []);
      setEnvInfo({ environment: liveData.environment, region: liveData.region });
      // Vocabulary doc is supplementary — don't fail the page if it's missing.
      if (vocabRes.ok) {
        const vocabData = await vocabRes.json();
        setMarkdown(vocabData.markdown || '');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const customResources = resources.filter(r => (r.type || '').toUpperCase() === 'CUSTOM');
  const systemResources = resources.filter(r => (r.type || '').toUpperCase() !== 'CUSTOM');
  const totalScopes = resources.reduce((sum, r) => sum + (r.scopes?.length || 0), 0);

  return (
    <AdminSubPageShell
      title="Scope Reference"
      lead={
        envInfo.environment
          ? <>Live resource servers and scopes from PingOne — environment <code>{envInfo.environment}</code>, region <code>{envInfo.region}</code>.</>
          : 'Live resource servers and scopes from the PingOne Management API.'
      }
    >
      {loading && (
        <div className="scope-ref__state">Loading resources and scopes from PingOne…</div>
      )}

      {!loading && error && needsSignIn && (
        <SignInPrompt admin message="Live scope data comes from the admin Management API." />
      )}

      {!loading && error && !needsSignIn && (
        <div className="scope-ref__state scope-ref__state--error">
          <strong>Could not load scopes from PingOne.</strong>
          <div className="scope-ref__state-detail">{error}</div>
          <button type="button" className="app-page-toolbar-btn" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="scope-ref__summary">
            <div className="scope-ref__stat">
              <span className="scope-ref__stat-value">{resources.length}</span>
              <span className="scope-ref__stat-label">Resources</span>
            </div>
            <div className="scope-ref__stat">
              <span className="scope-ref__stat-value">{customResources.length}</span>
              <span className="scope-ref__stat-label">Custom</span>
            </div>
            <div className="scope-ref__stat">
              <span className="scope-ref__stat-value">{totalScopes}</span>
              <span className="scope-ref__stat-label">Scopes</span>
            </div>
            <div className="scope-ref__summary-actions">
              <button type="button" className="app-page-toolbar-btn" onClick={load}>Refresh</button>
            </div>
          </div>

          {customResources.length > 0 && (
            <h2 className="scope-ref__section-title">Custom resource servers</h2>
          )}
          {customResources.map(r => <ResourceCard key={r.id} resource={r} />)}

          {systemResources.length > 0 && (
            <h2 className="scope-ref__section-title">Built-in PingOne resources</h2>
          )}
          {systemResources.map(r => <ResourceCard key={r.id} resource={r} />)}

          {markdown && (
            <details className="scope-ref__vocab">
              <summary>Canonical scope vocabulary document (SCOPE_VOCABULARY.md)</summary>
              <pre className="scope-ref__vocab-doc">{markdown}</pre>
            </details>
          )}
        </>
      )}
    </AdminSubPageShell>
  );
}

const ChevronIcon = () => (
  <svg className="scope-ref-card__chevron" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function ResourceCard({ resource }) {
  const { id, name, audience, type, scopes = [], expected } = resource;
  const isCustom = (type || '').toUpperCase() === 'CUSTOM';
  const missingRequired = expected?.missingRequired || [];

  return (
    <section className="scope-ref-card">
      <details>
        <summary className="scope-ref-card__header">
          <div className="scope-ref-card__title-row">
            <h3 className="scope-ref-card__name">{name}</h3>
            <span className={`scope-ref-card__badge ${isCustom ? 'scope-ref-card__badge--custom' : ''}`}>
              {type || 'OPENID_CONNECT'}
            </span>
            <span className="scope-ref-card__count">
              {scopes.length} scope{scopes.length === 1 ? '' : 's'}
            </span>
            <ChevronIcon />
          </div>
          <dl className="scope-ref-card__meta">
            <div><dt>Audience</dt><dd><code>{audience || '(none)'}</code></dd></div>
            <div><dt>Resource ID</dt><dd><code>{id}</code></dd></div>
          </dl>
          {missingRequired.length > 0 && (
            <div style={{
              marginTop: '0.6rem',
              padding: '0.45rem 0.7rem',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: '6px',
              fontSize: '0.8rem',
              color: '#92400e',
            }}>
              ⚠️ Missing required scopes (defined in scope-topology.json but absent in PingOne):{' '}
              <code style={{ fontSize: '0.78rem', fontWeight: 600 }}>{missingRequired.join(', ')}</code>
            </div>
          )}
        </summary>

        {scopes.length > 0 ? (
          <table className="scope-ref-table">
            <thead>
              <tr>
                <th className="scope-ref-table__col-name">Scope</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {scopes.map(s => (
                <tr key={s.id || s.name}>
                  <td><code className="scope-ref-table__scope">{s.name}</code></td>
                  <td className="scope-ref-table__desc">{s.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="scope-ref-card__empty">No scopes defined on this resource.</div>
        )}
      </details>
    </section>
  );
}
