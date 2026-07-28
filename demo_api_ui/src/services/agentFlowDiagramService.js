// banking_api_ui/src/services/agentFlowDiagramService.js
/**
 * Live state for the Agent → BFF → token exchange → MCP → tool flow diagram.
 * Updated from bankingAgentService (MCP tools) and BankingAgent (inspector tools/list).
 */

/** @typedef {'pending'|'active'|'done'|'error'} FlowStepStatus */

const listeners = new Set();

/** Max rows in the live server timeline (SSE). */
const MAX_SERVER_EVENTS = 40;

/** Human labels for BFF `phase` values (no secrets). */
const PHASE_LABELS = {
  request_accepted: 'BFF accepted MCP tool request',
  resolving_access_token: 'Resolving session token / RFC 8693 exchange',
  access_token_ready: 'Token ready for MCP proxy',
  access_token_error: 'Token resolution failed',
  no_bearer_token_branch: 'No bearer — evaluating local handler path',
  no_bearer_no_user: 'No bearer and no session user',
  local_tool_start: 'Running local tool handler',
  local_tool_done: 'Local handler finished',
  local_tool_error: 'Local handler error',
  authorize_gate_begin: 'PingOne Authorize gate (first tool)',
  authorize_denied: 'Authorize denied or step-up required',
  authorize_permitted: 'Authorize permitted',
  authorize_gate_skipped: 'Authorize gate skipped (already done, admin, or feature off)',
  authorize_simulated_error: 'Simulated authorize error',
  authorize_unavailable: 'PingOne Authorize unavailable',
  authorize_internal_error: 'Authorize gate internal error',
  introspection_begin: 'Session token introspection',
  introspection_skipped_no_session_token: 'Introspection skipped — no session bearer',
  introspection_inactive: 'Introspection: token inactive',
  introspection_active_ok: 'Introspection: token active',
  introspection_error_degraded: 'Introspection error (continuing)',
  introspection_not_configured: 'Introspection not configured',
  mcp_remote_skipped_vercel: 'Remote MCP skipped (serverless default)',
  mcp_remote_begin: 'MCP WebSocket tools/call',
  mcp_remote_done: 'MCP WebSocket call completed',
  mcp_remote_tool_error: 'MCP tool error (not connection)',
  mcp_remote_unreachable: 'MCP server unreachable',
  local_fallback_blocked_no_user: 'Local fallback blocked — no user',
  stream_end: 'Stream closed',
  mfa_challenge_initiated: 'HITL — MFA challenge initiated, awaiting your manual approval',
  mfa_challenge_completed: 'HITL approved — MFA step-up verified',
  mfa_challenge_failed: 'HITL — MFA challenge failed or expired',
  mfa_challenge_skipped: 'MFA step-up not required (below threshold)',
};

