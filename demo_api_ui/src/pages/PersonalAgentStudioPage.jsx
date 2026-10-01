import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import apiClient from '../services/apiClient';
import AgentClientSkin from '../components/AgentClientSkin';
import ConfirmModal from '../components/ConfirmModal';
import PersonalAgentClientCards from '../components/learning/PersonalAgentClientCards';
import SecurityRail from '../components/SecurityRail';
import TokenChainFilmstrip from '../components/TokenChainFilmstrip';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

const SKINS = ['privilege', 'claude', 'claude-terminal', 'gpt', 'gemini'];
const SKIN_LABELS = { privilege: 'Privilege', claude: 'Claude', 'claude-terminal': 'Terminal', gpt: 'ChatGPT', gemini: 'Gemini' };
const SKIN_DOT_COLORS = { privilege: '#0073e6', claude: '#d97941', 'claude-terminal': '#ffb454', gpt: '#10a37f', gemini: '#4285f4' };

const INITIAL_MESSAGES = [
  { role: 'agent', text: "Hello! I'm your digital assistant. I can access your MileagePlus account and help manage your upcoming flights. What would you like to do today?" },
];

const DEFAULT_GATES = [
  { id: 'mfa',   name: 'AuthN: MFA Required',       desc: 'BFF checks acr claim · /multi_factor/ regex', icon: '🔐', status: 'waiting' },
  { id: 'gw',    name: 'Gateway: Token Validation',  desc: 'Audience · act claim · RFC 7662 introspection', icon: '🪟', status: 'waiting' },
  { id: 'authz', name: 'PingOne Authorize',           desc: 'Policy: agent identity · loyalty tier · action scope', icon: '✅', status: 'waiting' },
];

function deriveGates(events) {
  const gates = DEFAULT_GATES.map((g) => ({ ...g }));
  const ids = new Set(events.map((e) => e.id));
  const statuses = Object.fromEntries(events.map((e) => [e.id, e.status]));

  // Status words are the ones the BFF actually sends: the agent lookup is
  // `active`, gateway introspection is `valid`, the Authorize verdict is
  // `permit` or `deny`.
  const ok = (status) => ['success', 'valid', 'active', 'permit'].includes(status);

  // Gate 0 — MFA. The BFF only looks the agent up after the MFA check passes.
  if (ok(statuses['personal-agent-lookup']) || ok(statuses.mfa)) gates[0].status = 'permit';

  // Gate 1 — Gateway token validation (introspection).
  if (ids.has('mcp-tool-invoked')) gates[1].status = 'checking';
  if (ids.has('gw-introspection')) gates[1].status = ok(statuses['gw-introspection']) ? 'permit' : 'deny';

  // Gate 2 — PingOne Authorize. A verdict that is neither permit nor deny is a
  // held call (step-up or human approval), shown as still checking.
  if (ids.has('gw-authorize')) {
    const verdict = statuses['gw-authorize'];
    gates[2].status = verdict === 'permit' ? 'permit' : verdict === 'deny' ? 'deny' : 'checking';
  }
  if (ids.has('resource-server-reply') || ids.has('mcp-tool-result')) gates[2].status = 'permit';
  return gates;
}

function extractActClaim(events) {
  const exchEvent = events.find((e) => e.id === 'mcp-exchange' || e.id === 'personal-agent-lookup');
  if (!exchEvent || !exchEvent.token) return null;
  const claims = exchEvent.token?.claims;
  if (!claims?.act) return null;
  return { sub: claims.sub || '…', act: claims.act, scope: claims.scope || '', acr: claims.acr || '' };
}

// Layout state → CSS
const LAYOUT_STYLES = {
  full:   { agentFlex: '1',    railWidth: '0',     railVisible: false, placeholderVisible: false },
  split:  { agentFlex: '0 0 55%', railWidth: '45%', railVisible: true,  placeholderVisible: false },
  popped: { agentFlex: '0 0 280px', railWidth: 'auto', railVisible: true, placeholderVisible: true },
};

