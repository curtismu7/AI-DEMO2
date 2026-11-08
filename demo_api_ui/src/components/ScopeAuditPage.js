// ScopeAuditPage.js
// PingOne resource & scope verification: reads every PingOne resource and its scopes from the
// admin Management API (through the BFF), compares them with the scopes this demo expects, and
// lets an admin create the missing ones.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first,
// P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons. Skipped: P6 (no inspector) and P8 (no diagram).
//
// Nothing here is simulated. Run audit reads live data, and Add / Fix All create real scopes in the
// PingOne environment the BFF is configured for. The banner says which of those is true for the
// state on screen, and names the environment only once the BFF has answered with it.
//
// P9 "one primary per view": the page has ONE next-step button, rendered in one place, so its
// element (and keyboard focus) survives every state change. Its job by state:
//   not run yet            Run audit
//   running / fixing       the same button, aria-disabled, label says what is happening
//   audit failed           Retry audit
//   signed out             none here: the sign-in prompt below is the one call to action
//   results, scopes missing  Fix All Missing (n); Refresh audit is a secondary beside it
//   results, nothing missing Refresh audit (nothing else to do, so it is the primary)
// The theme toggle, the resource headers, "Add all missing required" and the per-scope "Add" are
// bordered secondaries.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { notifySuccess, notifyError } from '../utils/appToast';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from './pingUi';
import './ScopeAuditPage.css';
import CapabilityCallout from './CapabilityCallout';
import SignInPrompt from './SignInPrompt';
import { AGENT_GATEWAY_CAPABILITIES } from '../config/capabilityLedgers/agentGatewayCapabilities';
import { useThemeOptional } from '../context/ThemeContext';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  const [audited, setAudited] = useState(false); // a live audit answered and its rows are on screen
  const [envInfo, setEnvInfo] = useState({ environment: '', region: '' });
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [addingScope, setAddingScope] = useState(null); // "resourceId:scopeName"
  const [fixing, setFixing] = useState(false); // a batch (Fix All) is running
  const [fixNote, setFixNote] = useState(''); // outcome of the last add / fix, announced in the status line
  const pendingFocus = useRef(null); // resource id whose header gets focus once a re-audit lands

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
      setAudited(true);
      // Auto-expand resources with issues
      const needsAttention = new Set();
      for (const r of data.resources || []) {
        if (r.expected && !r.expected.allRequiredPresent) {
          needsAttention.add(r.id);
        }
      }
      setExpandedIds(needsAttention);
    } catch (err) {
      // A failed audit must not leave the previous audit's rows looking current.
      setResources([]);
      setAudited(false);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // A control that vanishes after a successful add (its row, or its "Add all" button) would drop
  // keyboard focus to the page body: hand it to that resource's header, a real button, instead.
  useEffect(() => {
    if (loading || pendingFocus.current == null) return;
    const el = document.getElementById(`scopeaudit-toggle-${pendingFocus.current}`);
    pendingFocus.current = null;
    if (el) el.focus();
  }, [loading, resources]);

  // ── Add a missing scope ─────────────────────────────────────────────────────
  // refresh:false lets a batch caller (handleFixAll/handleFixEverything) skip
  // the full resources re-fetch after each individual scope and reload once
  // after the whole batch instead — a K-scope fix used to issue K separate
  // 1+N-request re-audits (loadResources fetches all resources, then one GET
  // per resource for its scopes) instead of a single reload.
  // Resolves true when PingOne accepted the scope.
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
      if (refresh) {
        setFixNote(`Created scope ${scopeName} in PingOne.`);
        pendingFocus.current = resourceId;
        await loadResources();
      }
      return true;
    } catch (err) {
      notifyError(`Failed to create ${scopeName}: ${err.message}`);
      if (refresh) setFixNote(`Could not create scope ${scopeName}: ${err.message}`);
      return false;
    } finally {
      setAddingScope(null);
    }
  }, [loadResources]);

  // Runs a batch of [resourceId, scopeName] pairs, re-audits once, and says what happened.
  const runBatch = useCallback(async (pairs, focusResourceId) => {
    setFixing(true);
    setFixNote('');
    let created = 0;
    for (const [resourceId, scope] of pairs) {
      if (await handleAddScope(resourceId, scope, { refresh: false })) created += 1;
    }
    const failed = pairs.length - created;
    setFixNote(
      `Created ${plural(created, 'scope', 'scopes')} in PingOne${failed ? `, ${failed} failed (see the notice)` : ''}.`,
    );
    pendingFocus.current = focusResourceId;
    await loadResources();
    setFixing(false);
  }, [handleAddScope, loadResources]);

  // ── Add ALL missing required scopes for a resource ──────────────────────────
  const handleFixAll = useCallback(async (resource) => {
    if (!resource.expected) return;
    const missing = resource.expected.missingRequired || [];
    await runBatch(missing.map((s) => [resource.id, s]), resource.id);
  }, [runBatch]);

  // ── Add all missing across all resources ────────────────────────────────────
  const handleFixEverything = useCallback(async () => {
    const pairs = [];
    for (const r of resources) {
      for (const scope of r.expected?.missingRequired || []) pairs.push([r.id, scope]);
    }
    await runBatch(pairs, null);
  }, [resources, runBatch]);

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

  const signedOut = Boolean(error && needsSignIn);
  const failed = Boolean(error && !needsSignIn);
  const busy = loading || fixing || addingScope != null;
  const apiHost = envInfo.region ? `api.pingone.${envInfo.region}` : 'the PingOne Management API';

  // A plain (re-)run clears the last fix outcome so it never describes a newer audit.
  const rerun = () => { setFixNote(''); loadResources(); };

  // ── The one primary (P9) ────────────────────────────────────────────────────
  let primary = null;
  if (!signedOut) {
    if (loading) primary = { label: audited ? 'Re-checking…' : 'Running audit…' };
    else if (fixing || addingScope != null) primary = { label: 'Creating scopes…' };
    else if (failed) primary = { label: 'Retry audit', run: rerun };
    else if (!audited) primary = { label: 'Run Audit', run: rerun };
    else if (totalMissing > 0) primary = { label: `Fix All Missing (${totalMissing})`, run: handleFixEverything };
    else primary = { label: 'Refresh audit', run: rerun };
  }
  const showRefreshSecondary = audited && totalMissing > 0 && !signedOut;

  // ── Banner and status wording: only what the page actually knows ────────────
  let bannerWord = 'NOT RUN YET';
  let bannerText = (
    <>
      Nothing has been read from PingOne yet. <strong>Run Audit</strong> reads the resources and scopes of the PingOne
      environment this demo is configured for, through the admin Management API. Nothing on this page is simulated.
      Add and Fix All create scopes in that environment for real. An admin session is required.
    </>
  );
  if (loading) {
    bannerWord = 'RUNNING';
    bannerText = <>Asking the PingOne Management API for the resources and scopes. Nothing on this page is simulated.</>;
  } else if (signedOut) {
    bannerWord = 'NO DATA';
    bannerText = <>No audit data is shown: this session has no admin access to the scope-audit API, so nothing was read from PingOne.</>;
  } else if (failed) {
    bannerWord = 'NO DATA';
    bannerText = <>The audit did not return, so no resources or scopes are shown. Nothing on this page is simulated.</>;
  } else if (audited) {
    bannerWord = 'LIVE DATA';
    bannerText = (
      <>
        Read just now from PingOne environment <code>{envInfo.environment}</code> (region <code>{envInfo.region}</code>).
        These are the real resources and scopes. Add and Fix All create scopes in that environment for real.
      </>
    );
  }

  // ── Status line (announced) ─────────────────────────────────────────────────
  let statusTone = 'neutral';
  let statusWord = 'Not run';
  let statusText = 'No audit has run in this session.';
  if (loading) {
    statusTone = 'info'; statusWord = 'Running';
    statusText = `Connecting to ${apiHost}…`;
  } else if (fixing || addingScope != null) {
    statusTone = 'info'; statusWord = 'Creating';
    statusText = 'Creating scopes in PingOne. Controls are paused until the re-check finishes.';
  } else if (signedOut) {
    statusTone = 'warn'; statusWord = 'Signed out';
    statusText = 'The scope audit reads live scope data from the admin Management API, so it needs an admin session.';
  } else if (failed) {
    statusTone = 'danger'; statusWord = 'Failed';
    statusText = 'Failed to connect to PingOne';
  } else if (audited && customResources === 0) {
    statusTone = 'neutral'; statusWord = 'Nothing matched';
    statusText = 'None of the PingOne resources matched a resource this demo expects, so no scope was checked.';
  } else if (audited) {
    statusTone = totalMissing > 0 ? 'danger' : 'ok';
    statusWord = totalMissing > 0 ? 'Scopes missing' : 'All required present';
    statusText = totalMissing > 0
      ? `${plural(totalMissing, 'required scope is', 'required scopes are')} missing from ${plural(resourcesWithIssues, 'resource', 'resources')}.`
      : `Every required scope exists on the ${plural(customResources, 'matched resource', 'matched resources')}.`;
  }

  const onPrimary = () => {
    if (busy || !primary?.run) return; // aria-disabled keeps focus, so the click is ignored here
    primary.run();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <PingPage className="scope-audit-page">
      <SimBanner data-testid="scope-audit-banner">
        <strong>{bannerWord}</strong> &mdash; {bannerText}
      </SimBanner>
      <PageHeader
        eyebrow="Authorize · PingOne"
        title="PingOne Scope Audit"
        summary="Verify that PingOne resources have the scopes your code expects."
        badge="Admin"
        actions={<ThemeToggleButton />}
      />
      <PageFrame>
        <Section
          id="scopeaudit-run-h"
          kicker="1 · Audit"
          title="Run the audit"
          lede={audited ? undefined : 'Compares the scopes on each PingOne resource with the scopes this demo needs.'}
        >
          <Card title="PingOne scope audit" data-testid="scope-audit-run">
            <div className="pu-status-line" role="status" data-testid="scope-audit-status">
              <StatusChip tone={statusTone}>{statusWord}</StatusChip>
              <span>{statusText}</span>
            </div>
            {failed && (
              <p className="pu-note scopeaudit-error" data-testid="scope-audit-error">{error}</p>
            )}
            {fixNote && !loading && !fixing && (
              <p className="pu-note" role="status" data-testid="scope-audit-fix-note">{fixNote}</p>
            )}
            {signedOut && (
              <SignInPrompt admin message="The scope audit reads live scope data from the admin Management API." />
            )}
            {audited && (
              <>
                <KvList
                  items={[
                    { label: 'Environment', value: envInfo.environment, mono: true },
                    { label: 'Region', value: envInfo.region, mono: true },
                  ]}
                />
                <div className="scopeaudit-chips" role="group" aria-label="Audit summary" data-testid="scope-audit-summary">
                  <StatusChip tone="info">{plural(totalResources, 'resource', 'resources')}</StatusChip>
                  <StatusChip tone="info">{customResources} matched</StatusChip>
                  <StatusChip tone={resourcesOk > 0 ? 'ok' : 'neutral'}>{resourcesOk} OK</StatusChip>
                  {resourcesWithIssues > 0 && (
                    <StatusChip tone="danger">{resourcesWithIssues} need fixes</StatusChip>
                  )}
                  {totalMissing > 0 && (
                    <StatusChip tone="warn">{plural(totalMissing, 'missing scope', 'missing scopes')}</StatusChip>
                  )}
                </div>
              </>
            )}
            {primary && (
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn pu-btn--primary"
                  data-testid="scope-audit-primary"
                  aria-disabled={busy ? 'true' : undefined}
                  onClick={onPrimary}
                >
                  {primary.label}
                </button>
                {showRefreshSecondary && (
                  <button
                    type="button"
                    className="pu-btn"
                    data-testid="scope-audit-refresh"
                    aria-disabled={busy ? 'true' : undefined}
                    onClick={() => { if (!busy) rerun(); }}
                  >
                    Refresh
                  </button>
                )}
              </div>
            )}
          </Card>
          {audited && (
            <CapabilityCallout
              capability={AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === 'policy-enforcement')}
              to="/agent-gateway-capabilities"
            />
          )}
        </Section>

        {audited && (
          <Section
            id="scopeaudit-resources-h"
            kicker="2 · Resources"
            title="Resources and their scopes"
            lede="Select a resource to see each expected scope. Resources with missing required scopes open by themselves."
          >
            <div className="scopeaudit-list">
              {resources.map(r => (
                <ResourceCard
                  key={r.id}
                  resource={r}
                  expanded={expandedIds.has(r.id)}
                  onToggle={() => toggleExpand(r.id)}
                  onAddScope={handleAddScope}
                  onFixAll={handleFixAll}
                  addingScope={addingScope}
                  busy={busy}
                />
              ))}
            </div>
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}

// ── Resource Card Component ───────────────────────────────────────────────────
function ResourceCard({ resource, expanded, onToggle, onAddScope, onFixAll, addingScope, busy }) {
  const { id, name, audience, type, scopes, expected } = resource;

  let tone = 'neutral';
  let badgeText = type || 'SYSTEM';
  if (expected) {
    if (expected.allRequiredPresent && expected.missingOptional.length === 0) {
      tone = 'ok';
      badgeText = 'ALL OK';
    } else if (expected.allRequiredPresent) {
      tone = 'warn';
      badgeText = `${expected.missingOptional.length} OPTIONAL`;
    } else {
      tone = 'danger';
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

  const bodyId = `scopeaudit-body-${id}`;

  return (
    <Card tone={tone} className="scopeaudit-resource" data-testid={`scope-audit-resource-${id}`}>
      <button
        type="button"
        id={`scopeaudit-toggle-${id}`}
        className="pu-btn scopeaudit-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        onClick={onToggle}
      >
        <span className="scopeaudit-toggle__name">{name}</span>
        <StatusChip tone={tone}>{badgeText}</StatusChip>
        {scopes.length > 0 && (
          <span className="scopeaudit-toggle__count">
            {scopes.length} scope{scopes.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className="scopeaudit-toggle__cue">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="scopeaudit-body" id={bodyId}>
          <KvList
            items={[
              { label: 'ID', value: id, mono: true },
              { label: 'Audience', value: audience || '(none)', mono: true },
              { label: 'Type', value: type || 'OPENID_CONNECT' },
            ]}
          />

          {expected && expected.missingRequired.length > 0 && (
            <div className="pu-actions">
              <button
                type="button"
                className="pu-btn"
                aria-disabled={busy ? 'true' : undefined}
                onClick={() => { if (!busy) onFixAll(resource); }}
              >
                Add All Missing Required ({expected.missingRequired.length})
              </button>
            </div>
          )}

          <div className="scopeaudit-table-wrap">
            <table className="scopeaudit-table" aria-label={`Scopes on ${name}`}>
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Required</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {scopeRows.map(row => {
                  const adding = addingScope === `${id}:${row.name}`;
                  return (
                    <tr key={row.name}>
                      <td data-label="Scope" className="scopeaudit-table__name">{row.name}</td>
                      <td data-label="Required">{row.extra ? 'extra' : row.required ? 'yes' : 'optional'}</td>
                      <td data-label="Status">
                        {row.present ? (
                          <StatusChip tone="ok">Present</StatusChip>
                        ) : row.required ? (
                          <StatusChip tone="danger">Missing</StatusChip>
                        ) : (
                          <StatusChip tone="warn">Optional, missing</StatusChip>
                        )}
                      </td>
                      <td data-label="Action">
                        {!row.present && (
                          <button
                            type="button"
                            className="pu-btn"
                            aria-label={`Add scope ${row.name} to ${name}`}
                            aria-disabled={busy ? 'true' : undefined}
                            onClick={() => { if (!busy) onAddScope(id, row.name); }}
                          >
                            {adding ? 'Adding…' : 'Add'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {scopeRows.length === 0 && (
                  <tr>
                    <td colSpan="4" className="scopeaudit-table__empty">
                      No scopes configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Theme toggle (header action) ───────────────────────────────────────────────
function ThemeToggleButton() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      className="pu-btn"
      title="Switch this page between light and dark"
      aria-pressed={darkMode}
    >
      {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
    </button>
  );
}
