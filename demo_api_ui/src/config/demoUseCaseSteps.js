/**
 * Presenter Demo script — catalog ids in walkthrough order.
 * Shared by UseCaseLauncherPage (/use-cases Demo section) and the agent
 * "Demo steps" dropdown so both lists stay identical.
 *
 * Primary = all steps shown in the visible grid.
 * Advanced = empty (nothing hidden).
 * Attacks + Testing chips live in the Actions popout, not here.
 */
export const DEMO_PRIMARY_USE_CASE_IDS = [
  'UC24',  // Act 1 — public catalog, no token exchange (progressive trust)
  'UC1',   // Full flow — delegated access
  'UC8',   // Consent HITL
  'UC7',   // MFA step-up
  'UC14b', // Intent (RAR verified)
  'UC14',  // Intent (RAR violation — DENY, pairs with UC14b)
  'UC12',  // DPoP / replay defense
  'UC6',   // Authz DENY
  'UC2',   // A2A delegation
  'UC2.5', // A2A orchestrator learning
  'UC2.7', // A2A end to end — protocol + identity (walkthrough page)
  'UC22',  // CIBA out-of-band
  'UC5',   // Insufficient scope
  'UC10',  // Cross-owner
  'UC13',  // Confused deputy
  'UC11',  // Bad client gateway
  'UC20',  // Agent observability / audit trail
  'UC18',  // Rate-limit / throttle burst
  // UC29 (OAuth introspection outage) is deliberately NOT in the script: the
  // Node gateway validates tokens by JWKS (GW_INTROSPECTION_ENABLED=false —
  // RFC 7662 cannot cover its multi-issuer A2A tokens, see docker-compose.yml)
  // and PingGateway has no outage toggle, so the sim cannot fire on this
  // deployment. It stays in the catalog under Attacks, badged "Needs build".
  'UC30',  // Weather MCP — Texas permit
  'UC31',  // Weather MCP — out-of-scope deny
  'UC32',  // Weather MCP — live-reconfigure the gateway scope
  'UC40',  // Enterprise-Managed MCP Authorization — native ID-JAG walkthrough
  'UC38',  // Workload Agent: Digital Assistant — MFA + RFC 8693 delegation
  'UC-TOOL1', // Protected RAG — code:search + PingOne Authorize
  'UC46',  // Privilege A2A access review — step 25 in the presenter sequence
  'UC47',  // Privilege A2A three-deep agent chain — live in the reel, step 26
];

export const DEMO_ADVANCED_USE_CASE_IDS = [];

/** Curated CIAM lane shown as its own live group on the use-case launcher. */
export const CIAM_AGENT_TYPE_USE_CASE_IDS = [
  'UC43',  // Consumer & Partner Agent — mocked CIMD registration
  'UC44',  // Workload Agent: Digital Assistant — real OBO execution
  'UC45',  // SaaS-Embedded Agent — Website Worker
  'UC2',   // Agent Network — specialist delegation
  'UC2.6', // Agent Network — mismatched actor denied
];

