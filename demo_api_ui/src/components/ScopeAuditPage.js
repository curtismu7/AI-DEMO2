import React, { useState, useCallback } from 'react';
import { notifySuccess, notifyError } from '../utils/appToast';
import '../styles/appShellPages.css';
import './ScopeAuditPage.css';
import CapabilityCallout from './CapabilityCallout';
import SignInPrompt from './SignInPrompt';
import { AGENT_GATEWAY_CAPABILITIES } from '../config/capabilityLedgers/agentGatewayCapabilities';
import { useThemeOptional } from '../context/ThemeContext';

function ThemeToggleButton() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      className="scope-audit-page__theme-toggle"
      title="Switch this page between light and dark"
      aria-pressed={darkMode}
    >
      {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
    </button>
  );
}

/**
 * ScopeAuditPage — PingOne resource & scope verification UI.
 *
 * Shows all PingOne resources, their current scopes, expected scopes,
 * and lets admins add missing scopes with one click.
 */
export default function ScopeAuditPage() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [envInfo, setEnvInfo] = useState({ environment: '', region: '' });
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [addingScope, setAddingScope] = useState(null); // "resourceId:scopeName"

  // ── Fetch resources from BFF ────────────────────────────────────────────────
  const loadResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch('/api/admin/scope-audit/resources', { credentials: 'include' });
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        setNeedsSignIn(true);
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResources(data.resources || []);
      setEnvInfo({ environment: data.environment, region: data.region });
      // Auto-expand resources with issues
      const needsAttention = new Set();
      for (const r of data.resources || []) {
        if (r.expected && !r.expected.allRequiredPresent) {
          needsAttention.add(r.id);
        }
      }
      setExpandedIds(needsAttention);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setHasRun(true);
    }
  }, []);

  // ── Add a missing scope ─────────────────────────────────────────────────────
  // refresh:false lets a batch caller (handleFixAll/handleFixEverything) skip
  // the full resources re-fetch after each individual scope and reload once
  // after the whole batch instead — a K-scope fix used to issue K separate
  // 1+N-request re-audits (loadResources fetches all resources, then one GET
  // per resource for its scopes) instead of a single reload.
  const handleAddScope = useCallback(async (resourceId, scopeName, { refresh = true } = {}) => {
    const key = `${resourceId}:${scopeName}`;
    setAddingScope(key);
    try {
      const res = await fetch('/api/admin/scope-audit/scopes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId, scopeName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notifySuccess(`Created scope: ${scopeName}`);
      if (refresh) await loadResources();
    } catch (err) {
      notifyError(`Failed to create ${scopeName}: ${err.message}`);
    } finally {
      setAddingScope(null);
    }
  }, [loadResources]);

  // ── Add ALL missing required scopes for a resource ──────────────────────────
  const handleFixAll = useCallback(async (resource) => {
    if (!resource.expected) return;
    const missing = resource.expected.missingRequired || [];
    for (const scope of missing) {
      await handleAddScope(resource.id, scope, { refresh: false });
    }
    await loadResources();
  }, [handleAddScope, loadResources]);

  // ── Add all missing across all resources ────────────────────────────────────
  const handleFixEverything = useCallback(async () => {
    for (const r of resources) {
      if (r.expected && r.expected.missingRequired?.length > 0) {
        for (const scope of r.expected.missingRequired) {
          await handleAddScope(r.id, scope, { refresh: false });
        }
      }
    }
    await loadResources();
  }, [resources, handleAddScope, loadResources]);

  // ── Toggle expand ───────────────────────────────────────────────────────────
  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Compute summary stats ───────────────────────────────────────────────────
  const totalResources = resources.length;
  const resourcesOk = resources.filter(r => r.expected?.allRequiredPresent).length;
  const resourcesWithIssues = resources.filter(r => r.expected && !r.expected.allRequiredPresent).length;
  const totalMissing = resources.reduce((sum, r) => sum + (r.expected?.missingRequired?.length || 0), 0);
  const customResources = resources.filter(r => r.expected != null).length;

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!hasRun && !loading) {
    return (
      <div className="scope-audit-page">
        <ThemeToggleButton />
        <h1>PingOne Scope Audit</h1>
        <p className="scope-audit-page__subtitle">
          Verify that PingOne resources have the scopes your code expects.
        </p>
        <div className="scope-audit-page__start">
          <button className="scope-audit-btn scope-audit-btn--primary scope-audit-btn--lg" onClick={loadResources}>
            Run Audit
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="scope-audit-page">
        <ThemeToggleButton />
        <h1>PingOne Scope Audit</h1>
        <div className="scope-audit-page__loading">
          Connecting to PingOne Management API...
        </div>
      </div>
    );
  }

  if (error && needsSignIn) {
    return (
      <div className="scope-audit-page">
        <ThemeToggleButton />
        <h1>PingOne Scope Audit</h1>
        <SignInPrompt admin message="The scope audit reads live scope data from the admin Management API." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="scope-audit-page">
        <ThemeToggleButton />
        <h1>PingOne Scope Audit</h1>
        <div className="scope-audit-page__error">
          <div className="scope-audit-page__error-icon">❌</div>
          Failed to connect to PingOne
          <div className="scope-audit-page__error-detail">{error}</div>
          <button className="scope-audit-btn" style={{ marginTop: '1rem' }} onClick={loadResources}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scope-audit-page">
      <ThemeToggleButton />
      <h1>PingOne Scope Audit</h1>
      <p className="scope-audit-page__subtitle">
        Environment: <code>{envInfo.environment}</code> · Region: <code>{envInfo.region}</code>
      </p>
      <CapabilityCallout
        capability={AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === 'policy-enforcement')}
        to="/agent-gateway-capabilities"
      />

      {/* Summary bar */}
      <div className="scope-audit-page__summary">
        <div className="scope-audit-page__stat scope-audit-page__stat--info">
          {totalResources} Resources
        </div>
        <div className="scope-audit-page__stat scope-audit-page__stat--info">
          {customResources} Matched
        </div>
        <div className={`scope-audit-page__stat ${resourcesOk > 0 ? 'scope-audit-page__stat--ok' : 'scope-audit-page__stat--info'}`}>
          ✅ {resourcesOk} OK
        </div>
        {resourcesWithIssues > 0 && (
          <div className="scope-audit-page__stat scope-audit-page__stat--error">
            ❌ {resourcesWithIssues} Need Fixes
          </div>
        )}
        {totalMissing > 0 && (
          <div className="scope-audit-page__stat scope-audit-page__stat--warn">
            ⚠️ {totalMissing} Missing Scopes
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="scope-audit-page__toolbar">
        <div className="scope-audit-page__toolbar-actions">
          <button className="scope-audit-btn" onClick={loadResources}>
            Refresh
          </button>
          {totalMissing > 0 && (
            <button className="scope-audit-btn scope-audit-btn--primary" onClick={handleFixEverything}>
              Fix All Missing ({totalMissing})
            </button>
          )}
        </div>
      </div>

      {/* Resource cards */}
      <div className="scope-audit-page__resources">
        {resources.map(r => (
          <ResourceCard
            key={r.id}
            resource={r}
            expanded={expandedIds.has(r.id)}
            onToggle={() => toggleExpand(r.id)}
            onAddScope={handleAddScope}
            onFixAll={handleFixAll}
            addingScope={addingScope}
          />
        ))}
      </div>
    </div>
  );
}

// ── Resource Card Component ───────────────────────────────────────────────────
function ResourceCard({ resource, expanded, onToggle, onAddScope, onFixAll, addingScope }) {
  const { id, name, audience, type, scopes, expected } = resource;

  let status = 'neutral';
  let badgeText = type || 'SYSTEM';
  if (expected) {
    if (expected.allRequiredPresent && expected.missingOptional.length === 0) {
      status = 'ok';
      badgeText = 'ALL OK';
    } else if (expected.allRequiredPresent) {
      status = 'warn';
      badgeText = `${expected.missingOptional.length} OPTIONAL`;
    } else {
      status = 'error';
      badgeText = `${expected.missingRequired.length} MISSING`;
    }
  }

  // Build scope rows: present scopes + missing scopes
  const scopeRows = [];
  if (expected) {
    // Required scopes
    for (const s of expected.requiredScopes) {
      const present = scopes.some(sc => sc.name === s);
      scopeRows.push({ name: s, present, required: true, id: scopes.find(sc => sc.name === s)?.id });
    }
    // Optional scopes
    for (const s of expected.optionalScopes) {
      const present = scopes.some(sc => sc.name === s);
      scopeRows.push({ name: s, present, required: false, id: scopes.find(sc => sc.name === s)?.id });
    }
    // Extra scopes (present but not in expected)
    const expectedNames = new Set([...expected.requiredScopes, ...expected.optionalScopes]);
    for (const s of scopes) {
      if (!expectedNames.has(s.name)) {
        scopeRows.push({ name: s.name, present: true, required: false, extra: true, id: s.id });
      }
    }
  } else {
    // No expected config — just show what's there
    for (const s of scopes) {
      scopeRows.push({ name: s.name, present: true, required: false, id: s.id });
    }
  }

  return (
    <div className={`scope-resource-card scope-resource-card--${status}`}>
      <div className="scope-resource-card__header" onClick={onToggle}>
        <div className="scope-resource-card__title-group">
          <span className="scope-resource-card__name">{name}</span>
          <span className={`scope-resource-card__badge scope-resource-card__badge--${status}`}>
            {badgeText}
          </span>
          {scopes.length > 0 && (
            <span className="scope-resource-card__scope-count">
              {scopes.length} scope{scopes.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className={`scope-resource-card__chevron ${expanded ? 'scope-resource-card__chevron--open' : ''}`}>
          →
        </span>
      </div>

      {expanded && (
        <div className="scope-resource-card__body">
          <div className="scope-resource-card__meta">
            <span><strong>ID:</strong> <code>{id}</code></span>
            <span><strong>Audience:</strong> <code>{audience || '(none)'}</code></span>
            <span><strong>Type:</strong> {type || 'OPENID_CONNECT'}</span>
          </div>

          {expected && expected.missingRequired.length > 0 && (
            <div style={{ margin: '0.5rem 0' }}>
              <button
                className="scope-audit-btn scope-audit-btn--primary scope-audit-btn--sm"
                onClick={() => onFixAll(resource)}
                disabled={addingScope != null}
              >
                Add All Missing Required ({expected.missingRequired.length})
              </button>
            </div>
          )}

          <table className="scope-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Resource</th>
                <th>Required</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {scopeRows.map(row => (
                <tr key={row.name}>
                  <td className="scope-table__name">{row.name}</td>
                  <td className="scope-table__resource">{name}</td>
                  <td>{row.extra ? 'extra' : row.required ? 'yes' : 'optional'}</td>
                  <td>
                    {row.present ? (
                      <span className="scope-table__status scope-table__status--present">
                        <span className="scope-table__status-icon">✅</span> Present
                      </span>
                    ) : row.required ? (
                      <span className="scope-table__status scope-table__status--missing">
                        <span className="scope-table__status-icon">❌</span> Missing
                      </span>
                    ) : (
                      <span className="scope-table__status scope-table__status--optional">
                        <span className="scope-table__status-icon">⚠️</span> Missing
                      </span>
                    )}
                  </td>
                  <td>
                    {!row.present && (
                      <button
                        className="scope-audit-btn scope-audit-btn--sm"
                        onClick={() => onAddScope(id, row.name)}
                        disabled={addingScope === `${id}:${row.name}`}
                      >
                        {addingScope === `${id}:${row.name}` ? 'Adding…' : 'Add'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {scopeRows.length === 0 && (
                <tr>
                  <td colSpan="5" className="scope-table__empty">
                    No scopes configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
