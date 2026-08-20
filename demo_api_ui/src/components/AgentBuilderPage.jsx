// demo_api_ui/src/components/AgentBuilderPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchState, buildAgent, deleteAgent, upgradeAgent, applyGrants,
  createResource, deleteResource, listAgents, agentSetup, errorMessage,
} from '../services/agentBuilderService';
import Check from './common/Check';
import './AgentBuilderPage.css';

/**
 * AgentBuilderPage — /agent-builder (any logged-in user).
 * One page: you → your AI agent (PingOne OIDC app) → resources & scopes.
 * Creates real objects in PingOne via the BFF (worker token stays server-side).
 */
export default function AgentBuilderPage() {
  const [state, setState] = useState(null);        // { user, agent, resources }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);          // 'agent' | 'grants' | 'resource' | resourceId
  const [agentError, setAgentError] = useState('');
  const [grantsError, setGrantsError] = useState('');
  const [resourceError, setResourceError] = useState('');
  const [checked, setChecked] = useState({});      // { [resourceId]: Set-like {scopeName: true} }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [form, setForm] = useState({ name: '', audience: '', scopes: 'read, write, admin' });
  const [envAgents, setEnvAgents] = useState([]);   // existing agents in PingOne (picker)
  const [pickerError, setPickerError] = useState('');
  const [copied, setCopied] = useState(null);       // setup copied from a picked agent

  const refresh = useCallback(async () => {
    const [data, agents] = await Promise.all([fetchState(), listAgents()]);
    setState(data);
    setEnvAgents(agents);
    const initial = {};
    for (const r of data.resources) {
      initial[r.id] = Object.fromEntries(r.granted.map((s) => [s, true]));
    }
    setChecked(initial);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setAgentError(errorMessage(e))).finally(() => setLoading(false));
  }, [refresh]);

  const dirty = useMemo(() => {
    if (!state) return false;
    return state.resources.some((r) => {
      const want = Object.keys(checked[r.id] || {}).filter((s) => checked[r.id][s]).sort().join(',');
      return want !== [...r.granted].sort().join(',');
    });
  }, [state, checked]);

  const run = (zoneSetter, key, fn) => async () => {
    zoneSetter(''); setBusy(key);
    try { await fn(); await refresh(); }
    catch (e) { zoneSetter(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const onBuild = run(setAgentError, 'agent', async () => {
    await buildAgent(copied ? {
      grantTypes: copied.grantTypes,
      tokenEndpointAuthMethod: copied.tokenEndpointAuthMethod,
    } : undefined);
    setCopied(null);
  });
  const onUpgrade = run(setAgentError, 'agent', () => upgradeAgent());
  const onDelete = run(setAgentError, 'agent', async () => { await deleteAgent(); setShowDeleteConfirm(false); });

  // Copy an existing agent's setup: pre-fill config for the next Build and
  // pre-check its scope grants (Apply grants saves them).
  const onCopySetup = (a) => async () => {
    setPickerError(''); setBusy(`copy:${a.id}`);
    try {
      const setup = await agentSetup(a.id);
      setCopied({ fromName: a.name, grantTypes: setup.grantTypes, tokenEndpointAuthMethod: setup.tokenEndpointAuthMethod });
      setChecked((prev) => {
        const next = { ...prev };
        for (const r of (state?.resources || [])) {
          next[r.id] = Object.fromEntries((setup.grants[r.id] || []).map((s) => [s, true]));
        }
        return next;
      });
    } catch (e) { setPickerError(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const onApplyGrants = run(setGrantsError, 'grants', () => applyGrants(
    state.resources.map((r) => ({
      resourceId: r.id,
      scopes: Object.keys(checked[r.id] || {}).filter((s) => checked[r.id][s]),
    }))
  ));
  const onCreateResource = run(setResourceError, 'resource', () => createResource({
    name: form.name.trim(),
    audience: form.audience.trim() || undefined,
    scopes: form.scopes.split(',').map((s) => s.trim()).filter(Boolean),
  }).then(() => setForm({ name: '', audience: '', scopes: 'read, write, admin' })));

  if (loading) return <div className="ab-page"><div className="ab-loading">Loading PingOne Agent Builder…</div></div>;
  if (!state) return <div className="ab-page"><div className="ab-error">{agentError || 'Failed to load.'}</div></div>;

  const { user, agent, resources } = state;
  const demoResources = resources.filter((r) => !r.ownedByUser);
  const myResources = resources.filter((r) => r.ownedByUser);
  const grantedCount = resources.reduce((n, r) => n + r.granted.length, 0);

  const toggle = (rid, scope) => setChecked((c) => ({
    ...c, [rid]: { ...(c[rid] || {}), [scope]: !(c[rid] || {})[scope] },
  }));

  const scopeRow = (r) => (
    <div className="ab-resource" key={r.id}>
      <div className="ab-resource-head">
        <span className="ab-resource-name">{r.name}</span>
        {r.audience && <code className="ab-aud">aud: {r.audience}</code>}
        {r.ownedByUser && (
          <button className="ab-btn ab-btn-danger ab-btn-sm" disabled={busy === r.id}
            onClick={run(setResourceError, r.id, () => deleteResource(r.id))}>
            {busy === r.id ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      <div className="ab-scopes">
        {r.scopes.map((s) => (
          <Check
            key={s}
            variant="pill"
            checked={!!(checked[r.id] || {})[s]}
            disabled={!agent || busy === 'grants'}
            onChange={() => toggle(r.id, s)}
          >
            <code>{s}</code>
          </Check>
        ))}
      </div>
    </div>
  );

  return (
    <div className="ab-page">
      <h1>PingOne Agent Builder</h1>
      <p className="ab-intro">
        Build your own AI agent identity in PingOne, then decide exactly which resources and
        scopes it may use. This is the same identity model the demo's agent runs on.
      </p>
      <div className="ab-authority-note">
        <strong>Authoritative creation workspace.</strong> Use this page to create and configure
        the agent identity, resources, scopes, grant types, and token authentication. The other
        agent pages are guided demonstrations of what a configured agent can do.
        <span className="ab-authority-links">
          <a href="/delegated-commerce">Delegated Commerce demo</a>
          <a href="/agent-lifecycle">Agent Lifecycle demo</a>
        </span>
      </div>

      {/* Zone 1 — identity chain strip */}
      <div className="ab-chain">
        <div className="ab-node ab-node-on">
          <div className="ab-node-label">You</div>
          <div className="ab-node-value">{user.username || user.email}</div>
        </div>
        <div className="ab-arrow">→</div>
        <div className={`ab-node ${agent ? 'ab-node-on' : ''}`}>
          <div className="ab-node-label">Your AI Agent</div>
          <div className="ab-node-value">{agent ? agent.name : 'not built yet'}</div>
        </div>
        <div className="ab-arrow">→</div>
        <div className={`ab-node ${grantedCount > 0 ? 'ab-node-on' : ''}`}>
          <div className="ab-node-label">Resources & scopes</div>
          <div className="ab-node-value">{grantedCount > 0 ? `${grantedCount} scope(s) granted` : 'no grants yet'}</div>
        </div>
      </div>

      {/* Zone 2 — You */}
      <section className="ab-card">
        <h2>You</h2>
        <dl className="ab-kv">
          <dt>Username</dt><dd>{user.username || '—'}</dd>
          <dt>Email</dt><dd>{user.email || '—'}</dd>
          <dt>Subject (sub)</dt><dd><code>{user.sub}</code></dd>
        </dl>
        <p className="ab-edu">This is the human identity. When an agent acts for you, tokens carry
          your <code>sub</code> as the subject and the agent as the actor.</p>
      </section>

      {/* Zone 3 — Your AI Agent */}
      <section className="ab-card">
        <h2>Your AI Agent</h2>
        {agentError && <div className="ab-error">{agentError}</div>}
        {!agent ? (
          <>
            <p className="ab-edu">An AI agent gets its <strong>own identity</strong> in PingOne — an OIDC
              application with its own client ID — so its actions are never confused with yours.</p>
            {copied && (
              <p className="ab-note">Will build with the setup copied from <strong>{copied.fromName}</strong>
                {' '}(grant types: {copied.grantTypes.join(', ') || 'defaults'}; token auth:{' '}
                {copied.tokenEndpointAuthMethod || 'default'}). Its scope grants are pre-checked below.</p>
            )}
            <button className="ab-btn ab-btn-primary" onClick={onBuild} disabled={busy === 'agent'}>
              {busy === 'agent' ? 'Building…' : copied ? `Build my Agent (copy of ${copied.fromName})` : 'Build my Agent'}
            </button>
          </>
        ) : (
          <>
            <dl className="ab-kv">
              <dt>Name</dt><dd>{agent.name}</dd>
              <dt>Client ID</dt><dd><code>{agent.id}</code></dd>
              <dt>Type</dt><dd><span className="ab-badge">{agent.type}</span></dd>
              <dt>Grant types</dt><dd>{agent.grantTypes.join(', ') || '—'}</dd>
              <dt>Token auth</dt><dd>{agent.tokenEndpointAuthMethod || '—'}</dd>
              <dt>Created</dt><dd>{agent.createdAt ? new Date(agent.createdAt).toLocaleString() : '—'}</dd>
            </dl>
            {agent.fallback && (
              <p className="ab-note">Your agent is a standard OIDC app from before first-class
                AI&nbsp;Agent support. Upgrade recreates it as a real <strong>AI_AGENT</strong> and
                re-applies your current scope grants automatically.</p>
            )}
            {agent.fallback && (
              <button type="button" className="ab-btn ab-btn-primary" onClick={onUpgrade} disabled={busy === 'agent'}
                style={{ marginRight: 10 }}>
                {busy === 'agent' ? 'Upgrading…' : 'Upgrade to AI Agent'}
              </button>
            )}
            {!showDeleteConfirm ? (
              <button className="ab-btn ab-btn-danger" onClick={() => setShowDeleteConfirm(true)}>Delete agent</button>
            ) : (
              <div className="ab-confirm">
                <span>Delete <strong>{agent.name}</strong> from PingOne? Its grants go with it.</span>
                <button className="ab-btn ab-btn-danger" onClick={onDelete} disabled={busy === 'agent'}>
                  {busy === 'agent' ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button className="ab-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Zone 3b — Existing agents in PingOne (reference + copy source) */}
      <section className="ab-card">
        <h2>Existing agents in PingOne</h2>
        <p className="ab-edu">Agents already registered in this environment. Pick one to copy its
          setup — its grant types and token auth pre-fill your next build, and its scope grants are
          pre-checked below.</p>
        {pickerError && <div className="ab-error">{pickerError}</div>}
        {envAgents.length === 0 && <p className="ab-empty-note">No agents found in this environment yet.</p>}
        {envAgents.map((a) => (
          <div className="ab-resource" key={a.id}>
            <div className="ab-resource-head">
              <span className="ab-resource-name">{a.name}</span>
              <span className="ab-badge">{a.type}</span>
              {a.builderCreated && <span className="ab-badge ab-badge-soft">built here</span>}
              <button type="button" className="ab-btn ab-btn-sm" disabled={busy === `copy:${a.id}`}
                onClick={onCopySetup(a)}>
                {busy === `copy:${a.id}` ? 'Copying…' : 'Copy setup'}
              </button>
            </div>
            <div className="ab-agent-meta">
              grant types: {a.grantTypes.join(', ') || '—'} · token auth: {a.tokenEndpointAuthMethod || '—'}
              {!a.enabled && ' · disabled'}
            </div>
          </div>
        ))}
      </section>

      {/* Zone 4 — Resources & scopes */}
      <section className="ab-card">
        <h2>Resources & scopes</h2>
        <p className="ab-edu">Scopes are the agent's permissions, granted per resource server.
          {!agent && ' Build your agent first to enable granting.'}</p>
        {grantsError && <div className="ab-error">{grantsError}</div>}

        <h3>Demo resources</h3>
        {demoResources.map(scopeRow)}

        <h3>Your resources</h3>
        {resourceError && <div className="ab-error">{resourceError}</div>}
        {myResources.length === 0 && <p className="ab-empty-note">None yet — create one below.</p>}
        {myResources.map(scopeRow)}

        <div className="ab-create-form">
          <input placeholder="Resource name (e.g. Weather)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Audience (optional)" value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          <input placeholder="Scopes, comma-separated" value={form.scopes}
            onChange={(e) => setForm({ ...form, scopes: e.target.value })} />
          <button className="ab-btn" onClick={onCreateResource}
            disabled={busy === 'resource' || !form.name.trim()}>
            {busy === 'resource' ? 'Creating…' : 'Create resource'}
          </button>
        </div>

        <div className="ab-apply-row">
          <button className="ab-btn ab-btn-primary" onClick={onApplyGrants}
            disabled={!agent || !dirty || busy === 'grants'}>
            {busy === 'grants' ? 'Applying…' : 'Apply grants'}
          </button>
          {dirty && <span className="ab-dirty">Unsaved changes</span>}
        </div>
      </section>
    </div>
  );
}