/** Presenter-friendly aliases used by Demo Steps search. */
export const DEMO_USE_CASE_SEARCH_TERMS = {
  UC24: ['public access', 'public catalog', 'nearby branches', 'no token'],
  UC1: ['delegated access', 'balance', 'token exchange', 'rfc 8693', 'act claim', 'attribution'],
  UC8: ['consent', 'human in the loop', 'hitl', 'transfer approval'],
  UC7: ['mfa', 'multi-factor', 'step-up', 'strong authentication'],
  UC14b: ['par', 'rar', 'rich authorization request', 'intent', 'amount cap', 'permit'],
  UC14: ['par', 'rar', 'rich authorization request', 'intent violation', 'overage', 'deny'],
  UC12: ['dpop', 'replay', 'token theft', 'proof'],
  UC6: ['authorization deny', 'transfer denied', 'policy deny'],
  UC2: ['a2a', 'agent-to-agent', 'delegation', 'specialist', 'nested actor'],
  'UC2.5': ['a2a', 'orchestration', 'learning', 'specialist'],
  'UC2.7': ['a2a', 'agent-to-agent', 'end to end', 'protocol', 'identity'],
  UC22: ['ciba', 'out of band', 'decoupled approval', 'push approval'],
  UC5: ['insufficient scope', 'scope deny', '403'],
  UC10: ['cross-owner', 'account takeover', 'resource ownership'],
  UC13: ['confused deputy', 'actor injection', 'rogue actor'],
  UC11: ['bad client', 'wrong audience', 'malformed token', '401'],
  UC20: ['audit', 'audit trail', 'evidence', 'logging'],
  UC18: ['rate limit', 'throttle', 'burst'],
  UC17: ['jit', 'just in time', 'ephemeral credentials', 'short-lived token', 'secretless'],
  UC30: ['weather', 'texas permit', 'mcp'],
  UC31: ['weather', 'out of scope', 'gateway deny', 'mcp'],
  UC32: ['weather', 'live reconfigure', 'gateway scope', 'mcp'],
  UC40: ['enterprise managed', 'mcp authorization', 'id-jag', 'managed agent'],
  UC38: ['personal concierge', 'digital assistant', 'mfa', 'workload agent', 'delegation'],
  'UC-TOOL1': ['protected rag', 'code search', 'retrieval', 'mcp'],
  UC43: ['cimd', 'consumer agent', 'partner agent', 'agent registration', 'nhi inventory'],
  UC44: ['obo', 'digital assistant', 'workload agent', 'delegated action', 'customer attribution'],
  UC45: ['saas embedded', 'website worker', 'embedded agent', 'customer tenant', 'website identity', 'nhi'],
  'UC2.6': ['a2a', 'mismatched actor', 'wrong actor', 'delegation deny'],
  'UC-PAM-SETUP': ['privilege', 'pam', 'privilege setup', 'agent onboarding', 'mfa'],
  'UC-PAM-SCRIPT': ['privilege', 'pam', 'jit access', 'approval', 'four eyes', 'session recording', 'kill switch', 'aws', 's3', 'vpc', 'kubernetes'],
  UC25: ['privilege', 'enterprise managed mcp', 'id-jag', 'centralized access', 'group policy'],
  'UC-LEARN11': ['privilege', 'privilege ai', 'llm gateway', 'prompt injection'],
  'UC-TOOL3': ['privilege', 'privilege ai', 'llm gateway', 'prompt injection', 'virtual key'],
  UC46: ['privilege', 'a2a', 'agent-to-agent', 'access review', 'anthropic', 'google', 'gemini', 'ai gateway', 'worker agent'],
  UC47: ['privilege', 'a2a', 'agent-to-agent', 'agent chain', 'three deep', 'ai gateway', 'langchain', 'specialist', 'delegation'],
};

/** Existing Privilege lanes grouped for the presenter, without inventing routes. */
export const PRIVILEGE_USE_CASE_IDS = [
  'UC17',
  'UC25',
  'UC40',
  'UC-PAM-SETUP',
  'UC-PAM-SCRIPT',
  'UC-LEARN11',
  'UC-TOOL3',
];

/** Maturity-model journey groups for the presenter drawer. */
export const DEMO_MATURITY_GROUPS = [
  {
    id: 'discover',
    label: 'Discover agents',
    shortLabel: 'Discover',
    description: 'Find agents and make their activity visible.',
    useCaseIds: ['UC24'],
  },
  {
    id: 'register',
    label: 'Register trusted agents',
    shortLabel: 'Register',
    description: 'Establish agent identities and trust relationships.',
    useCaseIds: ['UC40', 'UC38'],
  },
  {
    id: 'authenticate',
    label: 'Authenticate & delegate',
    shortLabel: 'Authenticate',
    description: 'Prove the user, agent, consent, and delegation chain.',
    useCaseIds: ['UC1', 'UC7', 'UC8', 'UC22'],
  },
  {
    id: 'authorize',
    label: 'Authorize agent actions',
    shortLabel: 'Authorize',
    description: 'Apply least privilege, policy, and intent controls.',
    useCaseIds: ['UC2', 'UC2.5', 'UC2.7', 'UC5', 'UC6', 'UC10', 'UC13', 'UC14b', 'UC14', 'UC46', 'UC47'],
  },
  {
    id: 'protect',
    label: 'Protect traffic & resources',
    shortLabel: 'Protect',
    description: 'Protect gateways, MCP servers, and connected resources.',
    useCaseIds: ['UC11', 'UC12', 'UC30', 'UC31', 'UC32', 'UC-TOOL1'],
  },
  {
    id: 'govern',
    label: 'Govern & prove activity',
    shortLabel: 'Govern',
    description: 'Show auditability, throttling, and accountability.',
    useCaseIds: ['UC18', 'UC20'],
  },
];

/**
 * Guided Journey stage groups — mirrors the 13 steps of the
 * Guided customer journey (/academy/journey, GuidedJourneyPage
 * JOURNEY_SEQUENCE) 1:1 so the Demo Steps drawer's group filter chips match
 * that page's left rail. Each stage filters to the use cases that play the
 * corresponding beat of the story.
 */
