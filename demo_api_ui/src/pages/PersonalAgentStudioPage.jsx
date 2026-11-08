// /personal-agent and /personal-agent/full (bare), plus the embedded scenario runner the Workload Agents and Digital
// Worker pages mount with a `scenario` prop.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md). Applied: P2 banner first (what is simulated, what is real), P5 kv (embedded action and
// prompt), P7 chips with a word (pop-out stub, embedded run state), P9 buttons, H3 no inline style.
// Skipped: P3 frame and P4 cards. The studio is a full-width workbench (chat beside the gates, reel and Token Chain,
// with a cockpit grid), not a 1100px document, and its numbered stacked sections already label the pipeline; the title
// band is the studio toolbar, so there is no PageHeader (it would push the reel below the fold on a 720px window).
//
// P9 "exactly one primary per view" is read per view state, and every button goes through PuButton (`lead`):
//   Agent tab, Claude/ChatGPT/Gemini/Terminal/Privilege/Dot skin -> no primary on the page. Send lives inside the
//                    simulated client (AgentClientSkin keeps that client's own look), not in the page chrome.
//   Agent tab, Computer Use skin -> "Run scripted session".
//   Add to ChatGPT / Claude and Delegation proof tabs -> the embedded flow (or the sign-in prompt) owns its primary.
//   Embedded scenario: "Run ... action"; once a step-up is needed, "Verify with MFA and run again" takes over;
//                    catalog load failed -> "Retry loading".
// A busy Run stays focusable (aria-disabled), so keyboard focus is not thrown to the page when it starts.
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import apiClient from '../services/apiClient';
import AgentClientSkin from '../components/AgentClientSkin';
import ConfirmModal from '../components/ConfirmModal';
import OtpStepUpModal from '../components/OtpStepUpModal';
import PersonalAgentClientCards from '../components/learning/PersonalAgentClientCards';
import DotMemoryPanel from '../components/DotMemoryPanel';
import DotPersonaStrip from '../components/DotPersonaStrip';
import { governanceFrom } from '../utils/dotGovernance';
import { studioSuggestions, studioGreeting } from '../config/dotSuggestions';
import { useVertical } from '../vertical/useVertical';
import VerticalSwitcher from '../components/VerticalSwitcher';
import SecurityRail from '../components/SecurityRail';
import TokenChainFilmstrip from '../components/TokenChainFilmstrip';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import InlineSpinner from '../components/shared/InlineSpinner';
import OboDemoPage from './OboDemoPage';
import ConnectorFlow from '../components/ConnectorFlow';
import SignInPrompt from '../components/SignInPrompt';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { PERSONAL_AGENT_SEQUENCE_DETAILS, PERSONAL_AGENT_SEQUENCE_PAYLOADS, PERSONAL_AGENT_SEQUENCE_SOURCE, personalAgentMessageForReelStep } from '../config/personalAgentSequenceFlow';
import { protectedActionLabel } from './protectedActionLabel';
import { openMcpFlowSse } from '../services/mcpFlowSseClient';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import GateChips from '../components/GateChips';
import TokenCards, { hasTokenCards } from '../components/TokenCards';
import { PingPage, SimBanner, StatusChip, KvList } from '../components/pingUi';
import './PersonalAgentStudioPage.css';

const SKINS = ['privilege', 'claude', 'claude-terminal', 'gpt', 'gemini', 'cua', 'dot'];
const SKIN_LABELS = { privilege: 'Privilege', claude: 'Claude', 'claude-terminal': 'Terminal', gpt: 'ChatGPT', gemini: 'Gemini', cua: 'Computer Use', dot: 'Persona Agent (Dot)' };

// Scripted CUA session (coverage plan row: present a computer-use agent without
// driving a real browser). Each step is a labeled observe/act pair that rides the
// SAME /api/agent/invoke path as freeform chat, so the gateway/token chain fires
// on the rail exactly as it does for the MCP skins. Simulated — the labels say so.
const CUA_SCRIPT = [
  { step: 1, act: 'observe', prompt: '[CUA step 1 · observe] read the account summary screen' },
  { step: 2, act: 'act', prompt: '[CUA step 2 · act] click the miles balance tile' },
  { step: 3, act: 'observe', prompt: '[CUA step 3 · observe] read the confirmation banner' },
];

const INITIAL_MESSAGES = [
  { role: 'agent', text: "Hello! I'm your digital assistant. I can access your MileagePlus account and help manage your upcoming flights. What would you like to do today?" },
];