/** @type {{ visible: boolean, phase: string, toolName: string|null, steps: Array<{id: string, title: string, detail: string, status: FlowStepStatus}>, serverEvents: Array<{ phase: string, label: string, detail: string, t?: number }>, hint: string|null, updatedAt: number }} */
const COMPLIANCE_STEPS = [
  // Ordered by agent flow: step 1 → 2 → 4b → 4d → 5 → 5a → 6 → 7 → 8 → 9 → 12 → 12a
  { id: 'agent-token-init',       label: '1.     Agent starts — gets client credentials token', explanation: 'BFF obtains a client-credentials token for the agent to use when calling MCP tools. This is the agent\'s identity, separate from the user\'s login token.', status: 'pending' },
  { id: 'agent-llm-reasoning',    label: '1a.    Agent consults LLM for routing',              explanation: 'LLM reasons about which MCP tool to call and what scope is required. This routing decision is logged and auditable.', status: 'pending' },
  { id: 'gw-scope-map',           label: '2.     Agent gets tool list — gateway scope map',     explanation: 'Agent queries MCP gateway to fetch the list of available tools and their required scopes (read, write, etc).', status: 'pending' },
  { id: 'gw-denial-metadata',     label: '4b-c.  Gateway denial — includes required_scopes',   explanation: 'When the agent token lacks required scopes, gateway returns 403 with required_scopes metadata so agent knows what\'s missing (RFC 6749 §3.3).', status: 'pending' },
  { id: 'bff-response-shape',     label: '4d.    BFF structured 401/403 JSON-RPC',             explanation: 'BFF wraps gateway denial as JSON-RPC error with standard shape: {error: "agent_mcp_scope_denied", missingScopes: [...], challenge_type: "..."}', status: 'pending'    },
  { id: 'gw-hitl-challenge-type', label: '4d/11d. Denial includes challenge_type',             explanation: 'challenge_type field indicates why access was denied: "scope_denied" (RFC 6749) or "consent_required" (HITL gate). Guides agent recovery strategy.', status: 'pending' },
  { id: 'agent-error-propagation',label: '5.     Agent propagates JSON-RPC denial',            explanation: 'Agent receives the structured denial from BFF and forwards it to the UI as an error message that includes recovery instructions.', status: 'pending'    },
  { id: 'agent-recovery-branch',  label: '5/11.  Agent branches: login required vs HITL',      explanation: 'Agent reads challenge_type and branches: if scope_denied → user must login; if consent_required → show HITL consent modal instead.', status: 'pending'    },
  { id: 'bff-login-resume',       label: '5a.    BFF stores pending intent for re-fire',       status: 'pending', explanation: 'Before redirecting to login, BFF saves the pending MCP tool call so it auto-resumes after user authenticates (sessionStorage or server-side store).' },
  { id: 'agent-scope-aware-cache',label: '6.     Agent token exchange (actor + subject)',      explanation: 'After login/consent, BFF performs RFC 8693 token exchange: subject_token (user) + actor_token (agent) → narrowed MCP token with delegated scopes.', status: 'pending' },
  { id: 'gw-token-validation',    label: '7.     Exchanged token passes gateway validation',    explanation: 'MCP gateway validates the exchanged token has required delegated scopes (write, etc). Token is authenticated and authorized.', status: 'pending' },
  { id: 'tool-execution',         label: '8.     Tool executes on MCP server',                 explanation: 'Gateway forwards request to MCP server. Tool executes with delegated scopes and returns result. Execution is scoped to user + agent identity (act claim).', status: 'pending' },
  { id: 'olb-resource-token',     label: '9.     MCP token forwarded to resource (OLB path)',  explanation: 'For intent-bound delegation (OLB), the Ping Agent Gateway forwards the BFF-issued token unchanged to the MCP Server. No second exchange — the token (aud=mcp-gw) is valid at the gateway and downstream MCP servers. The act claim (act.sub = agent client) is preserved throughout.', status: 'pending'    },
  { id: 'ui-gateway-consent',     label: '12.    UI shows GatewayConsentModal (HITL)',         explanation: 'For consent-required denials, UI renders GatewayConsentModal showing the transaction details and verification challenge to get user approval.', status: 'pending'    },
  { id: 'ui-auto-refire',         label: '12a.   UI auto-re-fires after login / consent',      explanation: 'After user authenticates or approves consent, UI automatically re-fires the original MCP tool call with the refreshed/exchanged token.', status: 'pending' },
  { id: 'claim-diagnostics',      label: '(diag) Claim/scope diagnostics',                    explanation: 'Optional diagnostics: inspect act, aud, scope claims on the MCP token; verify RFC 8693 exchange succeeded; log for audit/debugging.', status: 'pending'    },
];

let state = {
  visible: false,
  phase: 'idle',
  toolName: null,
  steps: [],
  serverEvents: [],
  hint: null,
  updatedAt: 0,
  complianceSteps: COMPLIANCE_STEPS.map(s => ({ ...s })),
  complianceStep: null,
};

function emit() {
  const snap = {
    ...state,
    steps: state.steps.map((s) => ({ ...s })),
    serverEvents: state.serverEvents.map((e) => ({ ...e })),
  };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (_) {}
  });
}