export const DEMO_JOURNEY_GROUPS = [
  {
    id: 'j-discover',
    label: 'Discover agents',
    shortLabel: 'Discover',
    description: 'Find agents and make their activity visible.',
    useCaseIds: ['UC24'],
  },
  {
    id: 'j-login',
    label: 'PingOne login',
    shortLabel: 'Login',
    description: 'OIDC/PKCE person login with the BFF holding browser tokens.',
    useCaseIds: [],
  },
  {
    id: 'j-delegation',
    label: 'Delegation',
    shortLabel: 'Delegation',
    description: 'RFC 8693 delegated agent access with the act claim.',
    useCaseIds: ['UC1'],
  },
  {
    id: 'j-personal-agent',
    label: 'Personal Agent',
    shortLabel: 'Personal Agent',
    description: 'Consumer-owned personal agent registration and delegated execution.',
    useCaseIds: ['UC43', 'UC44', 'UC38'],
  },
  {
    id: 'j-digital-assistant',
    label: 'Digital Assistant',
    shortLabel: 'Digital Assistant',
    description: 'Enterprise Digital Assistant with OBO, MFA, and live authorization.',
    useCaseIds: ['UC38', 'UC44', 'UC1', 'UC7', 'UC22'],
  },
  {
    id: 'j-mcp',
    label: 'MCP',
    shortLabel: 'MCP',
    description: 'MCP discovery and tool execution behind the gateway boundary.',
    useCaseIds: ['UC30', 'UC31', 'UC32', 'UC-TOOL1', 'UC40'],
  },
  {
    id: 'j-authorize',
    label: 'PingOne Authorize',
    shortLabel: 'Authorize',
    description: 'Permit and deny policy decisions on agent actions.',
    useCaseIds: ['UC6', 'UC14b', 'UC14', 'UC5', 'UC10', 'UC13'],
  },
  {
    id: 'j-hitl',
    label: 'HITL and step-up',
    shortLabel: 'HITL & Step-up',
    description: 'Human approval, consent, CIBA, and step-up authentication.',
    useCaseIds: ['UC8', 'UC7', 'UC22'],
  },
  {
    id: 'j-a2a',
    label: 'A2A delegation',
    shortLabel: 'A2A',
    description: 'Agent-to-agent delegation, specialist handoff, and nested identity.',
    useCaseIds: ['UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC46', 'UC47'],
  },
  {
    id: 'j-privilege-mcp',
    label: 'Privilege MCP',
    shortLabel: 'Privilege',
    description: 'Privilege-protected MCP access — time-bound, scoped, auditable.',
    useCaseIds: [...PRIVILEGE_USE_CASE_IDS, 'UC46', 'UC47'],
  },
  {
    id: 'j-threat-defense',
    label: 'Attack defense',
    shortLabel: 'Attacks',
    description: 'Replay, bad client, throttle, and gateway deny outcomes.',
    useCaseIds: ['UC12', 'UC11', 'UC18', 'UC31'],
  },
  {
    id: 'j-lifecycle',
    label: 'Agent lifecycle',
    shortLabel: 'Lifecycle',
    description: 'Registration, ownership, suspension, and revocation evidence.',
    useCaseIds: ['UC20', 'UC43'],
  },
  {
    id: 'j-evidence',
    label: 'Evidence summary',
    shortLabel: 'Evidence',
    description: 'Assemble the defensible evidence timeline across products.',
    useCaseIds: ['UC20'],
  },
];

/**
 * Persistent Mission Control shortcuts. This presenter taxonomy keeps the
 * agent lanes and journey/control lanes available as one-click filters.
 * Empty future lanes stay visible as the catalog grows.
 */