const DEFAULT_GATES = [
  { id: 'mfa',   name: 'AuthN: MFA Required',       desc: 'BFF checks acr claim · /multi_factor/ regex', icon: '🔐', status: 'waiting' },
  { id: 'gw',    name: 'Gateway: Token Validation',  desc: 'Audience · act claim · RFC 7662 introspection', icon: '🪟', status: 'waiting' },
  { id: 'authz', name: 'PingOne Authorize',           desc: 'Policy: agent identity · loyalty tier · action scope', icon: '✅', status: 'waiting' },
];

// Exported so the standalone learning page (/personal-agent/learn) reads the same real gate logic.
export function deriveGates(events) {
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

export function extractActClaim(events) {
  const exchEvent = events.find((e) => e.id === 'mcp-exchange' || e.id === 'personal-agent-lookup');
  if (!exchEvent || !exchEvent.token) return null;
  const claims = exchEvent.token?.claims;
  if (!claims?.act) return null;
  return { sub: claims.sub || '…', act: claims.act, scope: claims.scope || '', acr: claims.acr || '' };
}

// Layout state: which panels show. The widths live in the stylesheet (.pas-agent--full|split|popped).
const LAYOUT_STYLES = {
  full:   { railVisible: false, placeholderVisible: false },
  split:  { railVisible: true,  placeholderVisible: false },
  popped: { railVisible: true,  placeholderVisible: true },
};

// The embedded status line (scenario mode): the word on the chip, and its tone, per run state.
const RUN_CHIPS = {
  idle: { tone: 'neutral', word: 'Ready' },
  running: { tone: 'info', word: 'Running' },
  complete: { tone: 'ok', word: 'Done' },
  error: { tone: 'danger', word: 'Failed' },
  'step-up': { tone: 'warn', word: 'MFA needed' },
  approval: { tone: 'warn', word: 'Approval needed' },
};

export default function PersonalAgentStudioPage({ scenario, vertical: selectedVertical, runNonce = 0, user = null, consentGate = null, reelEmptyState = undefined, bare = false }) {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const routeId = query.get('useCase');
  const routeVertical = query.get('vertical');
  // The vertical the chat talks to: an explicit prop or ?vertical= first, then the app's ACTIVE vertical (the picker in
  // this page's header and the top bar both set it), then the airline demo this page was built around.
  const { activeId, pageManifest } = useVertical();
  const vertical = selectedVertical || routeVertical || activeId || 'airlines';
  const routeContextKey = routeVertical && ['UC38', 'UC44'].includes(routeId) ? `${routeId}:${vertical}` : null;
  const [routeScenario, setRouteScenario] = useState(null);
  const workloadScenario = scenario || (routeScenario?.key === routeContextKey ? routeScenario.useCase : null);
  const [catalogLoadError, setCatalogLoadError] = useState(null);
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [runState, setRunState] = useState({ status: 'idle', text: '' });
  const [mfaChallenge, setMfaChallenge] = useState(null);
  // A freeform Dot question that came back 428 (consent required) and is waiting for PingOne MFA, then a retry.
  const [consentRetry, setConsentRetry] = useState(null);
  const [layoutState, setLayoutState] = useState('full');
  const [activeSkin, setActiveSkin] = useState(() => {
    const skin = query.get('skin');
    return SKINS.includes(skin) ? skin : 'privilege';
  });
  // 'obo' swaps the chat for the RFC 8693 delegation inspector (deep link: ?tab=obo).
  // 'connector' = the 12-step "add this MCP server to ChatGPT/Claude" flow (deep link: ?tab=connector).
  const [view, setView] = useState(['obo', 'connector'].includes(query.get('tab')) ? query.get('tab') : 'agent');
  const [agentMode, setAgentMode] = usePageAgentMode('personal-agent', 'heuristics');
  // 'stacked' (chat, then the reel and Token Chain under it) or 'cockpit' (chat left; gates, flow, reel and
  // Token Chain right; client dock along the bottom). Deep link ?layout=cockpit; the choice is remembered per browser.
  const [layoutMode, setLayoutMode] = useState(() => {
    const asked = query.get('layout');
    if (asked === 'stacked' || asked === 'cockpit') return asked;
    try { if (window.localStorage.getItem('pas-layout') === 'cockpit') return 'cockpit'; } catch (_e) { /* storage blocked: default */ }
    return 'stacked';
  });
  const cockpit = layoutMode === 'cockpit' && view === 'agent';
  const stacked = layoutMode !== 'cockpit' && view === 'agent';
  const chooseLayout = useCallback((mode) => {
    setLayoutMode(mode);
    try { window.localStorage.setItem('pas-layout', mode); } catch (_e) { /* storage blocked: still switches */ }
  }, []);
  const [theme, setTheme] = useState('dark');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  // The opening line follows the vertical (the airline one names MileagePlus), wherever it sits in the history.
  const chatMessages = useMemo(
    () => messages.map((m) => (m === INITIAL_MESSAGES[0] ? { ...m, text: studioGreeting(vertical) } : m)),
    [messages, vertical],
  );
  const [dotMemoryNonce, setDotMemoryNonce] = useState(0);
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

  // True between a "yes" on the consent phone and the gateway's approval gate for that same run.
  const phoneApproved = useRef(false);
  const decideRef = useRef(null);
  const executeWorkload = useCallback((uc, approvedChallengeId = null) => {
    if (!uc?.runPrompt || !uc?.useCaseId) return;
    activeWorkloadRun.current?.abort();
    const controller = new AbortController();
    activeWorkloadRun.current = controller;
    const isCurrentRun = () => activeWorkloadRun.current === controller && !controller.signal.aborted;
    // Without a flowTraceId the BFF has no stream to publish this run's authorize decision and tool result to, so the
    // proof check never saw them and read "incomplete" after a run that actually finished.
    const flowTraceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    tokenChainTraceStore.beginTrace({ prompt: uc.runPrompt, flowTraceId });
    const closeSse = openMcpFlowSse(flowTraceId, (event) => {
      if (event?.type === 'token-event') {
        const { type, ...tokenEvent } = event;
        try { tokenChainTraceStore.ingestTokenEvent({ ...tokenEvent, flowTraceId }); } catch (_) { /* display-only */ }
      }
      if (event?.type === 'mcp-result') {
        try { window.dispatchEvent(new CustomEvent('mcp-tool-result-sse', { detail: { ...event, flowTraceId } })); } catch (_) { /* display-only */ }
      }
    });
    // The stream lags the HTTP reply slightly: keep it open briefly so the tool result still lands.
    const settle = (ok, failure = null) => {
      try { tokenChainTraceStore.completeTrace(ok, flowTraceId, failure); } catch (_) { /* display-only */ }
      setTimeout(closeSse, 3000);
    };
    setTokenEvents?.(uc.primaryTool, []);
    setRunState({ status: 'running', text: '' });
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      // An approved challenge id is what lets the retry through the gateway's approval gate.
      body: JSON.stringify({ prompt: uc.runPrompt, vertical, useCaseId: uc.useCaseId, agentMode, flowTraceId, ...(approvedChallengeId ? { hitlChallengeId: approvedChallengeId } : {}) }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!isCurrentRun()) return null;
      if (Array.isArray(data.tokenEvents)) setTokenEvents?.(uc.primaryTool, data.tokenEvents);
      if (data.mcpAuthorizeEvaluation) tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation, flowTraceId);
      if (data.mcpAuthorizeEvaluations) tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations);
      if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
      return data;
    }).then((data) => {
      if (!isCurrentRun()) return;
      // The BFF answers 200 with step_up_required when the sign-in had no MFA.
      if (data.step_up_required) setRunState({ status: 'step-up', prompt: true, text: data.reply || 'Complete multi-factor authentication to continue.' });
      // Human approval: the reply carries the challenge to approve or decline.
      else if (data.error === 'hitl_required' && (data.hitlChallengeId || data.challengeId)) {
        const challengeId = data.hitlChallengeId || data.challengeId;
        // The consent phone already got this person's yes for this run: record it on the gateway's challenge instead of asking again.
        if (phoneApproved.current) { phoneApproved.current = false; decideRef.current?.('approve', challengeId); }
        else setRunState({ status: 'approval', prompt: true, challengeId, text: data.reply || 'This action requires your approval.' });
      }
      // success:false is a refusal or a failed run, not a completed action.
      else if (data.success === false) { settle(false, data.reply); setRunState({ status: 'error', text: data.reply || 'The workload agent could not complete the request.' }); }
      else { settle(true); setRunState({ status: 'complete', text: data.reply || 'The workload agent completed the request.' }); }
    }).catch((error) => {
      if (isCurrentRun()) { settle(false, error.message); setRunState({ status: 'error', text: error.message || 'The workload agent could not complete the request.' }); }
      else closeSse();
    });
  }, [vertical, setTokenEvents, agentMode]);

  useEffect(() => {
    // stepup=done is what the BFF's step-up route appends on the way back.
    if (scenario && (runNonce > 0 || query.get('stepup') === 'done')) executeWorkload(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query is derived from location.search
  }, [runNonce, scenario, executeWorkload, location.search]);

  // In-app MFA: a passkey registered for this app's domain works here and
  // cannot work on PingOne's hosted page.
  const startChallenge = useCallback(async () => {
    const response = await fetch('/api/auth/mfa/challenge', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`MFA initiation failed: ${response.status}`);
    const { daId, devices } = await response.json();
    const challenge = { daId, devices: devices || [] };
    setMfaChallenge(challenge);
    return challenge;
  }, []);

  const handleSend = useCallback((text, { retry = false } = {}) => {
    if (!retry) setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    tokenChainTraceStore.beginTrace({ prompt: text });
    setTokenEvents?.(null, []);
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt: text, vertical, agentMode }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 428 && data.requiresConsent) throw Object.assign(new Error(data.message || 'This needs your approval.'), { consent: true });
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => {
        if (Array.isArray(data.tokenEvents)) setTokenEvents?.(data.toolsCalled?.[0] || null, data.tokenEvents);
        setMessages((prev) => [
          ...prev.filter((m) => !m.typing),
          { role: 'agent', text: data.reply || 'The digital assistant completed the request.', dotMemories: data.dotMemories, governance: governanceFrom(data) },
        ]);
        // The dot learned something this turn — refresh its memory panel.
        if (Array.isArray(data.dotMemories) && data.dotMemories.length > 0) setDotMemoryNonce((n) => n + 1);
      })
      .catch((error) => {
        if (error.consent) {
          // Consent required: PingOne MFA is the approval. Start the challenge now; finishing it asks again.
          setMessages((prev) => [...prev.filter((m) => !m.typing), { role: 'agent', text: `${error.message} Verify with PingOne MFA to continue.` }]);
          setConsentRetry({ prompt: text });
          startChallenge().catch(() => {
            setConsentRetry(null);
            setMessages((prev) => [...prev, { role: 'agent', text: 'MFA could not be started. Try the request again.' }]);
          });
          return;
        }
        setMessages((prev) => [
          ...prev.filter((m) => !m.typing),
          { role: 'agent', text: error.message || 'The digital assistant could not complete the request.' },
        ]);
      });
  }, [agentMode, startChallenge, setTokenEvents, vertical]);

  // Scripted CUA run: the same invoke path as handleSend, each step labeled as a
  // computer-use action, sequenced so the token chain shows the full path.
  const runCuaScript = useCallback(() => {
    CUA_SCRIPT.forEach((step, index) => {
      setTimeout(() => handleSend(step.prompt), index * 900);
    });
  }, [handleSend]);

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

  // Fallback only: PingOne's hosted page. An absolute same-origin URL, because
  // the BFF drops the query from a bare path.
  const hostedStepUp = () => window.location.assign(`/api/auth/oauth/user/stepup?return_to=${encodeURIComponent(`${window.location.origin}${location.pathname}${location.search}`)}`);
  // In-app MFA: a passkey registered for this app's domain works here and
  // cannot work on PingOne's hosted page.
  const startStepUp = () => {
    setRunState((state) => ({ ...state, prompt: false }));
    startChallenge().catch(hostedStepUp);
  };
  // Approve or decline through the same decision endpoint the chat agent uses,
  // then retry the action carrying the approved challenge.
  const decideApproval = (decision, challengeId = runState.challengeId) => {
    setRunState({ status: 'running', text: '' });
    fetch(`/api/mcp/decision/${encodeURIComponent(challengeId)}/${decision}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || `The decision could not be recorded (${response.status})`);
        if (decision === 'approve') executeWorkload(workloadScenario, challengeId);
        else setRunState({ status: 'error', text: 'Declined. The action was not run.' });
      })
      .catch((error) => setRunState({ status: 'error', text: error.message }));
  };
  decideRef.current = decideApproval;
  const finishStepUp = () => {
    setMfaChallenge(null);
    if (consentRetry) {
      const { prompt } = consentRetry;
      setConsentRetry(null);
      handleSend(prompt, { retry: true });
      return;
    }
    executeWorkload(workloadScenario);
  };

  const mfaModal = (
    <OtpStepUpModal
      show={Boolean(mfaChallenge)}
      mode="p1mfa"
      allowFido
      contextLine={workloadScenario ? `${workloadScenario.id}: ${workloadScenario.runPrompt}` : (consentRetry?.prompt || '')}
      daId={mfaChallenge?.daId}
      devices={mfaChallenge?.devices}
      onP1MfaComplete={finishStepUp}
      onPasskeyRegistered={startChallenge}
      onSubmit={() => {}}
      onCancel={() => { setMfaChallenge(null); setConsentRetry(null); }}
    />
  );

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
        <PuButton lead onClick={() => setCatalogLoadAttempt((attempt) => attempt + 1)}>Retry loading {routeId}</PuButton>
      </> : <p><InlineSpinner label={`Loading ${routeId} action for ${vertical}…`} /></p>}
    </div>
  );

  // Optional consent step in front of the visible Run button (the digital worker page asks on a mock phone).
  // consentGate(uc) -> Promise<boolean>. Only this click is gated: the run-nonce effect, the MFA return and the
  // HITL re-run continue a run someone already agreed to, so they call executeWorkload directly and never re-ask.
  const runWithConsent = async (uc) => {
    phoneApproved.current = false;
    if (consentGate) {
      if (!(await consentGate(uc))) return;
      phoneApproved.current = true;
    }
    executeWorkload(uc);
  };

  if (workloadScenario) return (
    <div className="workload-agents__run">
      <h3>{workloadScenario.id === 'UC38' ? workloadScenario.title : `${workloadScenario.id}: ${workloadScenario.title}`}</h3>
      <p>{workloadScenario.id === 'UC38'
        ? 'Customer MFA is checked before this protected write. The registered workload agent acts only after step-up succeeds.'
        : 'This customer-data read keeps the signed-in customer as sub and the registered workload agent as act.'}</p>
      <KvList items={[
        { label: 'Action', value: workloadScenario.primaryTool, mono: true },
        { label: 'Prompt', value: workloadScenario.runPrompt },
      ]} />
      <PuButton lead={runState.status !== 'step-up'} busy={runState.status === 'running'} onClick={() => runWithConsent(workloadScenario)}>{workloadScenario.id === 'UC38' ? `Run ${protectedActionLabel(workloadScenario)}` : `Run ${workloadScenario.id} action`}</PuButton>
      <PuButton onClick={() => window.open(`/personal-agent/client?skin=${activeSkin}&theme=${theme}&useCase=${workloadScenario.id}&vertical=${encodeURIComponent(vertical)}`, '_blank', 'width=480,height=700,left=200,top=100,resizable=yes')}>🪟 Open client window</PuButton>
      <div className="pu-status-line">
        <StatusChip tone={(RUN_CHIPS[runState.status] || RUN_CHIPS.idle).tone}>{(RUN_CHIPS[runState.status] || RUN_CHIPS.idle).word}</StatusChip>
        <p role={runState.status === 'error' ? 'alert' : 'status'} className={`workload-agents__status${runState.status === 'error' ? ' workload-agents__status--error' : ''}`}>{runState.status === 'running' ? 'Running the selected action…' : runState.text || 'Ready to run the selected catalog action.'}</p>
      </div>
      {runState.status === 'step-up' && (
        <PuButton lead onClick={startStepUp}>Verify with MFA and run again</PuButton>
      )}
      <ConfirmModal
        isOpen={runState.status === 'approval' && runState.prompt === true}
        title="Approval required"
        message={`${runState.text} ${workloadScenario.runPrompt}`}
        confirmLabel="Approve"
        cancelLabel="Decline"
        onConfirm={() => decideApproval('approve')}
        onCancel={() => decideApproval('deny')}
      />
      <ConfirmModal
        isOpen={runState.status === 'step-up' && runState.prompt === true}
        title="MFA required"
        message={runState.text}
        confirmLabel="Verify with MFA"
        cancelLabel="Not now"
        onConfirm={startStepUp}
        onCancel={() => setRunState((state) => ({ ...state, prompt: false }))}
      />
      {mfaModal}
      <SecurityRail gates={workloadGates} actClaim={actClaim} />
      {/* The filmstrip's two halves place themselves by grid-area name. */}
      <div className="workload-agents__chain"><TokenChainFilmstrip emptyState={reelEmptyState} /></div>
    </div>
  );

  return (
    // P2 banner first, then the studio. The studio is a full-width workbench (chat beside gates, reel and
    // Token Chain), so it keeps its own shell instead of the 1100px frame; see the header comment.
    <PingPage className={`pas-page${bare ? ' pas-page--bare' : ''}`}>
    <SimBanner data-testid="studio-banner">
      <strong>SIMULATED CLIENTS, REAL GOVERNANCE</strong> — the Claude, ChatGPT, Gemini, Terminal and Computer Use
      windows are look-alikes, and the Add to ChatGPT / Claude tab uses a connector sandbox: no vendor product is
      connected. Your messages go to this machine's BFF and the demo's own agent, so the gates and tokens below come
      from your signed-in session. The gate Replay is an animation.
    </SimBanner>
    {/* A fixed-height shell (same rule as the IDE sheet, .cur-ide): chat flexes, the reel stays under it.
        height:'100%' had no definite parent to resolve against, so the page grew to ~1600px and the reel sat far below the fold.
        Bare (/personal-agent/full) has no app chrome to subtract. */}
    <div data-testid="studio-shell" className={`pas-shell${cockpit ? ' pas-shell--cockpit' : stacked ? ' pas-shell--stacked' : ''}${bare ? ' pas-shell--bare' : ''}`}>
      {/* Page header */}
      <div className="pas-c-header">
        <h1 className="pas-title">Digital Assistant</h1>

        {/* View tabs */}
        <div role="tablist" className="pas-tabs">
          {[['agent', 'Agent'], ['connector', 'Add to ChatGPT / Claude'], ['obo', 'Delegation proof (OBO)']].map(([id, label]) => (
            <PuButton
              key={id}
              role="tab"
              aria-selected={view === id}
              className="pas-compact"
              onClick={() => setView(id)}
            >
              {label}
            </PuButton>
          ))}
        </div>

        {/* Skin tabs */}
        {view === 'agent' && <div className="pas-skins">
          {SKINS.map((s) => (
            <PuButton
              key={s}
              aria-pressed={activeSkin === s}
              className="pas-compact pas-pill"
              onClick={() => setActiveSkin(s)}
            >
              <span className={`pas-dot pas-dot--${s}`} aria-hidden="true" />
              {SKIN_LABELS[s]}
            </PuButton>
          ))}
        </div>}

        {/* Actions */}
        {view === 'agent' && <div className="pas-header-actions">
          <span className="pas-vertical" title="The vertical the agent works in: its tools, policies and sample prompts">
            <span className="pas-vertical__label">Vertical</span>
            <VerticalSwitcher variant="nav" />
          </span>
          <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
          <div className="pas-layout-switch" role="group" aria-label="Page layout">
            <PuButton className="pas-compact" aria-pressed={layoutMode === 'stacked'} onClick={() => chooseLayout('stacked')}>Stacked</PuButton>
            <PuButton className="pas-compact" aria-pressed={layoutMode === 'cockpit'} onClick={() => chooseLayout('cockpit')}>Cockpit</PuButton>
          </div>
          {!cockpit && <PuButton className="pas-compact" aria-pressed={layoutState === 'split'} onClick={() => setLayoutState((s) => s === 'split' ? 'full' : 'split')}>
            Split
          </PuButton>}
          <PuButton className={`pas-compact${layoutState === 'popped' ? ' pas-on' : ''}`} onClick={handlePopOut}>
            🪟 Pop Out
          </PuButton>
          <PuButton
            className="pas-compact"
            onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </PuButton>
        </div>}
      </div>

      {view === 'connector' ? (
        <div className="pas-c-view">
          {user ? <ConnectorFlow /> : <SignInPrompt message="The connector flow runs on your signed-in session." />}
        </div>
      ) : view === 'obo' ? (
        <div className="pas-c-view">
          {user ? <OboDemoPage /> : <SignInPrompt message="The delegation proof runs on your signed-in session." />}
        </div>
      ) : (<>
      {/* Content area */}
      <div className="pas-c-chat">
        {/* Agent panel */}
        <div className={`pas-agent pas-agent--${layoutState}`}>
          {layout.placeholderVisible ? (
            <div className="pas-popped">
              <div className="pas-popped__icon" aria-hidden="true">👤</div>
              <div className="pas-popped__title">Agent active in external window</div>
              <div className="pas-popped__text">
                The agent is running independently — just like a real user's AI client. Security gates on the right fire for every message it sends.
              </div>
              <StatusChip tone="info">Listening for token events</StatusChip>
            </div>
          ) : (
            activeSkin === 'cua' ? (
              <div className="pas-skin">
                <div className="pas-cua-bar">
                  <PuButton lead onClick={runCuaScript}>
                    Run scripted session
                  </PuButton>
                  <span className="pu-note pas-cua-bar__note">
                    Simulated — a real CUA drives a browser; this walks the same actions through the demo's governed agent path, so the token chain on the rail is the real one.
                  </span>
                </div>
                <div className="pas-skin__body">
                  <AgentClientSkin
                    skin={activeSkin}
                    theme={theme}
                    messages={chatMessages}
                    onSend={handleSend}
                    showPopOutButton={false}
                    onPopOut={handlePopOut}
                  />
                </div>
              </div>
            ) : (
              <div className="pas-skin pas-skin--fill">
                {activeSkin === 'dot' && <DotPersonaStrip theme={theme} mode={agentMode} />}
                <div className="pas-skin__body">
                  <AgentClientSkin
                    skin={activeSkin}
                    theme={theme}
                    messages={chatMessages}
                    onSend={handleSend}
                    suggestions={studioSuggestions(activeSkin, vertical, pageManifest)}
                    showPopOutButton={false}
                    onPopOut={handlePopOut}
                  />
                </div>
              </div>
            )
          )}
        </div>

        {/* Security rail (split/popped layouts) + the dot's own memory panel
            when the Dot skin is active — the panel is the feature, so it shows
            in every layout, not only when the rail does. */}
        {layout.railVisible && (
          <SecurityRail
            gates={replayGates || gates}
            actClaim={actClaim}
            onReplay={handleReplay}
          />
        )}
        {activeSkin === 'dot' && <DotMemoryPanel refreshNonce={dotMemoryNonce} />}
      </div>

      {/* Movie reel — same TokenChainFilmstrip the dashboard uses, so a personal
          agent test shows the RFC 8693 delegation path it exercised. */}
      {cockpit && <GateChips className="pas-c-gates" gates={replayGates || gates} />}
      {view === 'agent' && (
        <details className="pas-c-flow">
          <summary>Expand for Diagram</summary>
          <p className="pu-note pas-flow-link"><Link to="/personal-agent-flow">Open the diagram on its own page</Link></p>
          <div className="pas-flow-scroll">
            <SequenceFlowDiagram
              source={PERSONAL_AGENT_SEQUENCE_SOURCE}
              details={PERSONAL_AGENT_SEQUENCE_DETAILS}
              payloads={PERSONAL_AGENT_SEQUENCE_PAYLOADS}
              reelSync={personalAgentMessageForReelStep}
              label="How ChatGPT accesses member benefits: CIMD discovery, IdP consent, P1AZ authorization and permitted MCP access"
            />
          </div>
        </details>
      )}
      {/* Stacked: the reel on top, the long token-chain detail under it at full width. An inline
          maxHeight:'45%' used to cap this, but a % can't resolve in this column, so the block grew
          to ~670px and the fixed-height page clipped it. The class's vh cap does the job. */}
      <div className="tcfs-float-host tcfs-float-host--stacked pas-c-reel">
        <TokenChainFilmstrip emptyState={hasTokenCards(events) ? <TokenCards events={events} variant={cockpit ? 'rows' : 'cards'} /> : undefined} />
      </div>
      </>)}
      {cockpit && <PersonalAgentClientCards variant="dock" />}
      {mfaModal}
    </div>
    {/* The client cards sit BELOW the fixed-height shell (the page scrolls to them): inside it they took ~500px of the
        column and were clipped, squeezing the reel. */}
    {view === 'agent' && !cockpit && <div className="pas-c-cards"><PersonalAgentClientCards /></div>}
    </PingPage>
  );
}

// Every button on the page goes through here, so the one-primary rule has one place to read (`lead`).
// A busy button stays focusable (aria-disabled, not disabled) so keyboard focus is not thrown to the page
// when a Run starts; the click is ignored while busy.
function PuButton({ lead = false, busy = false, onClick, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`${lead ? 'pu-btn pu-btn--primary' : 'pu-btn'} ${className}`.trim()}
      aria-disabled={busy ? 'true' : undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
