// demo_api_ui/src/components/AgentBuilderPage.jsx
//
// /agent-builder: you -> your AI agent (a PingOne OIDC app) -> resources and scopes.
//
// Honesty: Build, Upgrade, Delete agent, Create / Delete resource, Apply grants and Copy setup are real calls:
// they go through this machine's BFF, which holds the worker token and changes the PingOne environment. The one
// simulated part is the CIMD registration shown on a built agent: PingOne does not support CIMD, so the BFF
// completes a mocked facade. The banner says so, and the CIMD card is labelled Mocked.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the
// shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons. P6 (inspector) and P8 (diagram) are skipped: this is a form page with no list/detail
// inspector and no diagram. The standalone shell bar is not added (the app has its own).
//
// P9, the one primary per view. One primary at a time, chosen by the page state (primaryAction below):
//   no agent yet                 -> "Build my Agent" (everything else needs the agent)
//   agent, unsaved scope changes -> "Apply grants"   (saves the work; Upgrade would drop unsaved ticks)
//   agent, saved, legacy OIDC app-> "Upgrade to AI Agent" (the one remaining forward step)
//   agent, saved, AI_AGENT       -> "Apply grants", shown unavailable (nothing to save)
// Every other button (Copy setup, Create resource, Delete, Cancel, the light/dark switch) is a secondary.
// All buttons come from ActionButton, which marks a button that cannot act with aria-disabled (never `disabled`)
// so keyboard focus stays on it while it is busy or has nothing to do.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchState, buildAgent, deleteAgent, upgradeAgent, applyGrants,
  createResource, deleteResource, listAgents, agentSetup, errorMessage,
} from '../services/agentBuilderService';
import Check from './common/Check';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from './pingUi';
import { useThemeOptional } from '../context/ThemeContext';
import './AgentBuilderPage.css';
import InlineSpinner from './shared/InlineSpinner';

// After an action removes the control that had focus, put focus on the thing that replaced it.
const focusSoon = (id) => setTimeout(() => { document.getElementById(id)?.focus(); }, 0);

/**
 * AgentBuilderPage: /agent-builder (any logged-in user).
 * Creates real objects in PingOne via the BFF (worker token stays server-side).
 */