function scopeSummary(ev) {
  if (!ev?.claims?.scope) return '—';
  const sc = ev.claims.scope;
  const parts = typeof sc === 'string' ? sc.split(/\s+/) : [];
  return parts.length ? `${parts.length} scope(s)` : '—';
}

/**
 * Build terminal steps after /api/mcp/tool returns, using BFF tokenEvents when present.
 * @param {string} toolName
 * @param {object[]|undefined} tokenEvents
 * @param {boolean} ok
 * @param {string|null} errorMessage
 */
function buildCompletedSteps(toolName, tokenEvents, ok, errorMessage) {
  const events = Array.isArray(tokenEvents) ? tokenEvents : [];
  const userTok = events.find((e) => e.id === 'user-token');
  const exchanged = events.find((e) => e.id === 'exchanged-token');
  const required = events.find((e) => e.id === 'exchange-required');
  const failed = events.find((e) => e.id === 'exchange-failed');
  const badScopes = events.find((e) => e.id === 'user-scopes-insufficient');

  const subHint = userTok?.claims?.sub
    ? `sub · ${String(userTok.claims.sub).slice(0, 12)}… · ${scopeSummary(userTok)}`
    : 'OAuth access token from your sign-in session';

  const steps = [
    {
      id: 'as',
      title: 'PingOne — Demo User App',
      detail: userTok
        ? `User access token — ${subHint}`
        : ok
          ? `User access token in session — ${subHint}`
          : 'Sign-in flow should have stored an OAuth access token in the BFF session',
      status: 'pending',
    },
    {
      id: 'agent',
      title: 'Banking Agent (browser)',
      detail: 'Sent JSON tool request to your Backend-for-Frontend',
      status: ok ? 'done' : 'done',
    },
    {
      id: 'bff',
      title: 'BFF — POST /api/mcp/tool',
      detail: (() => {
        if (failed) return `Token exchange failed: ${failed.error || failed.message || 'unknown'}`;
        if (badScopes) return badScopes.explanation || 'User token missing scopes for exchange';
        if (exchanged) {
          const aud = exchanged.audienceNarrowed || exchanged.audActual || 'MCP audience';
          const sc = exchanged.scopeNarrowed || 'narrowed';
          return `RFC 8693 token exchange OK → MCP token (aud: ${aud}, ${sc})`;
        }
        if (required) {
          return 'Token exchange not configured (MCP_RESOURCE_URI) — BFF may use local fallback';
        }
        return 'Validated session; forwarded to MCP proxy (WebSocket)';
      })(),
      status: ok ? 'done' : 'error',
    },
    {
      id: 'mcp-gateway',
      title: 'Ping Agent Gateway',
      detail: exchanged
        ? `TX token received (aud: ${exchanged.audienceNarrowed || 'mcp-gw'}, act: agent1) — sidebanding to PingOne Authorize`
        : 'Routes tool call; sidebands to PingOne Authorize for scope/AUD/HITL decision',
      status: ok ? 'done' : 'error',
    },
    {
      id: 'pingauthorize',
      title: 'PingOne Authorize — Demo Introspection Worker',
      detail: ok
        ? 'Introspected token (RFC 7662) ✓  scopes ✓  aud ✓  HITL threshold ✓ → PERMIT'
        : 'Evaluated scopes, AUD, and HITL/consent rules — see denial reason above',
      status: ok ? 'done' : 'error',
    },
    {
      id: 'mcp',
      title: 'MCP Server',
      detail: ok
        ? 'Introspected narrowed token, checked scopes, called Banking REST API'
        : errorMessage || 'Upstream or policy error',
      status: ok ? 'done' : 'error',
    },
    {
      id: 'tool',
      title: `MCP tool — ${toolName}`,
      detail: ok ? 'tools/call completed' : errorMessage || 'Tool call failed',
      status: ok ? 'done' : 'error',
    },
  ];

  return steps;
}