export const DEMO_MISSION_GROUPS = [
  {
    id: 'personal-agent',
    label: 'Personal Agent',
    shortLabel: 'Personal Agent',
    description: 'Customer-owned personal agent registration and delegated execution.',
    useCaseIds: ['UC43', 'UC44', 'UC38'],
  },
  {
    id: 'digital-assistant',
    label: 'Digital Assistant',
    shortLabel: 'Digital Assistant',
    description: 'Customer-facing assistant with OBO, MFA, and live authorization.',
    useCaseIds: ['UC44', 'UC38', 'UC1', 'UC7', 'UC22'],
  },
  {
    id: 'consumer-partner',
    label: 'Consumer & Partner Agent',
    shortLabel: 'Consumer & Partner',
    description: 'CIAM registration, ownership, metadata, and NHI inventory.',
    useCaseIds: ['UC43'],
  },
  {
    id: 'employee-agent',
    label: 'Employee Agent',
    shortLabel: 'Employee Agent',
    description: 'Employee-owned agent lane reserved for the next live registration flow.',
    useCaseIds: [],
  },
  {
    id: 'workload-agent',
    label: 'Workload Agent',
    shortLabel: 'Workload Agent',
    description: 'Autonomous and delegated workload identities with governed actions.',
    useCaseIds: ['UC38', 'UC40'],
  },
  {
    id: 'agent-network',
    label: 'Agent Network',
    shortLabel: 'Agent Network',
    description: 'A2A delegation, specialist scope narrowing, and actor mismatch denial.',
    useCaseIds: ['UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC46', 'UC47'],
  },
  {
    id: 'discover',
    label: 'Discover agents',
    shortLabel: 'Discover',
    description: 'Find agents and make their activity visible.',
    useCaseIds: ['UC24'],
  },
  {
    id: 'register',
    label: 'Register trusted agents',
    shortLabel: 'Register',
    description: 'Establish agent identities and trust relationships.',
    useCaseIds: ['UC40', 'UC38', 'UC43'],
  },
  {
    id: 'authenticate',
    label: 'Authenticate & delegate',
    shortLabel: 'Authenticate',
    description: 'Prove the user, agent, consent, and delegation chain.',
    useCaseIds: ['UC1', 'UC7', 'UC8', 'UC22', 'UC38', 'UC44'],
  },
  {
    id: 'authorize',
    label: 'Authorize agent actions',
    shortLabel: 'Authorize',
    description: 'Apply least privilege, policy, intent, and actor controls.',
    useCaseIds: ['UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC5', 'UC6', 'UC10', 'UC13', 'UC14b', 'UC14'],
  },
  {
    id: 'privilege',
    label: 'Privilege & JIT',
    shortLabel: 'Privilege & JIT',
    description: 'Request, approve, broker, observe, and revoke privileged access.',
    useCaseIds: [...PRIVILEGE_USE_CASE_IDS, 'UC46', 'UC47'],
  },
  {
    id: 'govern',
    label: 'Govern & prove activity',
    shortLabel: 'Govern',
    description: 'Show auditability, throttling, accountability, and lifecycle evidence.',
    useCaseIds: ['UC18', 'UC20'],
  },
];

/**
 * 15-Min Security demo script — the exact tiles that script runs, in order,
 * gathered into one workbench group so the presenter doesn't hunt across
 * tracks. This list IS the teleprompter script order (demoScript.js) 1:1, so
 * step N here == beat N there. Mostly duplicates ids in DEMO_PRIMARY; UC24 and
 * UC14 are the two not there. Consumed only by LiveUseCaseWorkbenchPage.
 * Flag-gated tiles (UC2, UC14/UC14b) auto-arm their flag on run — see the
 * maturity→flag arming in routes/useCases.js and attackSimulatorService.js.
 */
export const SECURITY_DEMO_USE_CASE_IDS = [
  'UC1',   // show my balance → PERMIT (act claim)
  'UC2',   // hand off to a specialist → PERMIT (nested-act A2A chain)
  'UC24',  // branches near me → public PERMIT (no exchange)
  'UC6',   // transfer $2500 → DENY
  'UC8',   // transfer $300 → HITL
  'UC14b', // PAR within cap → PERMIT (intent-binding page), ff_rar
  'UC14',  // PAR over cap → DENY (rar-exceeded attack sim), ff_rar
  'UC31',  // weather Miami → gateway DENY
  'UC12',  // DPoP replay attack sim → DENY_401
  'UC5',   // insufficient scope attack sim → DENY_403
];

/** Flat list for callers that only need order (primary then advanced). */
export const DEMO_USE_CASE_IDS = [
  ...DEMO_PRIMARY_USE_CASE_IDS,
  ...DEMO_ADVANCED_USE_CASE_IDS,
];

/**
 * PingOne Admin vertical's demo-steps ids. Served by a separate backend
 * list (demo_api_server/config/admin/demoSteps.js), not the 22-use-case
 * banking catalog — see docs/superpowers/specs/2026-07-19-pingone-admin-demo-steps-design.md.
 */
export const ADMIN_PRIMARY_USE_CASE_IDS = [
  'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6',
  'ADMIN7', 'ADMIN8', 'ADMIN9', 'ADMIN10', 'ADMIN11', 'ADMIN12', 'ADMIN13',
];

/** Section heading used on /use-cases for this script. */
export const DEMO_USE_CASE_LABEL = 'Demo — a scripted walkthrough';