export default function AgentBuilderPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
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
  const [announce, setAnnounce] = useState('');     // polite live-region message after an action

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

  // done: what the live region says on success; focusId: where focus goes when the clicked control is replaced.
  const run = (zoneSetter, key, fn, { done = '', focusId = '' } = {}) => async () => {
    zoneSetter(''); setAnnounce(''); setBusy(key);
    try {
      await fn(); await refresh();
      if (done) setAnnounce(done);
      if (focusId) focusSoon(focusId);
    } catch (e) { zoneSetter(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const onBuild = run(setAgentError, 'agent', async () => {
    await buildAgent(copied ? {
      grantTypes: copied.grantTypes,
      tokenEndpointAuthMethod: copied.tokenEndpointAuthMethod,
    } : undefined);
    setCopied(null);
  }, { done: 'Agent built in PingOne.', focusId: 'ab-agent-card' });
  const onUpgrade = run(setAgentError, 'agent', () => upgradeAgent(),
    { done: 'Agent upgraded to an AI Agent.', focusId: 'ab-agent-card' });
  const onDelete = run(setAgentError, 'agent', async () => { await deleteAgent(); setShowDeleteConfirm(false); },
    { done: 'Agent deleted from PingOne.', focusId: 'ab-build-btn' });
  const askDelete = () => { setShowDeleteConfirm(true); focusSoon('ab-delete-cancel'); };
  const cancelDelete = () => { setShowDeleteConfirm(false); focusSoon('ab-delete-btn'); };

  // Copy an existing agent's setup: pre-fill config for the next Build and
  // pre-check its scope grants (Apply grants saves them).
  const onCopySetup = (a) => async () => {
    setPickerError(''); setAnnounce(''); setBusy(`copy:${a.id}`);
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
      setAnnounce(`Setup copied from ${a.name}.`);
    } catch (e) { setPickerError(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const onApplyGrants = run(setGrantsError, 'grants', () => applyGrants(
    state.resources.map((r) => ({
      resourceId: r.id,
      scopes: Object.keys(checked[r.id] || {}).filter((s) => checked[r.id][s]),
    }))
  ), { done: 'Grants applied in PingOne.' });
  const onCreateResource = run(setResourceError, 'resource', () => createResource({
    name: form.name.trim(),
    audience: form.audience.trim() || undefined,
    scopes: form.scopes.split(',').map((s) => s.trim()).filter(Boolean),
  }).then(() => setForm({ name: '', audience: '', scopes: 'read, write, admin' })),
  { done: 'Resource created in PingOne.' });

  const banner = (
    <SimBanner data-testid="ab-banner">
      <strong>LIVE PINGONE, ONE MOCKED STEP</strong> — Build, Upgrade, Delete, Create resource and Apply grants
      call this machine&apos;s BFF, which uses a worker token to change your PingOne environment for real. The CIMD
      registration shown on a built agent is a mocked facade: PingOne does not support CIMD.
    </SimBanner>
  );

  if (loading) {
    return (
      <PingPage className="ab-page">
        {banner}
        <div className="ab-loading"><InlineSpinner label="Loading PingOne Agent Builder…" /></div>
      </PingPage>
    );
  }
  if (!state) {
    return (
      <PingPage className="ab-page">
        {banner}
        <PageFrame>
          <div className="pu-status-line ab-alert" role="alert">
            <StatusChip tone="danger">Error</StatusChip>
            {agentError || 'Failed to load.'}
          </div>
        </PageFrame>
      </PingPage>
    );
  }

  const { user, agent, resources } = state;
  const demoResources = resources.filter((r) => !r.ownedByUser);
  const myResources = resources.filter((r) => r.ownedByUser);
  const grantedCount = resources.reduce((n, r) => n + r.granted.length, 0);
  const canCreate = busy !== 'resource' && !!form.name.trim();

  // P9: the one primary for this state (see the note at the top of the file).
  let primaryAction = 'apply';
  if (!agent) primaryAction = 'build';
  else if (!dirty && agent.fallback) primaryAction = 'upgrade';

  const toggle = (rid, scope) => setChecked((c) => ({
    ...c, [rid]: { ...(c[rid] || {}), [scope]: !(c[rid] || {})[scope] },
  }));

  const scopeRow = (r) => (
    <div className="ab-resource" key={r.id} data-testid={`ab-resource-${r.id}`}>
      <div className="ab-resource-head">
        <span className="ab-resource-name">{r.name}</span>
        {r.audience && <code className="ab-aud">aud: {r.audience}</code>}
        {r.ownedByUser && (
          <ActionButton
            className="ab-btn-sm"
            unavailable={busy === r.id}
            aria-label={`Delete resource ${r.name}`}
            onClick={run(setResourceError, r.id, () => deleteResource(r.id),
              { done: `Resource ${r.name} deleted from PingOne.`, focusId: 'ab-mine' })}
          >
            {busy === r.id ? 'Deleting…' : 'Delete'}
          </ActionButton>
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
    <PingPage className="ab-page">
      {banner}
      <PageHeader
        eyebrow="AI Experiences · PingOne"
        title="PingOne Agent Builder"
        summary="Build your own AI agent identity in PingOne, then decide exactly which resources and scopes it may use. This is the same identity model the demo's agent runs on."
        actions={(
          <ActionButton
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
            data-testid="ab-theme-toggle"
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </ActionButton>
        )}
      />
      <PageFrame>
        <Section
          id="ab-chain-h"
          kicker="1 · Who acts"
          title="You, your agent, its grants"
          lede={(
            <>
              <strong>Authoritative creation workspace.</strong> Use this page to create and configure the agent
              identity, resources, scopes, grant types, and token authentication. The other agent pages are guided
              demonstrations of what a configured agent can do.{' '}
              <span className="ab-authority-links">
                <a href="/delegated-commerce">Delegated Commerce demo</a>
                <a href="/agent-lifecycle">Agent Lifecycle demo</a>
              </span>
            </>
          )}
        >
          <div className="ab-chain" role="group" aria-label="Identity chain" data-testid="ab-chain">
            <Card tone="ok">
              <p className="pu-label">You</p>
              <p className="ab-node-value">{user.username || user.email}</p>
              <StatusChip tone="ok">Signed in</StatusChip>
            </Card>
            <span className="ab-arrow" aria-hidden="true">→</span>
            <Card tone={agent ? 'ok' : 'neutral'}>
              <p className="pu-label">Your AI Agent</p>
              <p className="ab-node-value">{agent ? agent.name : 'not built yet'}</p>
              <StatusChip tone={agent ? 'ok' : 'neutral'}>{agent ? 'Built' : 'Not built'}</StatusChip>
            </Card>
            <span className="ab-arrow" aria-hidden="true">→</span>
            <Card tone={grantedCount > 0 ? 'ok' : 'neutral'}>
              <p className="pu-label">Resources &amp; scopes</p>
              <p className="ab-node-value">{grantedCount > 0 ? `${grantedCount} scope(s) granted` : 'no grants yet'}</p>
              <StatusChip tone={grantedCount > 0 ? 'ok' : 'neutral'}>{grantedCount > 0 ? 'Granted' : 'None granted'}</StatusChip>
            </Card>
          </div>
        </Section>

        <Section
          id="ab-identity-h"
          kicker="2 · Identities"
          title="The human and the agent"
          lede="An AI agent gets its own identity in PingOne, an OIDC application with its own client ID, so its actions are never confused with yours."
        >
          <p className="pu-note ab-live" role="status" data-testid="ab-status">{announce}</p>
          <CardGrid>
            <Card title="You" data-testid="ab-you-card">
              <KvList
                items={[
                  { label: 'Username', value: user.username || '—' },
                  { label: 'Email', value: user.email || '—' },
                  { label: 'Subject (sub)', value: user.sub, mono: true },
                ]}
              />
              <p className="pu-note">This is the human identity. When an agent acts for you, tokens carry
                your <code>sub</code> as the subject and the agent as the actor.</p>
            </Card>

            <Card
              title="Your AI Agent"
              tone={agent ? 'ok' : undefined}
              id="ab-agent-card"
              tabIndex={-1}
              className="ab-focus-target"
              data-testid="ab-agent-card"
            >
              <p className="pu-status-line">
                {agent
                  ? <StatusChip tone="ok">Built</StatusChip>
                  : <StatusChip tone="neutral">Not built</StatusChip>}
                {agent ? 'A real PingOne application.' : 'Nothing exists in PingOne for you yet.'}
              </p>
              {agentError && (
                <div className="pu-status-line ab-alert" role="alert">
                  <StatusChip tone="danger">Error</StatusChip>{agentError}
                </div>
              )}
              {!agent ? (
                <>
                  {copied && (
                    <p className="pu-note">Will build with the setup copied from <strong>{copied.fromName}</strong>
                      {' '}(grant types: {copied.grantTypes.join(', ') || 'defaults'}; token auth:{' '}
                      {copied.tokenEndpointAuthMethod || 'default'}). Its scope grants are pre-checked below.</p>
                  )}
                  <div className="pu-actions">
                    <ActionButton
                      id="ab-build-btn"
                      main={primaryAction === 'build'}
                      unavailable={busy === 'agent'}
                      onClick={onBuild}
                    >
                      {busy === 'agent' ? 'Building…' : copied ? `Build my Agent (copy of ${copied.fromName})` : 'Build my Agent'}
                    </ActionButton>
                  </div>
                </>
              ) : (
                <>
                  <KvList
                    items={[
                      { label: 'Name', value: agent.name },
                      { label: 'Client ID', value: agent.id, mono: true },
                      { label: 'Type', value: <StatusChip tone="info">{agent.type}</StatusChip> },
                      { label: 'Grant types', value: agent.grantTypes.join(', ') || '—' },
                      { label: 'Token auth', value: agent.tokenEndpointAuthMethod || '—' },
                      { label: 'Created', value: agent.createdAt ? new Date(agent.createdAt).toLocaleString() : '—' },
                    ]}
                  />
                  {agent.fallback && (
                    <p className="pu-note">Your agent is a standard OIDC app from before first-class
                      AI&nbsp;Agent support. Upgrade recreates it as a real <strong>AI_AGENT</strong> and
                      re-applies your current scope grants automatically.</p>
                  )}
                  <div className="pu-actions">
                    {agent.fallback && (
                      <ActionButton
                        main={primaryAction === 'upgrade'}
                        unavailable={busy === 'agent'}
                        onClick={onUpgrade}
                      >
                        {busy === 'agent' ? 'Upgrading…' : 'Upgrade to AI Agent'}
                      </ActionButton>
                    )}
                    {!showDeleteConfirm ? (
                      <ActionButton id="ab-delete-btn" onClick={askDelete}>Delete agent</ActionButton>
                    ) : (
                      <div className="ab-confirm">
                        <span>Delete <strong>{agent.name}</strong> from PingOne? Its grants go with it.</span>
                        <ActionButton unavailable={busy === 'agent'} onClick={onDelete}>
                          {busy === 'agent' ? 'Deleting…' : 'Yes, delete'}
                        </ActionButton>
                        <ActionButton id="ab-delete-cancel" onClick={cancelDelete}>Cancel</ActionButton>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>

            {agent && agent.cimd && (
              <Card
                title="CIMD registration"
                tone="warn"
                aria-label="CIMD registration"
                data-testid="ab-cimd"
              >
                <p className="pu-status-line">
                  <StatusChip tone="warn">Mocked</StatusChip>
                  <StatusChip tone={agent.cimd.status === 'registered' ? 'ok' : 'danger'}>
                    {agent.cimd.status === 'registered' ? 'Registered' : 'Failed'}
                  </StatusChip>
                </p>
                <p className="pu-note">
                  Mocked — PingOne does not support CIMD. The BFF {agent.cimd.status === 'registered' ? 'completed' : 'could not complete'}
                  {' '}the CIMD registration facade automatically in the background.
                </p>
                {agent.cimd.status !== 'registered' && (
                  <p className="pu-note"><strong>CIMD registration failed; retrying is safe.</strong></p>
                )}
                <p className="pu-note">
                  The PingOne-backed agent identity remains the credential used for RFC 8693
                  token exchange and delegated tool calls.
                </p>
                {agent.cimd.metadataUrl && (
                  <p className="pu-note">
                    <a href={agent.cimd.metadataUrl}>Open client metadata document</a>
                  </p>
                )}
                {Array.isArray(agent.cimd.steps) && agent.cimd.steps.length > 0 && (
                  <ol className="ab-steps">
                    {agent.cimd.steps.map((step) => (
                      <li key={step.step}>
                        {step.step}: {step.status} ({step.engine || 'mock'})
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            )}
          </CardGrid>
        </Section>

        <Section
          id="ab-existing-h"
          kicker="3 · Copy a setup"
          title="Existing agents in PingOne"
          lede="Agents already registered in this environment. Pick one to copy its setup: its grant types and token auth pre-fill your next build, and its scope grants are pre-checked below."
        >
          <Card tone="neutral" data-testid="ab-existing">
            {pickerError && (
              <div className="pu-status-line ab-alert" role="alert">
                <StatusChip tone="danger">Error</StatusChip>{pickerError}
              </div>
            )}
            {envAgents.length === 0 && <p className="pu-note pu-empty">No agents found in this environment yet.</p>}
            {envAgents.map((a) => (
              <div className="ab-resource" key={a.id}>
                <div className="ab-resource-head">
                  <span className="ab-resource-name">{a.name}</span>
                  <StatusChip tone="info">{a.type}</StatusChip>
                  {a.builderCreated && <StatusChip tone="neutral">built here</StatusChip>}
                  {!a.enabled && <StatusChip tone="warn">disabled</StatusChip>}
                  <ActionButton
                    className="ab-btn-sm"
                    unavailable={busy === `copy:${a.id}`}
                    aria-label={`Copy setup from ${a.name}`}
                    onClick={onCopySetup(a)}
                  >
                    {busy === `copy:${a.id}` ? 'Copying…' : 'Copy setup'}
                  </ActionButton>
                </div>
                <div className="ab-agent-meta">
                  grant types: {a.grantTypes.join(', ') || '—'} · token auth: {a.tokenEndpointAuthMethod || '—'}
                </div>
              </div>
            ))}
          </Card>
        </Section>

        <Section
          id="ab-resources-h"
          kicker="4 · Permissions"
          title="Resources & scopes"
          lede={`Scopes are the agent's permissions, granted per resource server.${agent ? '' : ' Build your agent first to enable granting.'}`}
        >
          {grantsError && (
            <div className="pu-status-line ab-alert" role="alert">
              <StatusChip tone="danger">Error</StatusChip>{grantsError}
            </div>
          )}
          <Card title="Demo resources" tone="neutral" data-testid="ab-demo-resources">
            {demoResources.map(scopeRow)}
          </Card>

          <Card
            title="Your resources"
            tone="neutral"
            id="ab-mine"
            tabIndex={-1}
            className="ab-focus-target"
            data-testid="ab-my-resources"
          >
            {resourceError && (
              <div className="pu-status-line ab-alert" role="alert">
                <StatusChip tone="danger">Error</StatusChip>{resourceError}
              </div>
            )}
            {myResources.length === 0 && <p className="pu-note pu-empty">None yet — create one below.</p>}
            {myResources.map(scopeRow)}

            <form
              className="ab-create-form"
              aria-label="Create a resource"
              onSubmit={(e) => { e.preventDefault(); if (canCreate) onCreateResource(); }}
            >
              <div>
                <label className="pu-label" htmlFor="ab-res-name">Resource name</label>
                <input id="ab-res-name" className="pu-select ab-input" placeholder="e.g. Weather" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="pu-label" htmlFor="ab-res-aud">Audience (optional)</label>
                <input id="ab-res-aud" className="pu-select ab-input" placeholder="https://api.example.com" value={form.audience}
                  onChange={(e) => setForm({ ...form, audience: e.target.value })} />
              </div>
              <div>
                <label className="pu-label" htmlFor="ab-res-scopes">Scopes, comma-separated</label>
                <input id="ab-res-scopes" className="pu-select ab-input" placeholder="read, write, admin" value={form.scopes}
                  onChange={(e) => setForm({ ...form, scopes: e.target.value })} />
              </div>
              <ActionButton type="submit" unavailable={!canCreate}>
                {busy === 'resource' ? 'Creating…' : 'Create resource'}
              </ActionButton>
            </form>
          </Card>

          <div className="ab-apply-row">
            <ActionButton
              main={primaryAction === 'apply'}
              unavailable={!agent || !dirty || busy === 'grants'}
              onClick={onApplyGrants}
            >
              {busy === 'grants' ? 'Applying…' : 'Apply grants'}
            </ActionButton>
            {dirty && <StatusChip tone="warn">Unsaved changes</StatusChip>}
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

/** The page's one button: secondary by default, the Ping Red primary when `main` (see the P9 note above). */
function ActionButton({ main = false, unavailable = false, type = 'button', onClick, children, className = '', ...rest }) {
  return (
    <button
      type={type}
      className={`${main ? 'pu-btn pu-btn--primary' : 'pu-btn'} ${className}`.trim()}
      aria-disabled={unavailable ? 'true' : undefined}
      onClick={(e) => {
        if (unavailable) { e.preventDefault(); return; }
        if (onClick) onClick(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