export default function PersonalAgentStudioPage({ scenario, vertical: selectedVertical, runNonce = 0 }) {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const routeId = query.get('useCase');
  const routeVertical = query.get('vertical');
  const vertical = selectedVertical || routeVertical || 'airlines';
  const routeContextKey = routeVertical && ['UC38', 'UC44'].includes(routeId) ? `${routeId}:${vertical}` : null;
  const [routeScenario, setRouteScenario] = useState(null);
  const workloadScenario = scenario || (routeScenario?.key === routeContextKey ? routeScenario.useCase : null);
  const [catalogLoadError, setCatalogLoadError] = useState(null);
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [runState, setRunState] = useState({ status: 'idle', text: '' });
  const [layoutState, setLayoutState] = useState('full');
  const [activeSkin, setActiveSkin] = useState('privilege');
  const [theme, setTheme] = useState('dark');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [replayGates, setReplayGates] = useState(null);
  const replayTimer = useRef(null);
  const activeWorkloadRun = useRef(null);
  const workloadContextKey = workloadScenario
    ? `${workloadScenario.id}:${workloadScenario.useCaseId}:${vertical}:${workloadScenario.runPrompt}`
    : null;

  const tokenChain = useTokenChainOptional();
  const setTokenEvents = tokenChain?.setTokenEvents;
  const events = tokenChain?.events || [];
  const gates = deriveGates(events);
  const actClaim = extractActClaim(events);

  useEffect(() => {
    if (scenario || !routeContextKey) return;
    let live = true;
    setCatalogLoadError(null);
    apiClient.get(`/api/use-cases/${routeId}?vertical=${encodeURIComponent(vertical)}`)
      .then(({ data }) => { if (live) setRouteScenario({ key: routeContextKey, useCase: data.useCase }); })
      .catch(() => { if (live) setCatalogLoadError(routeContextKey); });
    return () => { live = false; };
  }, [scenario, routeId, routeContextKey, vertical, catalogLoadAttempt]);

  useEffect(() => {
    setRunState({ status: 'idle', text: '' });
    return () => {
      activeWorkloadRun.current?.abort();
      activeWorkloadRun.current = null;
    };
  }, [workloadContextKey]);

  const executeWorkload = useCallback((uc) => {
    if (!uc?.runPrompt || !uc?.useCaseId) return;
    activeWorkloadRun.current?.abort();
    const controller = new AbortController();
    activeWorkloadRun.current = controller;
    const isCurrentRun = () => activeWorkloadRun.current === controller && !controller.signal.aborted;
    tokenChainTraceStore.beginTrace({ prompt: uc.runPrompt });
    setTokenEvents?.(uc.primaryTool, []);
    setRunState({ status: 'running', text: '' });
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({ prompt: uc.runPrompt, vertical, useCaseId: uc.useCaseId }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!isCurrentRun()) return null;
      if (Array.isArray(data.tokenEvents)) setTokenEvents?.(uc.primaryTool, data.tokenEvents);
      if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
      return data;
    }).then((data) => {
      if (!isCurrentRun()) return;
      // The BFF answers 200 with step_up_required when the sign-in had no MFA.
      if (data.step_up_required) setRunState({ status: 'step-up', prompt: true, text: data.reply || 'Complete multi-factor authentication to continue.' });
      else setRunState({ status: 'complete', text: data.reply || 'The workload agent completed the request.' });
    }).catch((error) => {
      if (isCurrentRun()) setRunState({ status: 'error', text: error.message || 'The workload agent could not complete the request.' });
    });
  }, [vertical, setTokenEvents]);

  useEffect(() => {
    // stepup=done is what the BFF's step-up route appends on the way back.
    if (scenario && (runNonce > 0 || query.get('stepup') === 'done')) executeWorkload(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query is derived from location.search
  }, [runNonce, scenario, executeWorkload, location.search]);

  const handleSend = useCallback((text) => {
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt: text, vertical: 'airlines' }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: data.reply || 'The digital assistant completed the request.' },
      ]))
      .catch((error) => setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: error.message || 'The digital assistant could not complete the request.' },
      ]))
  }, []);

  function handlePopOut() {
    const url = `/personal-agent/client?skin=${activeSkin}&theme=${theme}`;
    window.open(url, '_blank', 'width=480,height=700,left=200,top=100,resizable=yes');
    setLayoutState('popped');
  }

  function handleReplay() {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    const base = DEFAULT_GATES.map((g) => ({ ...g, status: 'waiting' }));
    setReplayGates(base);
    [0, 1, 2].forEach((idx) => {
      replayTimer.current = setTimeout(() => {
        setReplayGates((prev) => {
          if (!prev) return null;
          const next = prev.map((g, i) => i === idx ? { ...g, status: 'permit' } : g);
          if (idx === 2) {
            setTimeout(() => setReplayGates(null), 1200);
          }
          return next;
        });
      }, 400 + idx * 400);
    });
  }

  // An absolute same-origin URL: the BFF drops the query from a bare path.
  const startStepUp = () => window.location.assign(`/api/auth/oauth/user/stepup?return_to=${encodeURIComponent(`${window.location.origin}${location.pathname}${location.search}`)}`);

  const layout = LAYOUT_STYLES[layoutState] || LAYOUT_STYLES.full;
  const workloadGates = workloadScenario && gates.map((gate, index) => {
    if (index === 0 && workloadScenario.id === 'UC44') return { ...gate, name: 'Customer attribution', desc: 'Customer remains sub; workload agent appears in act' };
    if (index === 2) return { ...gate, desc: 'Selected vertical action and policy' };
    return gate;
  });

  if (routeContextKey && !workloadScenario) return (
    <div className="workload-agents__run">
      {catalogLoadError === routeContextKey ? <>
        <p role="alert">The catalog action could not be loaded. Retry {routeId} for {vertical}, or choose another scenario or vertical.</p>
        <button type="button" onClick={() => setCatalogLoadAttempt((attempt) => attempt + 1)}>Retry loading {routeId}</button>
      </> : <p role="status">Loading {routeId} action for {vertical}…</p>}
    </div>
  );

  if (workloadScenario) return (
    <div className="workload-agents__run">
      <h3>{workloadScenario.id}: {workloadScenario.title}</h3>
      <p>{workloadScenario.id === 'UC38'
        ? 'Customer MFA is checked before this protected write. The registered workload agent acts only after step-up succeeds.'
        : 'This customer-data read keeps the signed-in customer as sub and the registered workload agent as act.'}</p>
      <p>Action: <strong>{workloadScenario.primaryTool}</strong> · Prompt: <strong>{workloadScenario.runPrompt}</strong></p>
      <button type="button" disabled={runState.status === 'running'} onClick={() => executeWorkload(workloadScenario)}>Run {workloadScenario.id} action</button>
      <button type="button" onClick={() => window.open(`/personal-agent/client?skin=${activeSkin}&theme=${theme}&useCase=${workloadScenario.id}&vertical=${encodeURIComponent(vertical)}`, '_blank', 'width=480,height=700,left=200,top=100,resizable=yes')}>🪟 Open client window</button>
      <p role="status" className="workload-agents__status">{runState.status === 'running' ? 'Running the selected action…' : runState.text || 'Ready to run the selected catalog action.'}</p>
      {runState.status === 'step-up' && (
        <button type="button" onClick={startStepUp}>Verify with MFA and run again</button>
      )}
      <ConfirmModal
        isOpen={runState.status === 'step-up' && runState.prompt === true}
        title="MFA required"
        message={runState.text}
        confirmLabel="Verify with MFA"
        cancelLabel="Not now"
        onConfirm={startStepUp}
        onCancel={() => setRunState((state) => ({ ...state, prompt: false }))}
      />
      <SecurityRail gates={workloadGates} actClaim={actClaim} tokenEvents={events} />
      {/* The filmstrip's two halves place themselves by grid-area name. */}
      <div className="workload-agents__chain"><TokenChainFilmstrip /></div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg, #0f1117)' }}>
      {/* Page header */}
      <div style={{ background: 'var(--surface, #1a1d27)', borderBottom: '1px solid var(--border, #2e3347)', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text, #e2e8f0)', marginRight: 8 }}>Digital Assistant</span>

        {/* Skin tabs */}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {SKINS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSkin(s)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${activeSkin === s ? 'var(--border, #2e3347)' : 'transparent'}`, background: activeSkin === s ? 'var(--surface2, #242838)' : 'transparent', fontSize: 12, fontWeight: 500, color: activeSkin === s ? 'var(--text, #e2e8f0)' : 'var(--muted, #8892a4)' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SKIN_DOT_COLORS[s], display: 'inline-block' }} />
              {SKIN_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button
            onClick={() => setLayoutState((s) => s === 'split' ? 'full' : 'split')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: `1px solid ${layoutState === 'split' ? 'var(--accent, #4f8ef7)' : 'var(--border, #2e3347)'}`, background: layoutState === 'split' ? 'rgba(79,142,247,0.15)' : 'transparent', color: layoutState === 'split' ? 'var(--accent, #4f8ef7)' : 'var(--muted, #8892a4)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            Split
          </button>
          <button
            onClick={handlePopOut}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: `1px solid ${layoutState === 'popped' ? 'var(--accent, #4f8ef7)' : 'var(--border, #2e3347)'}`, background: layoutState === 'popped' ? 'rgba(79,142,247,0.15)' : 'transparent', color: layoutState === 'popped' ? 'var(--accent, #4f8ef7)' : 'var(--muted, #8892a4)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            🪟 Pop Out
          </button>
          <button
            onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: '1px solid var(--border, #2e3347)', background: 'transparent', color: 'var(--muted, #8892a4)', fontSize: 12, cursor: 'pointer' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>

      <PersonalAgentClientCards />

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Agent panel */}
        <div style={{ flex: layout.agentFlex, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {layout.placeholderVisible ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, borderRight: '1px dashed var(--border, #2e3347)' }}>
              <div style={{ fontSize: 40 }}>👤</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e2e8f0)', textAlign: 'center' }}>Agent active in external window</div>
              <div style={{ fontSize: 12, color: 'var(--muted, #8892a4)', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
                The agent is running independently — just like a real user's AI client. Security gates on the right fire for every message it sends.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22c55e' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 1.5s infinite' }} />
                Live — receiving token events
                <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
              </div>
            </div>
          ) : (
            <AgentClientSkin
              skin={activeSkin}
              theme={theme}
              messages={messages}
              onSend={handleSend}
              showPopOutButton={false}
              onPopOut={handlePopOut}
            />
          )}
        </div>

        {/* Security rail */}
        {layout.railVisible && (
          <SecurityRail
            gates={replayGates || gates}
            actClaim={actClaim}
            tokenEvents={events}
            onReplay={handleReplay}
          />
        )}
      </div>

      {/* Movie reel — same TokenChainFilmstrip the dashboard uses, so a personal
          agent test shows the RFC 8693 delegation path it exercised. */}
      <div className="tcfs-float-host" style={{ flexShrink: 0, maxHeight: '45%' }}>
        <TokenChainFilmstrip />
      </div>
    </div>
  );
}