export const agentFlowDiagram = {
  subscribe(fn) {
    listeners.add(fn);
    try {
      fn({
        ...state,
        steps: state.steps.map((s) => ({ ...s })),
        serverEvents: state.serverEvents.map((e) => ({ ...e })),
      });
    } catch (_) {}
    return () => listeners.delete(fn);
  },

  getState() {
    return {
      ...state,
      steps: state.steps.map((s) => ({ ...s })),
      serverEvents: state.serverEvents.map((e) => ({ ...e })),
    };
  },

  /**
   * Apply one SSE payload from GET /api/mcp/tool/events (BFF `phase` milestones).
   * @param {object} payload
   */
  applyServerEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.phase === 'stream_end') {
      state.updatedAt = Date.now();
      emit();
      return;
    }

    // Token-event payloads (type:'token-event') arrive via publishTokenEventsToSse and carry
    // id fields matching the token chain entries.  Map them to compliance steps so that the
    // RFC 8693 two-token exchange and the final exchanged MCP token are both tracked.
    if (payload.type === 'token-event') {
      const tokenComplianceMap = {
        'agent-actor-token': ['agent-scope-aware-cache'], // Step 6: actor CC token obtained
        'exchanged-token':   ['olb-resource-token'],       // Step 9: MCP resource token obtained via exchange
      };
      const ids = tokenComplianceMap[payload.id] || [];
      ids.forEach(id => {
        const step = state.complianceSteps.find(s => s.id === id);
        if (step) { step.status = 'done'; state.complianceStep = id; }
      });
      if (ids.length) { state.updatedAt = Date.now(); emit(); }
      return;
    }

    // Phase-based compliance map — keyed on ACTUAL server phase names from server.js
    // Happy path:      request_accepted → resolving_access_token → access_token_ready → mcp_remote_begin → mcp_remote_done
    // Auth gate path:  authorize_gate_begin → authorize_denied / authorize_permitted
    // HITL path:       authorize_denied_hitl
    // No-session path: no_bearer_no_user
    // MFA / step-up:   gateway_step_up_required
    // Auth challenge:  mcp_auth_challenge_intercepted
    const complianceMap = {
      // Step 1 — Agent starts, gets CC token (request received by BFF)
      'request_accepted':               ['agent-token-init'],
      // Step 2 — Agent gets tool list / gateway scope map
      'authorize_gate_begin':           ['gw-scope-map'],
      'authorize_permitted':            ['gw-scope-map'],
      'authorize_gate_skipped':         ['gw-scope-map'],
      // Step 4b-c — Gateway denial includes required_scopes
      'authorize_denied':               ['gw-denial-metadata'],
      // Step 4d — BFF structured 401/403 JSON-RPC
      'no_bearer_no_user':              ['bff-response-shape'],
      // Step 4d/11d — Denial includes challenge_type (HITL or step-up)
      'authorize_denied_hitl':          ['gw-hitl-challenge-type', 'bff-response-shape'],
      'gateway_step_up_required':       ['gw-hitl-challenge-type'],
      // Step 5 — Agent propagates JSON-RPC denial
      'mcp_auth_challenge_intercepted': ['agent-error-propagation'],
      // Step 6 — RFC 8693 token exchange starts (actor + subject tokens resolved)
      // NOTE: token-event 'agent-actor-token' also marks this step when actor CC token is obtained
      'resolving_access_token':         ['agent-scope-aware-cache'],
      'access_token_ready':             ['agent-scope-aware-cache'],
      // Step 7 + 9 — gateway accepts the (validated) token and the call is made
      // with the resource token in hand. NOTE: token-event 'exchanged-token' also
      // marks step 9 when the exchange produces the MCP token.
      'mcp_remote_begin':               ['gw-token-validation', 'olb-resource-token'],
      // Step 8 + (diag) — tool executed on the MCP server; claim/scope diagnostics
      // Step 12 / 12a — fired by UI directly via completeMfaChallenge / markHitlPreConsent
      'mcp_remote_done':                ['tool-execution', 'claim-diagnostics'],
    };

    if (complianceMap[payload.phase]) {
      complianceMap[payload.phase].forEach(id => {
        const step = state.complianceSteps.find(s => s.id === id);
        if (step) {
          step.status = 'done';
          state.complianceStep = id;
        }
      });
    }

    const label = PHASE_LABELS[payload.phase] || String(payload.phase);
    const bits = [];
    if (payload.tool && payload.tool !== state.toolName) bits.push(`tool · ${payload.tool}`);
    if (payload.code) bits.push(`code · ${payload.code}`);
    if (payload.status != null) bits.push(`HTTP ${payload.status}`);
    if (payload.path) bits.push(`path · ${payload.path}`);
    if (payload.hasUserToken != null) bits.push(payload.hasUserToken ? 'user token' : 'no user token');
    if (payload.exchanged != null) bits.push(payload.exchanged ? 'exchanged' : 'not exchanged');
    if (payload.exchangeRequired) bits.push('exchange required');
    const detail = bits.length ? bits.join(' · ') : '—';
    const row = {
      phase: String(payload.phase),
      label,
      detail,
      t: typeof payload.t === 'number' ? payload.t : undefined,
      // Preserve gate HTTP status (403 DENY vs 428 step-up/HITL) so TraceRail
      // can distinguish a hard deny from a challenge on authorize_denied.
      ...(payload.status != null ? { status: payload.status } : {}),
    };
    state.serverEvents = [...state.serverEvents, row].slice(-MAX_SERVER_EVENTS);
    state.updatedAt = Date.now();
    emit();
  },

  open() {
    state.visible = true;
    state.hint = null;
    state.updatedAt = Date.now();
    emit();
  },

  close() {
    state.visible = false;
    state.updatedAt = Date.now();
    emit();
  },

  reset() {
    state.phase = 'idle';
    state.toolName = null;
    state.steps = [];
    state.serverEvents = [];
    state.hint = 'Run a banking action in the agent to see each hop update live.';
    state.updatedAt = Date.now();
    emit();
  },

  /** Drop SSE phase rows without resetting the compliance checklist UI. */
  clearServerEvents() {
    if (state.serverEvents.length === 0) return;
    state.serverEvents = [];
    state.updatedAt = Date.now();
    emit();
  },

  /**
   * @param {string} toolName MCP tool name e.g. get_my_accounts
   */
  startMcpToolCall(toolName) {
    // Calling a tool implies the gateway tool list (step 2) was already fetched.
    const gwStep = state.complianceSteps.find(s => s.id === 'gw-scope-map');
    if (gwStep && gwStep.status !== 'done') { gwStep.status = 'done'; }
    // Do not auto-open — panel only opens via explicit user action (agent-flow-diagram-open event)
    state.phase = 'running';
    state.toolName = toolName;
    state.hint = null;
    state.serverEvents = [];
    state.steps = [
      {
        id: 'as',
        title: 'PingOne — Demo User App',
        detail: 'User token should already be in the BFF session from sign-in',
        status: 'pending',
      },
      {
        id: 'agent',
        title: 'Banking Agent',
        detail: 'Calling Backend-for-Frontend…',
        status: 'active',
      },
      {
        id: 'bff',
        title: 'BFF — RFC 8693 Token Exchange',
        detail: 'Demo AI Agent App (actor CC) + user subject token → TX token (aud: mcp-gw, scope narrowed) via Demo Token Exchanger App',
        status: 'pending',
      },
      {
        id: 'mcp-gateway',
        title: 'Ping Agent Gateway',
        detail: 'Receives TX token; sidebands to PingOne Authorize for scope/AUD/HITL check',
        status: 'pending',
      },
      {
        id: 'pingauthorize',
        title: 'PingOne Authorize — Demo Introspection Worker',
        detail: 'RFC 7662 introspect + evaluates: required scopes, AUD, HITL threshold, consent rules',
        status: 'pending',
      },
      {
        id: 'mcp',
        title: 'MCP Server',
        detail: 'tools/call → introspect narrowed token → Banking API',
        status: 'pending',
      },
      {
        id: 'tool',
        title: `Tool — ${toolName}`,
        detail: 'In progress…',
        status: 'pending',
      },
    ];
    state.updatedAt = Date.now();
    emit();
  },

  /**
   * @param {{ toolName: string, tokenEvents?: object[], ok: boolean, errorMessage?: string|null }} p
   */
  completeMcpToolCall({ toolName, tokenEvents, ok, errorMessage = null }) {
    state.phase = ok ? 'done' : 'error';
    state.toolName = toolName;
    state.steps = buildCompletedSteps(toolName, tokenEvents, ok, errorMessage);
    state.updatedAt = Date.now();
    emit();
  },

  /** MCP inspector tools/list (different route — no token exchange on BFF for same shape). */
  startInspectorToolsList() {
    state.phase = 'running';
    state.toolName = 'tools/list';
    state.hint = null;
    state.steps = [
      {
        id: 'as',
        title: 'PingOne — Demo User App',
        detail: 'Session token used for discovery',
        status: 'pending',
      },
      {
        id: 'agent',
        title: 'Banking Agent',
        detail: 'GET /api/mcp/inspector/tools',
        status: 'active',
      },
      {
        id: 'bff',
        title: 'BFF — MCP Host proxy',
        detail: 'tools/list over WebSocket to MCP server',
        status: 'pending',
      },
      {
        id: 'mcp',
        title: 'MCP Server',
        detail: 'Returns registered banking tools',
        status: 'pending',
      },
    ];
    state.updatedAt = Date.now();
    emit();
  },

  /**
   * @param {{ ok: boolean, source?: string, errorMessage?: string|null }} p
   */
  completeInspectorToolsList({ ok, source = 'mcp_server', errorMessage = null }) {
    state.phase = ok ? 'done' : 'error';
    state.toolName = 'tools/list';
    const isMfaGate = !ok && errorMessage === 'mfa_required';
    state.steps = [
      {
        id: 'as',
        title: 'PingOne — Demo User App',
        detail: 'Bearer from session for MCP handshake',
        status: 'pending',
      },
      {
        id: 'agent',
        title: 'Banking Agent',
        detail: 'Requested live tool catalog',
        status: 'pending',
      },
      {
        id: 'bff',
        title: 'BFF — MCP Inspector',
        detail: ok ? `Discovery OK (${source})` : isMfaGate ? 'Human-in-the-Loop (HITL) — manual approval required before tools load' : errorMessage || 'Discovery failed',
        status: ok ? 'done' : isMfaGate ? 'active' : 'error',
      },
      {
        id: 'mcp',
        title: 'MCP Server',
        detail: ok ? 'tools/list JSON-RPC completed' : isMfaGate ? 'Paused — waiting for your manual approval (HITL)' : errorMessage || 'Unreachable or error',
        status: ok ? 'done' : isMfaGate ? 'pending' : 'error',
      },
      ...(isMfaGate ? [{
        id: 'mfa',
        title: 'HITL — MFA Step-up (manual approval required)',
        detail: 'Agent paused — you must verify your identity to continue. OTP, TOTP, passkey, or push.',
        status: 'active',
      }] : []),
    ];
    state.updatedAt = Date.now();
    emit();
  },

  /** Call when MFA challenge modal opens (user is completing step-up for tools/list gate). */
  startMfaChallenge() {
    const mfaStep = state.steps.find((s) => s.id === 'mfa');
    if (mfaStep) {
      mfaStep.status = 'active';
      mfaStep.detail = 'Verifying your identity — HITL manual approval in progress…';
    } else {
      state.steps = [
        ...state.steps,
        { id: 'mfa', title: 'HITL — MFA Step-up', detail: 'Verifying your identity — manual approval in progress…', status: 'active' },
      ];
    }
    state.updatedAt = Date.now();
    emit();
  },

  /**
   * Reset all compliance steps back to their default initial status.
   * Called at the start of each new prompt/tool run.
   */
  resetComplianceSteps(actionLabel, actionId) {
    state.complianceSteps = COMPLIANCE_STEPS.map(s => ({ ...s }));
    state.complianceStep = null;
    state.complianceActionLabel = actionLabel || null;
    state.complianceActionId = actionId || null;
    state.updatedAt = Date.now();
    emit();
  },

  startLlmReasoning(text) {
    const initStep = state.complianceSteps.find(s => s.id === 'agent-token-init');
    if (initStep) initStep.status = 'done';
    const llmStep = state.complianceSteps.find(s => s.id === 'agent-llm-reasoning');
    if (llmStep) llmStep.status = 'done';
    state.complianceStep = 'agent-llm-reasoning';
    state.updatedAt = Date.now();
    emit();
  },

  markHitlPreConsent() {
    // All steps logically complete by the time a HITL/MFA challenge fires:
    // 1 (CC token), 2 (tool list from gateway), 4b-c (gateway denial w/ required_scopes),
    // 4d (BFF structured 401), 4d/11d (challenge_type in denial), 5 (agent propagates),
    // 5/11 (agent branches to HITL), 5a (BFF stores pending intent),
    // 6 (RFC 8693 actor+subject exchange), 9 (MCP resource token), 12 (consent modal shown)
    const toMark = [
      'agent-token-init', 'gw-scope-map', 'gw-denial-metadata', 'bff-response-shape',
      'gw-hitl-challenge-type', 'agent-error-propagation', 'agent-recovery-branch',
      'bff-login-resume', 'agent-scope-aware-cache', 'olb-resource-token', 'ui-gateway-consent',
    ];
    toMark.forEach(id => {
      const step = state.complianceSteps.find(s => s.id === id);
      if (step) step.status = 'done';
    });
    state.complianceStep = 'ui-gateway-consent';
    state.updatedAt = Date.now();
    emit();
  },

  /**
   * Generic state merge — used to update complianceStep / complianceSteps from outside.
   * @param {Partial<typeof state>} patch
   */
  setState(patch) {
    Object.assign(state, patch);
    state.updatedAt = Date.now();
    emit();
  },

  /** Mark step 5/11 (agent-recovery-branch) as done — call before redirecting to login. */
  markRecoveryBranch() {
    const step = state.complianceSteps.find(s => s.id === 'agent-recovery-branch');
    if (step) { step.status = 'done'; state.complianceStep = 'agent-recovery-branch'; }
    state.updatedAt = Date.now();
    emit();
  },

  /** Call when MFA challenge resolves. ok=true means tools/list will retry. */
  completeMfaChallenge(ok) {
    const mfaStep = state.steps.find((s) => s.id === 'mfa');
    if (mfaStep) {
      mfaStep.status = ok ? 'done' : 'error';
      mfaStep.detail = ok ? 'HITL approved — identity verified, agent resuming' : 'HITL cancelled — MFA failed or user declined';
    }
    // Mark compliance steps 5/11 (agent branches) and 12 (UI shows consent modal)
    const hitlStepIds = ['agent-recovery-branch', 'ui-gateway-consent'];
    hitlStepIds.forEach(id => {
      const step = state.complianceSteps.find(s => s.id === id);
      if (step) { step.status = 'done'; state.complianceStep = id; }
    });
    // If approved: also mark step 12a (auto-refire) and step 5 (error propagation)
    if (ok) {
      ['ui-auto-refire', 'agent-error-propagation'].forEach(id => {
        const step = state.complianceSteps.find(s => s.id === id);
        if (step) { step.status = 'done'; state.complianceStep = id; }
      });
    }
    state.phase = ok ? 'running' : 'error';
    state.updatedAt = Date.now();
    emit();
  },

  /** Force-complete all 12 compliance steps for demo/testing purposes. */
  forceCompleteAllSteps() {
    state.complianceSteps.forEach(step => {
      step.status = 'done';
    });
    state.complianceStep = state.complianceSteps[state.complianceSteps.length - 1]?.id || null;
    state.phase = 'done';
    state.updatedAt = Date.now();
    emit();
  },
};