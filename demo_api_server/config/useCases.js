'use strict';

/**
 * Use-Case Catalog — single source of truth (Plan A · Phase A1).
 * Demo launcher, audit table, docs generator, and organic useCaseId tagging
 * all derive from this file. Content is transcribed from the design spec
 * docs/superpowers/specs/2026-06-20-ai-agent-security-use-cases-design.md.
 *
 * @typedef {{type:'chip',text:string}|{type:'attack',sim:string}|{type:'link',path:string,label?:string}|{type:'edu',panel:string,tab?:string,label?:string}} Trigger
 * @typedef {{tokenChain:string[],activity:string[]}} Evidence
 * @typedef {{threats:string[],sections:string[]}} Owasp
 * @typedef {Object} UseCase
 * @property {string} id            e.g. 'UC7'
 * @property {string} useCaseId     slug, e.g. 'step-up-required'
 * @property {'foundations'|'controls'|'attacks'|'hitl'|'tools'|'learn'|'demo'} track
 * @property {string} title
 * @property {string} buyerStory
 * @property {string} pingOneSolution
 * @property {Trigger} trigger
 * @property {string} expectedOutcome
 * @property {Evidence} evidence
 * @property {string[]} codeRefs
 * @property {string} maturity      'works' | 'needs-console-import' | 'needs-build' | 'flag:<name>'
 * @property {Owasp} owasp
 * @property {string} whatToSay
 * @property {boolean} advanced
 * @property {Object<string, Partial<UseCase> & {thresholds?:object}>} [perVertical]
 */

const VERTICALS = [
  'banking', 'healthcare', 'retail', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing',
  'investment',
];


/** Per-vertical chip triggers so Heuristics mode matches each vertical's phrases. */
const READ_TRIGGER_BY_VERTICAL = {
  healthcare: 'check my coverage',
  retail: 'list my orders',
  government: 'show my permits',
  university: 'show my enrolled courses',
  workforce: 'my benefits',
  'sporting-goods': 'my gear',
  manufacturing: 'show my work orders',
  investment: 'show my portfolios',
};

/** Amount-gated write phrases ($300 HITL / $600 step-up / $2500 deny). */
function amountTriggerByVertical(amount) {
  const n = String(amount);
  return {
    healthcare: `pay my $${n} bill`,
    retail: `checkout headphones for $${n}`,
    government: `pay the $${n} fee`,
    university: `pay $${n} tuition`,
    workforce: `submit a $${n} expense`,
    'sporting-goods': `extend my rental $${n}`,
    manufacturing: `approve a $${n} purchase order`,
    investment: `execute a large trade of $${n}`,
  };
}

function chipOverrides(textByVertical, extraByVertical = {}) {
  const out = {};
  for (const [v, text] of Object.entries(textByVertical)) {
    out[v] = { trigger: { type: 'chip', text }, ...(extraByVertical[v] || {}) };
  }
  return out;
}

/**
 * Per-vertical PRIMARY TOOL — every vertical stores its OWN value, even where it
 * duplicates a neighbour. Deliberate: isolation over DRY. Changing or removing
 * one vertical's entry must never silently change what another vertical's chip
 * demos. Before this, `primaryTool` was banking-base metadata shared by all
 * verticals, so 68/72 vertical entries "lied" about their own tool and the
 * routing drift-gate could only cover banking. The drift gate
 * (useCases.primaryTool.test.js) verifies each value against what the chip
 * ACTUALLY routes to — get a value wrong here and pre-push fails naming it.
 * (Banking's own values live on the base entries; resolveUseCase serves the
 * base unchanged for banking.)
 */
const READ_PRIMARY_TOOL_BY_VERTICAL = {
  healthcare: 'view_coverage',
  retail: 'list_orders',
  government: 'view_permits',
  university: 'view_courses',
  workforce: 'view_benefits',
  'sporting-goods': 'list_gear',
  manufacturing: 'view_work_orders',
  investment: 'view_portfolios',
};

/** Amount-gated write tool per vertical (UC6/7/8 DENY / step-up / consent). */
const AMOUNT_PRIMARY_TOOL_BY_VERTICAL = {
  healthcare: 'pay_bill',
  retail: 'checkout',
  government: 'pay_fee',
  university: 'pay_tuition_balance',
  workforce: 'submit_expense',
  'sporting-goods': 'extend_rental',
  manufacturing: 'approve_purchase_order',
  investment: 'large_trade',
};

/** Merge per-vertical primaryTool into chipOverrides extras. */
const withPrimaryTool = (toolByVertical, extraByVertical = {}) => {
  const out = { ...extraByVertical };
  for (const [v, primaryTool] of Object.entries(toolByVertical)) {
    out[v] = { primaryTool, ...(out[v] || {}) };
  }
  return out;
};

const READ_PER_VERTICAL = chipOverrides(READ_TRIGGER_BY_VERTICAL, withPrimaryTool(READ_PRIMARY_TOOL_BY_VERTICAL));
const AMOUNT_PER_VERTICAL = (amount, whatToSayByVertical = {}) =>
  chipOverrides(amountTriggerByVertical(amount), withPrimaryTool(AMOUNT_PRIMARY_TOOL_BY_VERTICAL, Object.fromEntries(
    Object.entries(whatToSayByVertical).map(([v, whatToSay]) => [v, { whatToSay }])
  )));


/** @type {UseCase[]} */
const RAW_USE_CASES = [
  // --- FOUNDATIONS ---
  {
    id: 'UC1',
    useCaseId: 'delegated-access-with-proof',
    track: 'foundations',
    title: 'Delegated access with proof',
    buyerStory: "Every agent action must trace back to a real human — no anonymous agent access.",
    pingOneSolution: 'RFC 8693 token exchange mints a delegated token carrying act={agent}; the gateway and Authorize verify the chain.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
    maturity: 'works',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§3.3.3', '§8'] },
    whatToSay: 'The agent acted for you, and the act claim proves it — fully attributable.',
    advanced: false,
    match: { tool: 'get_balance' },
    whatLong: "An AI agent calls a financial tool on the user's behalf — but without proof of delegation, the action is invisible and unattributable. This scenario shows the complete RFC 8693 token-exchange chain: user token → delegated agent token carrying act={agent} → gateway validation → Authorize decision → tool.",
    businessValue: 'Every agent action is cryptographically tied to the user who authorized it. Audit teams get a full chain of custody from user login to tool call — no hand-rolled attribution, no guesswork.',
    productRoles: {
      idp:   'Authenticates the user and mints the delegated token via RFC 8693 exchange, embedding the act claim.',
      gw:    'Validates the token (aud, exp, act) and routes the call only after a PERMIT decision.',
      authz: 'Evaluates the act claim and delegation chain; returns PERMIT for a valid actor.',
    },
    primaryTool: 'get_account_balance',
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC2',
    useCaseId: 'a2a-delegation',
    track: 'foundations',
    title: 'A2A delegation',
    buyerStory: "A generalist agent handing off to a specialist must carry proof of the original user's authorization through the entire chain.",
    pingOneSolution: 'PingOne mints a nested-act delegated token for the specialist; scope is narrowed at each hop.',
    trigger: { type: 'chip', text: 'hand off to a specialist' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched'], activity: ['token', 'delegate', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/a2aDelegationService.js', 'demo_api_server/services/demoAgentLangGraphService.js'],
    maturity: 'flag:ff_a2a_delegation',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Generalist hands off to specialist — the nested act claim shows the full chain back to the user.',
    advanced: false,
    whatLong: "A generalist AI agent hands a task to a specialist sub-agent. Without enforced delegation chains, the specialist acts with the original user's full authority — no narrowing, no proof of the handoff. This scenario demonstrates nested-act token exchange so each hop is attributable and scoped.",
    businessValue: 'Multi-agent pipelines stay governed end-to-end. Each specialist inherits only the scope the handoff explicitly granted — least privilege across agent hops, with the full chain visible in the token.',
    productRoles: {
      idp:   'Mints a nested-act delegated token for the specialist, narrowing scope at each exchange hop.',
      authz: 'Evaluates the full act chain at each hop; denies if any link is unauthorized.',
    },
    primaryTool: 'delegate_to_specialist',
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC2.5',
    useCaseId: 'a2a-orchestrator-learning',
    track: 'foundations',
    title: 'A2A Orchestrator — Interactive Learning',
    buyerStory: 'See how a generalist AI agent detects and routes tasks to specialist sub-agents using multi-agent orchestration and RFC 8693 delegation.',
    pingOneSolution: 'PingOne + multi-agent CrewAI orchestrator analyzes requests, selects specialist agents, and chains delegated tokens with narrowed scopes.',
    trigger: { type: 'chip', text: 'delegate this to a specialist' },
    expectedOutcome: 'DELEGATE_AND_EXECUTE',
    evidence: { tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched'], activity: ['orchestrate', 'delegate', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/a2aOrchestratorService.js', 'demo_api_server/services/a2aDelegationService.js', 'demo_api_ui/src/components/AIAgent.js'],
    maturity: 'works',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Generalist asks an orchestrator to find the right specialist — the nested act chain proves the full handoff.',
    advanced: false,
    whatLong: 'A generalist AI agent receives a complex request and determines it should delegate to a specialist sub-agent. The orchestrator (CrewAI with heuristic fallback) analyzes the message, identifies the best specialist, and orchestrates a two-hop delegation: generalist → specialist with a narrowed RFC 8693 nested-act token. Each hop is attributable and scoped. Watch the token chain and activity panel as the orchestration unfolds in real time.',
    businessValue: 'Multi-agent pipelines become self-organizing. Agents detect when tasks are out of their expertise and route to specialists without hard-coded task mapping. Each hop is governed end-to-end with proven scope narrowing and full auditability — no manual agent orchestration config needed.',
    productRoles: {
      idp:   'Mints nested-act delegated tokens for each hop; generalist token → specialist token with narrowed scopes.',
      gw:    'Routes each leg of the orchestration; the token chain proves who acted for whom.',
      authz: 'Evaluates the full act chain at each hop and narrows policy context for the specialist.',
      llm:   'Orchestrates multi-agent workflows — detects delegation cues, selects specialists, and drives coordinated sub-tasks.',
    },
    primaryTool: null,
  },
  {
    id: 'UC3',
    useCaseId: 'may-act-gate',
    track: 'foundations',
    title: 'act gate',
    buyerStory: "An agent should only be allowed to act on a user's behalf if that user explicitly authorized it.",
    pingOneSolution: "PingOne seeds the exchanged token's act claim from the user's may_act attribute; the authorization server then evaluates act.sub against the authorized actor before every tool call — no match, no permit.",
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision'], activity: ['token', 'authorize'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_api_server/services/oauthService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'works',
    owasp: { threats: ['T3', 'T13'], sections: ['§4.1.1'] },
    whatToSay: "The act claim is the gate — no authorized actor, no tool call — may_act only seeds it at mint time.",
    advanced: false,
    whatLong: "A user's may_act attribute seeds the act claim on the token minted for the requesting agent. Authorization decisions never read may_act directly — every tool call is gated on the act claim's sub matching the authorized actor. This scenario demonstrates the two-stage design: PingOne mints the act claim from may_act, then the authorization server denies any call whose act.sub isn't the authorized agent.",
    businessValue: 'Users control which agents can act for them. The gate is enforced at the authorization server on every call (not just at token mint) — no per-app code required — so adding or revoking agent authorization is a config change, not a deployment.',
    productRoles: {
      idp:   "Seeds the act claim from the user's may_act attribute during token exchange.",
      authz: 'Evaluates the act claim against the authorized actor on every tool call before it is allowed.',
    },
    primaryTool: null,
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC19',
    useCaseId: 'agent-identity-lifecycle',
    track: 'foundations',
    title: 'Non-human (agent) identity lifecycle',
    buyerStory: "Calls from a retired or orphaned agent identity should fail — agent identities need a full lifecycle just like human ones.",
    pingOneSolution: 'PingOne manages the agent app as a first-class identity; rotating or retiring the client credential blocks all subsequent calls.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['token-exchange'], activity: ['token'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js'],
    maturity: 'works',
    owasp: { threats: ['T9', 'T13'], sections: ['§3.3.6', '§8'] },
    whatToSay: 'The agent app was retired — its credential no longer mints tokens, so the call dies at the exchange step.',
    advanced: false,
    whatLong: "A retired or orphaned agent application still holds credentials. Without lifecycle management, those credentials remain valid indefinitely. This scenario demonstrates what happens when the agent app's client credential is revoked in PingOne — subsequent token exchange requests fail, cutting off all tool access immediately.",
    businessValue: 'Agent identities are managed with the same lifecycle rigor as human identities. Retiring a credential in PingOne is instant and complete — no per-tool, per-API, or per-service cleanup required.',
    productRoles: {
      idp:   'Manages the agent app as a first-class identity; disabling or rotating the credential blocks all subsequent token exchanges.',
    },
    primaryTool: null,
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC20',
    useCaseId: 'audit-trail',
    track: 'foundations',
    title: 'Audit trail / traceability',
    buyerStory: "Every agent action must be attributable end-to-end — who the agent was, who it acted for, and what it did.",
    pingOneSolution: 'Every token event and activity log is stamped with useCaseId and the act chain; both evidence panels reconstruct the full trace.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_api_server/services/appEventService.js'],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§3.3.3', '§8'] },
    whatToSay: 'Every step is logged with useCaseId and the act chain — the full trace is always reconstructable.',
    advanced: false,
    whatLong: 'After every agent action, there must be a complete, reconstructable audit trail: who the agent was, who authorized it, what it did, and what the policy decided. This scenario demonstrates the full trace — from user login through token exchange, Authorize decision, and tool dispatch — surfaced in the evidence panels.',
    businessValue: 'Compliance and incident response depend on traceable agent actions. The useCaseId, act chain, and decision outcome are stamped on every event — building a complete, immutable audit trail without any application-layer instrumentation.',
    productRoles: {
      idp:   'Stamps the act chain on every token event; the exchange history is the attribution record.',
      gw:    'Logs the tool call, the acting agent, and the Authorize decision outcome.',
      authz: 'Records the policy decision (PERMIT/DENY/STEP_UP) for every evaluated request.',
    },
    primaryTool: null,
    perVertical: READ_PER_VERTICAL,
  },

  // --- CONTROLS ---
  {
    id: 'UC4',
    useCaseId: 'overscoped-agent',
    track: 'controls',
    title: 'Overscoped agent',
    buyerStory: "An agent holding more scope than the task needs is a standing privilege-escalation risk.",
    pingOneSolution: 'The scope topology surfaces the mismatch; least-privilege hygiene narrows the token to only what the tool requires.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision'], activity: ['token', 'authorize'] },
    codeRefs: ['demo_api_server/config/scopes.js', 'demo_api_server/services/agentMcpTokenService.js'],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§5.1'] },
    whatToSay: 'The agent asked for write when it only needed read — least-privilege narrows it before any tool runs.',
    advanced: false,
    whatLong: 'An agent requests broader OAuth scopes than the task actually needs — for example, write scope to perform a read-only operation. This creates a standing privilege that can be exploited if the token is stolen or the agent misbehaves. The scenario surfaces the mismatch using the scope topology.',
    businessValue: "Least-privilege enforcement catches scope bloat before it becomes a risk. Security teams can audit every agent's effective scope against what the tools actually require — with a single canonical topology file as the source of truth.",
    productRoles: {
      idp:   'Issues the token with the scopes the agent requested; the topology then surfaces any excess.',
      authz: 'Evaluates scope requirements per tool; a token carrying only the needed scope is the correct posture.',
      gw:    'Enforces the required scopes at the gateway boundary — excess scope is harmless here but the mismatch is visible.',
    },
    primaryTool: null,
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC6',
    useCaseId: 'authz-denied',
    track: 'controls',
    title: 'Authz denied',
    buyerStory: "A policy-violating agent action — like an amount over the limit — must be denied before the tool executes.",
    pingOneSolution: 'PingOne Authorize evaluates the request and returns DENY; the gateway stops the call.',
    trigger: { type: 'chip', text: 'transfer $2500 from checking to savings' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/simulatedAuthorizeService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'works',
    owasp: { threats: ['T6'], sections: ['§4.2.2'] },
    whatToSay: '$2500 exceeds the policy ceiling — Authorize returns DENY before the transfer runs.',
    advanced: false,
    match: { tool: 'create_transfer', amountMin: 2000.01 },
    whatLong: 'An agent attempts a transaction that exceeds a hard policy ceiling — for example, a $2,500 transfer. The Authorize engine evaluates the request before the tool runs and returns DENY. The gateway stops the call; no money moves.',
    businessValue: 'Policy enforcement is externalized and instant. Changing the deny ceiling is a rule edit — not a code change — and takes effect immediately across every agent and every channel.',
    productRoles: {
      idp:   'Issues the delegated token the agent presents at the gateway.',
      gw:    'Forwards the request to Authorize; stops the tool call on DENY.',
      authz: 'Evaluates the transaction amount against the ceiling rule and returns DENY.',
    },
    primaryTool: 'create_transfer',
    perVertical: AMOUNT_PER_VERTICAL(2500, {
      healthcare: '$2500 bill payment exceeds the policy ceiling — Authorize returns DENY.',
      retail: '$2500 checkout exceeds the policy ceiling — Authorize returns DENY.',
      government: '$2500 fee payment exceeds the policy ceiling — Authorize returns DENY.',
      university: '$2500 tuition payment exceeds the policy ceiling — Authorize returns DENY.',
      workforce: '$2500 expense exceeds the policy ceiling — Authorize returns DENY.',
      'sporting-goods': '$2500 rental extension exceeds the policy ceiling — Authorize returns DENY.',
      manufacturing: '$2500 purchase-order approval exceeds the policy ceiling — Authorize returns DENY.',
    }),
  },
  {
    id: 'UC7',
    useCaseId: 'step-up-required',
    track: 'hitl',
    title: 'Step-up required',
    buyerStory: "A high-value agent action shouldn't go through on the agent's say-so alone.",
    pingOneSolution: 'PingOne Authorize returns a step-up obligation → MFA before PERMIT.',
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },
    expectedOutcome: 'STEP_UP',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/simulatedAuthorizeService.js', 'demo_api_server/services/authorizeObligations.js'],
    maturity: 'works',
    owasp: { threats: ['T10', 'T3'], sections: ['§3.1.5', '§5.6'] },
    whatToSay: '$600 >= $500 → MFA required, then it proceeds.',
    advanced: false,
    match: { tool: 'create_transfer', amountMin: 500, amountMax: 2000 },
    whatLong: 'An agent attempts a mid-range transfer ($600). The amount clears the step-up threshold but not the hard deny ceiling. Authorize returns a step-up obligation — the agent must pause, the user must satisfy MFA, and only then does the policy re-evaluate to PERMIT.',
    businessValue: 'High-value actions get a proportional gate. Step-up is policy-driven, not hard-coded: the threshold is a rule you change in the Authorize console without redeploying anything.',
    productRoles: {
      idp:   'Authenticates the user and mints the delegated agent token.',
      gw:    'Receives the step-up obligation from Authorize; holds the call until the MFA receipt is presented.',
      authz: 'Returns the STEP_UP obligation for the mid-range amount; re-evaluates to PERMIT after MFA.',
      mfa:   'Delivers the step-up challenge; the success receipt is presented back to the policy for re-evaluation.',
    },
    primaryTool: 'create_transfer',
    perVertical: AMOUNT_PER_VERTICAL(600, {
      healthcare: '$600 bill payment >= the step-up bar → MFA required first.',
      retail: '$600 checkout >= the step-up bar → MFA required first.',
      government: '$600 fee payment >= the step-up bar → MFA required first.',
      university: '$600 tuition payment >= the step-up bar → MFA required first.',
      workforce: '$600 expense >= the step-up bar → MFA required first.',
      'sporting-goods': '$600 rental extension >= the step-up bar → MFA required first.',
      manufacturing: '$600 purchase-order approval >= the step-up bar → MFA required first.',
    }),
  },
  {
    id: 'UC8',
    useCaseId: 'hitl-consent',
    track: 'hitl',
    title: 'HITL consent',
    buyerStory: "Some agent actions are consequential enough to require a human approval — not just an MFA tap.",
    pingOneSolution: 'PingOne Authorize returns a HITL obligation; the agent pauses until a verified human approval receipt is received.',
    trigger: { type: 'chip', text: 'transfer $300 from checking to savings' },
    expectedOutcome: 'HITL_REQUIRED',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp', 'hitl'] },
    codeRefs: ['demo_api_server/services/authorizeObligations.js', 'demo_api_server/routes/hitl.js'],
    maturity: 'works',
    owasp: { threats: ['T10'], sections: ['§3.1.5', '§8'] },
    whatToSay: 'The agent paused and waited — the transfer only ran after you approved it.',
    advanced: false,
    // Phase 170: ALL transfers require consent (type-gated), not only amounts ≥ $250.
    match: { tool: 'create_transfer', amountMin: 0.01, amountMax: 499.99 },
    whatLong: 'An agent attempts a transfer that requires more than a user tap — a full human-in-the-loop approval. Authorize returns a HITL obligation; the agent is forced to pause and surface a consent modal. Only after the user explicitly approves is the action retried and PERMIT returned.',
    businessValue: 'Consequential agent actions are gated on verified human consent — not inferred intent. The approval is policy-triggered and auditable, with a cryptographic receipt tying the consent to the eventual tool call.',
    productRoles: {
      idp:   'Mints the delegated token the agent uses to call the gateway.',
      gw:    'Receives the HITL obligation; blocks the tool until the agent presents a HITL receipt.',
      authz: 'Returns the HITL obligation; re-evaluates to PERMIT only when HitlApproved=true is presented.',
    },
    primaryTool: 'create_transfer',
    perVertical: AMOUNT_PER_VERTICAL(300, {
      healthcare: '$300 bill payment requires human consent before it runs.',
      retail: '$300 checkout requires human consent before it runs.',
      government: '$300 fee payment requires human consent before it runs.',
      university: '$300 tuition payment requires human consent before it runs.',
      workforce: '$300 expense requires human consent before it runs.',
      'sporting-goods': '$300 rental extension requires human consent before it runs.',
      manufacturing: '$300 purchase-order approval requires human consent before it runs.',
    }),
  },
  {
    id: 'UC9',
    useCaseId: 'group-entitlement-check',
    track: 'controls',
    title: 'Group / entitlement check',
    buyerStory: "An agent acting for a user who is not in the required group must be denied, regardless of the token's scopes.",
    pingOneSolution: 'PingOne Authorize evaluates the user group membership claim and returns DENY when the user is not entitled.',
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize'] },
    codeRefs: ['demo_api_server/services/simulatedAuthorizeService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'flag:ff_authorize_group_policy',
    owasp: { threats: ['T3'], sections: ['§4.1.1'] },
    whatToSay: "The user isn't in the required group — Authorize denies regardless of scopes.",
    advanced: false,
    whatLong: "A user who is not a member of the required PingOne group attempts an action that requires that membership. The Authorize policy evaluates the group claim in the token and returns DENY — regardless of whether the token's scopes would otherwise permit the action.",
    businessValue: 'Group-based entitlement decisions are centralized in policy, not scattered across services. Adding a user to a group in PingOne immediately expands what their agent can do — no code change, no cache invalidation.',
    productRoles: {
      idp:   "Includes the user's group membership claim in the token.",
      authz: 'Evaluates the group claim against the entitlement rule; returns DENY when the user is not a member.',
      gw:    'Enforces the DENY returned by Authorize before any tool is dispatched.',
    },
    primaryTool: null,
    perVertical: AMOUNT_PER_VERTICAL(600),
  },
  {
    id: 'UC21',
    useCaseId: 'entitlement-tiered-capability',
    track: 'controls',
    title: 'Entitlement-tiered capability',
    buyerStory: "A premium-tier user's agent should have access to higher-value tools; a standard user's agent should not even see them.",
    pingOneSolution: "PingOne group membership drives a per-tier tool set and amount limits; the user's tier expands what the agent may do.",
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['authorize-decision', 'tool-dispatched'], activity: ['authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/simulatedAuthorizeService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§4.1.1', '§5.1'] },
    whatToSay: "Private Banking tier gets wire tools and a higher limit; Standard tier's agent is not offered them.",
    advanced: false,
    match: { tool: 'create_transfer', amountMin: 500, amountMax: 2000 },
    primaryTool: 'create_transfer',
    whatLong: "A Private Banking tier user's agent should have access to higher-value tools and limits; a Standard tier user's agent should not even be offered them. PingOne group membership drives the tier — the agent's available tool set and limits expand with the user's entitlement tier.",
    businessValue: "Tiered entitlement is policy-driven, not hard-coded. Promoting a user to a higher tier in PingOne immediately changes what their agent can do — with no code change and no redeploy.",
    productRoles: {
      idp:   "Includes the user's tier group membership claim in the token.",
      authz: 'Evaluates the tier claim against the entitlement rule; adjusts the permitted tool set and limits.',
      gw:    'Enforces the per-tier decision from Authorize before dispatching tool calls.',
    },
    perVertical: AMOUNT_PER_VERTICAL(600),
  },
  {
    id: 'UC22',
    useCaseId: 'ciba-out-of-band-approval',
    track: 'hitl',
    title: 'CIBA out-of-band approval',
    buyerStory: "A high-value action should be approvable on the user's separate device, not just in the same browser session.",
    pingOneSolution: 'PingOne CIBA sends a backchannel auth request; the agent polls for the auth_req_id and proceeds only after the user approves on their device.',
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['authorize-decision', 'ciba-poll', 'tool-dispatched'], activity: ['authorize', 'mcp', 'ciba'] },
    codeRefs: ['demo_api_server/services/cibaService.js', 'demo_api_server/routes/ciba.js'],
    maturity: 'flag:ff_ciba',
    owasp: { threats: ['T10'], sections: ['§3.1.5'] },
    whatToSay: 'The approval came from the user\'s phone — a decoupled, out-of-band confirmation distinct from in-app step-up.',
    advanced: false,
    whatLong: "A high-value action requires approval on the user's separate device — not in the same browser session. PingOne CIBA (Client-Initiated Backchannel Authentication) sends an out-of-band approval request; the agent polls for the result and proceeds only after the user approves on their phone.",
    businessValue: 'Out-of-band approval is meaningfully stronger than in-session step-up — a compromised browser cannot self-approve. CIBA is natively supported by PingOne; no custom push notification infrastructure is needed.',
    productRoles: {
      idp:   "Receives the CIBA auth_req_id request and delivers the approval challenge to the user's device.",
      authz: 'Evaluates the CIBA approval receipt; returns PERMIT only after the user has approved out-of-band.',
      gw:    'Holds the tool call until the agent presents the CIBA approval receipt.',
      mfa:   "Delivers the CIBA challenge to the user's enrolled device (push notification / OTP).",
    },
    primaryTool: null,
    perVertical: AMOUNT_PER_VERTICAL(600),
  },

  // --- PROGRESSIVE TRUST DEMO (Ping MyHotels pattern on banking agents) ---
  {
    id: 'UC23',
    useCaseId: 'progressive-trust-demo',
    track: 'demo',
    title: 'Progressive trust demo — presenter guide',
    buyerStory: 'Personal agents should move from public access to authenticated access, in-app step-up, out-of-band approval, and hard deny — without collapsing trust into one token.',
    pingOneSolution: 'PingOne OAuth, Authorize, RFC 8693 token exchange, and CIBA — orchestrated by the BFF and MCP gateway while Helix, llama.cpp, or Google routes tool calls.',
    trigger: { type: 'link', path: '/use-cases', label: 'Run Acts 1–5 below in order' },
    expectedOutcome: 'GUIDED_DEMO',
    evidence: { tokenChain: ['authorize-decision', 'token-exchange', 'tool-dispatched', 'ciba-poll'], activity: ['authorize', 'token', 'mcp', 'hitl', 'ciba'] },
    codeRefs: ['docs/planning/PLAN-progressive-trust-demo.md', 'demo_api_server/services/agentModeResolver.js'],
    maturity: 'works',
    owasp: { threats: ['T8', 'T10'], sections: ['§3.1.5', '§4.1.1', '§8'] },
    whatToSay: 'Five acts, one story — progressive trust from public catalog to policy deny, with full delegation visible in the Token Chain panel.',
    advanced: false,
    whatLong: 'Guided presenter journey mapped from the Ping Identity MyHotels blog to Super Banking. The act strip on this page references existing use cases: Act 1 (UC24 public catalog); Act 2 → UC1 delegated access; Act 3 → UC8 HITL; Act 4 → UC7 MFA step-up; optional Act 4b → UC22 CIBA when ciba_enabled; Act 5 → UC6 policy DENY. Run Act 1 from here, then Acts 2–5 on the dashboard with Token Chain and Activity panels open.',
    businessValue: 'One narrated walkthrough that shows buyers how PingOne secures personal agents across trust boundaries — without ChatGPT or a third-party agent host.',
    productRoles: {
      idp:   'Authenticates the user and mints delegated tokens when protected tools are invoked.',
      gw:    'Enforces Authorize on every tool call and performs RFC 8693 re-exchange to the MCP audience.',
      authz: 'Returns PERMIT, HITL obligation, CIBA requirement, or DENY based on tool and transaction amount.',
      llm:   'Routes natural-language prompts to tools (Helix, llama.cpp, or Google) — never holds tokens.',
    },
    primaryTool: null,
  },
  {
    id: 'UC24',
    useCaseId: 'progressive-trust-public-access',
    track: 'demo',
    title: 'Act 1 — Public catalog access',
    buyerStory: 'Users should explore low-risk information before signing in — auth only when value is clear.',
    pingOneSolution: 'PingOne Authorize PERMITs a read-only public tool with no token exchange.',
    trigger: { type: 'chip', text: 'What branches are near me?' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['authorize-decision', 'tool-dispatched'], activity: ['mcp', 'authorize'] },
    codeRefs: ['docs/planning/PLAN-progressive-trust-demo.md', 'demo_api_server/data/publicBranchCatalog.js', 'demo_mcp_server/src/tools/handlers/publicCatalogHandlers.ts'],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§4.1.1'] },
    whatToSay: 'Low-friction first — no token exchange for public catalog data.',
    advanced: false,
    match: { tool: 'get_branch_hours' },
    whatLong: 'Act 1 of the progressive trust demo. The agent answers a public branch-catalog question without authentication — mirroring the MyHotels public hotel search. Requires a read-only MCP tool (e.g. get_branch_hours) with Authorize PERMIT for anonymous callers.',
    businessValue: 'Demonstrates progressive authentication — users are not forced to sign in before seeing non-sensitive catalog data.',
    productRoles: {
      authz: 'Returns PERMIT for the public tool without requiring a bearer token.',
      gw:    'Allows the unauthenticated tool call while remaining fail-closed for all other tools.',
    },
    primaryTool: 'get_branch_hours',
    // Every vertical stores its own primaryTool even though the value is the
    // same everywhere (the public catalog tool) — isolation over DRY, so a
    // change to one vertical's entry cannot ripple into another's.
    perVertical: chipOverrides({
      healthcare: 'What clinics are near me?',
      retail: 'What stores are near me?',
      government: 'What city offices are near me?',
      university: 'What campus locations are near me?',
      workforce: 'What office locations are near me?',
      'sporting-goods': 'What stores are near me?',
      manufacturing: 'What plant locations are near me?',
      investment: 'What branches are near me?',
    }, withPrimaryTool({
      healthcare: 'get_branch_hours',
      retail: 'get_branch_hours',
      government: 'get_branch_hours',
      university: 'get_branch_hours',
      workforce: 'get_branch_hours',
      'sporting-goods': 'get_branch_hours',
      manufacturing: 'get_branch_hours',
      investment: 'get_branch_hours',
    })),
  },
  {
    id: 'UC26',
    useCaseId: 'proof-of-enforcement',
    track: 'demo',
    title: 'Proof of enforcement — live verdict on every use case',
    buyerStory: "Buyers shouldn't have to trust the chat reply — every enforcement decision should be visibly, verifiably proven on screen, not just claimed.",
    pingOneSolution: 'Every tool call is tagged end-to-end with the triggering useCaseId and active vertical (chip, launcher, or attack sim; any agent mode), stamped onto the token chain, the PingOne Authorize decision, and the activity log. A client-side verdict engine compares what actually happened against each use case\'s declared evidence and expected outcome, then renders the result live.',
    trigger: { type: 'link', path: '/use-cases', label: 'Trigger any use case below and watch the verdict appear' },
    expectedOutcome: 'GUIDED_DEMO',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [
      'demo_api_ui/src/context/ProofOfEnforcementContext.js',
      'demo_api_ui/src/components/ProofStrip.jsx',
      'demo_api_ui/src/components/VerifiedBanner.jsx',
      'demo_api_ui/src/components/education/TokenChainPanel.js',
      'demo_api_server/services/useCaseTagging.js',
    ],
    maturity: 'works',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§8'] },
    whatToSay: 'You don\'t have to take the agent\'s word for it — watch the verdict prove it, live, for whatever you just triggered.',
    advanced: false,
    whatLong: 'A cross-cutting capability, not a single narrative: whenever any of the use cases above fires (chip, Use-Case Launcher, or attack simulation, in Heuristics or any LLM mode), three surfaces render a verdict comparing the real trace against that use case\'s declared evidence — an inline strip under the chat reply, a use-case-aware checklist card in the Token Chain panel, and a room-facing "Verified" banner that expands into the full trace. States: verified, denied-as-expected (for attacks/step-up/HITL), mismatch (the real outcome contradicted what was expected — the signal this feature exists to surface), and incomplete (evidence still arriving).',
    businessValue: 'Turns "trust the demo" into "watch the proof" — every enforcement claim in every other use case on this page is independently, visibly verified rather than asserted.',
    productRoles: {
      idp:   'PingOne Authorize\'s real decision is what the verdict is checked against — nothing is simulated for this capability.',
      gw:    'Every tool call is tagged with useCaseId + vertical before dispatch, so the authorize decision and activity log carry it end to end.',
    },
    primaryTool: null,
  },

  // --- ATTACKS ---
  {
    id: 'UC5',
    useCaseId: 'insufficient-scope',
    track: 'attacks',
    title: 'Wrong / insufficient scope',
    buyerStory: "An agent with the wrong scope should never reach the tool — scope enforcement is the last line of defense.",
    pingOneSolution: 'The MCP server validates required scopes before dispatching; a token missing a required scope yields DENY.',
    trigger: { type: 'attack', sim: 'insufficient-scope' },
    expectedOutcome: 'DENY_403',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'mcp'] },
    codeRefs: ['demo_mcp_server/src/auth/validateTokenScopes.js', 'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
    maturity: 'works',
    owasp: { threats: ['T2', 'T3'], sections: ['§5.1'] },
    whatToSay: 'The token had read scope, the tool needed write — scope enforcement stopped it cold.',
    advanced: false,
    whatLong: "An agent's token is missing a required scope — for example, a read-only token attempting a write tool call. Scope enforcement at the gateway is the last line of defense: the tool must never execute if the token cannot satisfy its scope requirement.",
    businessValue: 'Scope enforcement is automatic and centralized. No tool needs to re-validate scopes in application code — the gateway and MCP server enforce the topology contract before dispatch.',
    productRoles: {
      idp:   'Issues the token with only the scopes the agent was granted.',
      gw:    'Checks required scopes against the token before routing; returns DENY_403 on mismatch.',
    },
    primaryTool: null,
  },
  {
    id: 'UC10',
    useCaseId: 'cross-owner-account',
    track: 'attacks',
    title: 'Resource-ownership / account takeover',
    buyerStory: "An agent must never act on another user's resources — even with a valid token.",
    pingOneSolution: 'PingOne Authorize binds the resource to the token subject; a cross-owner request is denied.',
    trigger: { type: 'attack', sim: 'cross-owner-account' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/simulatedAuthorizeService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§2.2.1', '§4.2.2'] },
    whatToSay: "The agent tried to read another user's account — Authorize matched the resource owner and denied it.",
    advanced: false,
    whatLong: "An agent presents a valid delegated token but attempts to read an account belonging to a different user. The Authorize policy binds the resource to the token subject — even a valid, scoped, properly-delegated token is denied if the requested resource belongs to someone else.",
    businessValue: 'Resource-ownership checks are automatic and policy-driven. Applications do not need to implement owner checks in business logic — Authorize enforces them for every agent call, without exception.',
    productRoles: {
      idp:   'Issues the token with the subject (user) claim that Authorize checks against the resource owner.',
      authz: 'Binds the resource to the token sub; returns DENY on an ownership mismatch.',
      gw:    'Stops the tool call on DENY before any data is returned.',
    },
    primaryTool: null,
  },
  {
    id: 'UC11',
    useCaseId: 'bad-client-gateway',
    track: 'attacks',
    title: 'Bad client → agent gateway',
    buyerStory: 'A malformed or stolen token must never reach the tools.',
    pingOneSolution: 'The gateway validates aud/exp/iss/nbf before any routing; a bad token is rejected with 401.',
    trigger: { type: 'attack', sim: 'wrong-aud' },
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
    maturity: 'works',
    owasp: { threats: ['T9'], sections: ['§8', '§4.2.2'] },
    whatToSay: 'Wrong audience → the gateway refuses it before a tool is ever touched.',
    advanced: false,
    whatLong: 'An agent presents a token with the wrong audience — or a malformed, expired, or incorrectly signed token. The gateway validates aud, exp, iss, and nbf before any routing occurs; the call is rejected with 401 and no tool is ever touched.',
    businessValue: 'Token validation at the gateway perimeter means that all downstream services are shielded from malformed credentials. A single enforcement point replaces per-service token checks.',
    productRoles: {
      gw:    'Validates aud/exp/iss/nbf on every inbound token; rejects malformed tokens with 401 before routing.',
    },
    primaryTool: null,
  },
  {
    id: 'UC12',
    useCaseId: 'token-theft-replay',
    track: 'attacks',
    title: 'Token theft / replay defense',
    buyerStory: "A stolen token must be unusable — audience binding and DPoP key binding ensure it can't be replayed.",
    pingOneSolution: 'The gateway enforces audience binding (D-05) unconditionally; DPoP key binding adds a proof-of-possession check when enabled.',
    trigger: { type: 'attack', sim: 'replayed-token' },
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_api_server/services/dpopKeyService.js'],
    maturity: 'flag:ff_dpop',
    owasp: { threats: ['T9'], sections: ['§3.2.8', '§4.2.3'] },
    whatToSay: 'Audience binding is unconditional; with DPoP on, a stolen token without the private key is worthless.',
    advanced: false,
    whatLong: "A valid delegated token is stolen and replayed by a different party. Audience binding means the token is only accepted by the specific gateway it was minted for — it cannot be used against a different endpoint. When DPoP is enabled, a cryptographic key-binding check is also enforced.",
    businessValue: 'Audience binding is free and always on. DPoP adds key-binding so a stolen token without the private key is useless — two layers of replay defense without application changes.',
    productRoles: {
      idp:   "Mints the token with a specific aud and — when DPoP is on — binds it to the agent's DPoP key.",
      gw:    'Enforces aud binding unconditionally; validates the DPoP proof when the feature flag is enabled.',
    },
    primaryTool: null,
  },
  {
    id: 'UC13',
    useCaseId: 'confused-deputy-actor-injection',
    track: 'attacks',
    title: 'Confused-deputy actor injection',
    buyerStory: "A rogue agent forcing itself into the act claim must be caught — only the authorized actor is allowed.",
    pingOneSolution: 'The gateway and Authorize check ActClientId against the single configured authorized actor; a rogue actor is denied.',
    trigger: { type: 'attack', sim: 'rogue-actor' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_authz_server/routes/decision.js'],
    maturity: 'works',
    owasp: { threats: ['T13'], sections: ['§4.2.2'] },
    whatToSay: 'The act claim named a rogue client — the authorized-actor check blocked it immediately.',
    advanced: false,
    whatLong: 'A rogue agent injects itself into the act claim, claiming to be the authorized actor. The gateway and Authorize policy both check the ActClientId claim against the single configured authorized actor client ID — an unrecognized actor is denied immediately.',
    businessValue: 'One configuration — the authorized actor client ID — locks down which agent may act on users behalf. No rogue actor can forge its way into the delegation chain.',
    productRoles: {
      gw:    'Extracts the act.sub claim and forwards it to Authorize as ActClientId.',
      authz: 'Checks ActClientId against the configured authorized actor; returns DENY for any other value.',
    },
    primaryTool: null,
  },
  {
    id: 'UC14',
    useCaseId: 'rar-intent-violation',
    track: 'attacks',
    title: 'RAR intent violation',
    buyerStory: "An agent that exceeds the amount or payee granted in its Rich Authorization Request must be denied.",
    pingOneSolution: 'PingOne Authorize evaluates authorization_details; exceeding the granted amount or payee yields DENY.',
    trigger: { type: 'attack', sim: 'rar-exceeded' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/intentTokenService.js', 'demo_authz_server/routes/decision.js'],
    maturity: 'flag:ff_rar',
    owasp: { threats: ['T6'], sections: ['RFC 9396', '§3.1.7'] },
    whatToSay: 'The agent tried to transfer more than the RAR granted — Authorize caught the overage and denied it.',
    advanced: true,
    whatLong: 'An agent was authorized via a Rich Authorization Request (RFC 9396) for a specific amount and payee. It then attempts a transfer that exceeds the granted authorization_details. Authorize evaluates the RAR context and returns DENY when the actual request exceeds the intent.',
    businessValue: 'RAR ties authorization to a specific intent — amount, payee, purpose. An agent cannot exceed what the user explicitly approved, even if the token scopes would otherwise allow it.',
    productRoles: {
      idp:   'Mints the token with the authorization_details claim encoding the approved intent.',
      authz: 'Compares the live request parameters against the RAR grant; returns DENY on overage.',
      gw:    'Forwards the intent context to Authorize and enforces the DENY.',
    },
    primaryTool: null,
  },
  {
    id: 'UC14b',
    useCaseId: 'rar-intent-verified',
    track: 'learn',
    title: 'RAR intent verified (PERMIT)',
    buyerStory: 'A transfer that stays within its declared RFC 9396 authorization_details cap is verified and permitted — the legitimate counterpart to the RAR overage attack.',
    pingOneSolution: 'RFC 9396 authorization_details bind the transfer to an amount cap; the MCP gateway and PingOne Authorize verify the requested transfer against it before permitting.',
    trigger: { type: 'link', path: '/intent-binding-learning#rar' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['sim-rar-armed', 'sim-rar-grant', 'intent-binding-verified'], activity: [] },
    codeRefs: [
      'demo_api_server/services/attackSimulatorService.js',
      'demo_api_server/services/agentMcpTokenService.js',
      'demo_mcp_gateway/src/rarEnforce.ts',
    ],
    maturity: 'flag:ff_rar',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Same RAR grant UC14 attacks, but requested within the cap — the gateway and PingOne Authorize permit it and the token chain shows an Intent Verified step.',
    advanced: false,
    whatLong: 'A learning scenario (not an attack): the counterpart to UC14 (RAR overage attack). Here, the agent was authorized via RFC 9396 Rich Authorization Request for a specific transfer amount and payee. The agent requests a transfer that stays within the granted authorization_details. The gateway and PingOne Authorize verify the request against the RAR grant and return PERMIT — the token chain shows an Intent Verified step.',
    businessValue: 'RAR ties authorization to the exact user intent — the agent can only do what was explicitly approved. This scenario shows the happy path where the agent respects the limits.',
    productRoles: {},
    primaryTool: 'create_transfer',
  },
  {
    id: 'UC15',
    useCaseId: 'intent-token-tampering',
    track: 'attacks',
    title: 'Intent-token tampering',
    buyerStory: "A tampered or expired intent token must be detected before it can authorize a larger or different action.",
    pingOneSolution: 'The gateway validates the intent token signature and expiry; a tampered or expired token is rejected.',
    trigger: { type: 'attack', sim: 'tampered-intent-token' },
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_api_server/services/intentTokenService.js'],
    maturity: 'needs-build',
    owasp: { threats: ['T6', 'T8'], sections: ['§4.2.2'] },
    whatToSay: 'The intent token was altered — the signature check caught the tampering before any tool ran.',
    advanced: true,
    whatLong: 'An intent token (encoding the approved transaction parameters) is tampered with — the amount or payee is altered before the agent presents it. The gateway validates the token signature and expiry; a tampered or expired intent token is rejected before any tool runs.',
    businessValue: 'Cryptographic signing of intent tokens means any in-flight modification is immediately detectable — even if the attacker has network access. No application code needs to verify intent integrity.',
    productRoles: {
      gw:    'Validates the intent token signature and expiry; rejects tampered or expired tokens with 401.',
      idp:   'Signs the intent token at issuance, providing the cryptographic baseline for gateway validation.',
    },
    primaryTool: null,
  },
  {
    id: 'UC16',
    useCaseId: 'impersonation-blocked',
    track: 'attacks',
    title: 'Impersonation blocked (OBO required)',
    buyerStory: "An agent presenting a pure impersonation token — with the user as sub but no act claim — must be rejected; only on-behalf-of delegation is allowed.",
    pingOneSolution: 'The gateway requires an act claim for agent-mediated tool calls; a missing act claim is rejected before any tool runs.',
    trigger: { type: 'attack', sim: 'impersonation-no-act' },
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts', 'demo_authz_server/routes/decision.js'],
    maturity: 'needs-build',
    owasp: { threats: ['T9'], sections: ['§3.3.6', '§4.1.1'] },
    whatToSay: 'No act claim means no attribution — the gateway rejects pure impersonation to keep every action traceable.',
    advanced: false,
    whatLong: 'An agent presents a token where the user is listed as sub but there is no act claim — a pure impersonation posture, not an on-behalf-of delegation. The gateway requires an act claim for all agent-mediated tool calls; a missing act claim is rejected before any tool runs.',
    businessValue: 'Every agent action must be attributable. Requiring an act claim enforces the on-behalf-of model — preventing silent impersonation and ensuring every tool call carries a verifiable chain of custody.',
    productRoles: {
      gw:    'Requires an act claim on every agent-mediated tool call; rejects tokens without one.',
      authz: 'Validates the act chain when present; this scenario demonstrates the absence case.',
    },
    primaryTool: null,
  },
  {
    id: 'UC17',
    useCaseId: 'jit-ephemeral-credentials',
    track: 'controls',
    title: 'JIT / ephemeral credentials',
    buyerStory: "A long-lived agent credential is a standing risk — tokens should be short-lived so a captured one is dead within minutes.",
    pingOneSolution: 'PingOne issues delegated tokens with a tight TTL; a refresh loop ensures the agent always holds a fresh credential.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'tool-dispatched'], activity: ['token', 'mcp'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_api_server/services/oauthService.js'],
    maturity: 'works',
    owasp: { threats: ['T3', 'T9'], sections: ['§3.2.8', '§4.1.1'] },
    whatToSay: 'The delegated token expires in minutes — a credential captured later is already dead.',
    advanced: false,
    whatLong: 'Long-lived agent credentials are a standing risk: a credential captured today is still valid tomorrow. This scenario demonstrates just-in-time ephemeral token issuance with short TTLs — a captured token expires in minutes, not days.',
    businessValue: "Short-lived credentials are a built-in risk reducer. PingOne's token TTL configuration is the only control needed — no custom secret rotation infrastructure required.",
    productRoles: {
      idp:   'Issues delegated tokens with a configurable TTL; the short expiry is enforced at introspection.',
      gw:    'Introspects every token; a token past its TTL is rejected with 401 even if its signature is valid.',
    },
    primaryTool: null,
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC18',
    useCaseId: 'rate-limit-defense',
    track: 'attacks',
    title: 'Rate-limit / resource-overload defense',
    buyerStory: "An agent flooding the gateway with tool calls must be throttled before it exhausts resources or runs up cost.",
    pingOneSolution: 'The agent gateway enforces per-agent / per-tool rate limits; a burst of calls is rejected with 429.',
    trigger: { type: 'attack', sim: 'rate-limit-burst' },
    expectedOutcome: 'DENY_429',
    evidence: { tokenChain: ['user-token'], activity: ['gateway'] },
    codeRefs: ['demo_mcp_gateway/src/rateLimit.ts', 'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts'],
    maturity: 'works',
    owasp: { threats: ['T4'], sections: ['§4.2.3', '§8'] },
    whatToSay: 'Burst of tool calls → gateway returns 429 and cuts off the flood.',
    advanced: false,
    whatLong: 'An agent floods the gateway with rapid sequential tool calls — either to exhaust resources, rack up costs, or probe policy thresholds. The gateway enforces per-agent and per-tool rate limits; calls beyond the quota are rejected with 429 before any tool is dispatched.',
    businessValue: 'Rate limiting at the gateway perimeter protects upstream services and LLM budgets from runaway or adversarial agents — without application-layer changes.',
    productRoles: {
      gw:    'Enforces per-agent / per-tool rate limits; returns 429 on quota breach before any tool dispatch.',
    },
    primaryTool: null,
  },

  // --- DEVELOPER TOOLS ---
  {
    id: 'UC-TOOL1',
    useCaseId: 'code-search',
    track: 'tools',
    title: 'RAG code search',
    buyerStory: 'Semantic search across an indexed codebase — ask in plain language, get the relevant code back.',
    pingOneSolution: 'Local RAG pipeline: llama.cpp embeddings + Weaviate vector store, served by the code-search service. No cloud calls, no Ollama.',
    trigger: { type: 'link', path: '/code-search', label: 'Open Code Search' },
    expectedOutcome: 'RANKED_RESULTS',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_mcp_code_search/src/server.ts', 'demo_mcp_code_search/src/weaviateStore.ts', 'demo_api_server/routes/codeSearch.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Index a codebase, then ask in natural language — the RAG pipeline returns the most relevant chunks, ranked.',
    advanced: false,
    whatLong: 'A developer utility (not an identity scenario): upload a codebase, and it is chunked, embedded with a local llama.cpp embedding model, and stored in Weaviate as bring-your-own vectors. A natural-language query is embedded and matched by vector similarity, returning ranked code chunks with file and line ranges.',
    businessValue: 'Semantic code search runs entirely locally — llama.cpp for embeddings, Weaviate for the vector index — with no external API calls and no Ollama dependency.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-TOOL2',
    useCaseId: 'code-explorer',
    track: 'tools',
    title: 'Code Explorer',
    buyerStory: 'Ask about flows, architecture, patterns, and implementation details — with real, current code context.',
    pingOneSolution: 'Powered by CodeGraph — a semantic code knowledge graph that indexes every symbol, file, and dependency for AI-powered exploration.',
    trigger: { type: 'link', path: '/code-explorer', label: 'Open Code Explorer' },
    expectedOutcome: 'CODE_CONTEXT',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/CodeExplorerPage.jsx'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Ask how a feature works — CodeGraph answers with the actual current source, not a guess.',
    advanced: false,
    whatLong: 'A developer utility (not an identity scenario): CodeGraph indexes every symbol, file, and dependency in the codebase into a knowledge graph, then answers natural-language questions about flows, architecture, patterns, and implementation details with real, current code context.',
    businessValue: 'Explore and understand the codebase through AI-powered questions grounded in the actual source — no stale docs, no hallucinated APIs.',
    productRoles: {},
    primaryTool: null,
  },

  // --- LEARN --- (link-type cards that open an existing learning page; no scenario run)
  {
    id: 'UC-LEARN1',
    useCaseId: 'oauth-academy',
    track: 'learn',
    title: 'OAuth Academy',
    buyerStory: 'An interactive teacher for OAuth 2.0 / 2.1 and OIDC — ask a question or watch a real authorization flow run live.',
    pingOneSolution: 'Runs real PingOne authorization flows — PKCE, scopes, RFC 8693 token exchange, act/may_act delegation, HITL — with the actual token chain shown at every hop.',
    trigger: { type: 'link', path: '/oauth-academy', label: 'Open OAuth Academy' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/OAuthAcademyPage.jsx'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Ask an OAuth question in plain language, or pick a topic and watch the real flow — token chain and all — execute live.',
    advanced: false,
    whatLong: 'A learning utility (not a single identity scenario): an interactive teacher for OAuth 2.0 · 2.1 and OIDC. Ask a question for a plain-language explanation, or pick a topic to watch a real authorization flow run live — PKCE, scopes, RFC 8693 token exchange, act/may_act delegation, and human-in-the-loop approval — with the actual token chain shown at every hop.',
    businessValue: 'Turns abstract OAuth/OIDC concepts into runnable, observable flows — a fast way for teams to learn the protocols the demo is built on.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN2',
    useCaseId: 'pingone-mcp-inspector',
    track: 'learn',
    title: 'PingOne MCP Inspector',
    buyerStory: 'See the hosted PingOne MCP server for real — browse its live tool schemas and invoke them.',
    pingOneSolution: 'Calls the hosted PingOne MCP server over HTTP; tool schemas are fetched live and grouped by resource (Environments, Applications, Users, Populations).',
    trigger: { type: 'link', path: '/pingone-mcp-inspector', label: 'Open PingOne MCP Inspector' },
    expectedOutcome: 'LIVE_MCP_TOOLS',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/PingOneMcpInspector.js', 'demo_api_server/services/mcpPingOneHttpAdapter.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'This is the real hosted PingOne MCP server — its tools, its schemas, invoked live from the demo.',
    advanced: false,
    whatLong: 'A learning surface (not an identity scenario): the inspector connects to the hosted PingOne MCP server, fetches its tool catalog live, renders schema-driven forms for each tool, and shows the JSON-RPC request/response for every invocation — including which operations fall back to the direct Management API.',
    businessValue: 'Gives teams a hands-on view of what an MCP server actually exposes and how an agent would call it — grounded in the real PingOne server, not a mock.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN3',
    useCaseId: 'demo-mcp-inspector',
    track: 'learn',
    title: 'Demo MCP Inspector',
    buyerStory: 'Explore the demo’s own banking MCP server the same way you would any MCP endpoint.',
    pingOneSolution: 'Inspects the demo’s banking MCP server — tool discovery, schema-driven invocation, and the live tool-call pipeline with token-exchange and Authorize gates.',
    trigger: { type: 'link', path: '/mcp-inspector', label: 'Open Demo MCP Inspector' },
    expectedOutcome: 'LIVE_MCP_TOOLS',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/McpInspector.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Same inspector experience, pointed at the demo’s banking MCP server — watch the token and Authorize gates on every call.',
    advanced: false,
    whatLong: 'A learning surface (not an identity scenario): the demo’s banking MCP server exposed through an inspector — discover tools, invoke them via schema-driven forms, and watch the guarded pipeline (RFC 8693 token exchange, gateway validation, Authorize decision) run per call.',
    businessValue: 'Shows the delegation and authorization controls in action on a real MCP server the demo owns end-to-end.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN4',
    useCaseId: 'mcp-tools',
    track: 'learn',
    title: 'MCP Tools',
    buyerStory: 'Understand what MCP is and how tools, schemas, and invocations fit together.',
    pingOneSolution: 'An education panel on the Model Context Protocol — tools, schemas, and how PingOne secures agent-to-tool calls.',
    trigger: { type: 'link', path: '/mcp-tools', label: 'Open MCP Tools' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Start here to learn the vocabulary — what an MCP tool is, what a schema looks like, and where identity fits.',
    advanced: false,
    whatLong: 'A learning surface (not an identity scenario): a conceptual panel explaining the Model Context Protocol — what tools and schemas are, how an agent discovers and invokes them, and where PingOne’s delegation and authorization controls apply.',
    businessValue: 'A fast conceptual on-ramp so teams can reason about MCP before diving into the live inspectors.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN5',
    useCaseId: 'learning-hub',
    track: 'learn',
    title: 'Learning Hub',
    buyerStory: 'A curated landing page for the demo’s learning material and guided walkthroughs.',
    pingOneSolution: 'The learning hub — a jumping-off point to the demo’s guides, concepts, and hands-on modules.',
    trigger: { type: 'link', path: '/learning', label: 'Open Learning Hub' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'The hub gathers the demo’s learning content in one place — a good place to browse what’s available.',
    advanced: false,
    whatLong: 'A learning surface (not an identity scenario): the demo’s learning hub landing page, which links out to the guides, concept explainers, and hands-on modules across the app.',
    businessValue: 'One curated entry point so teams can find the right learning material without hunting through the nav.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN6',
    useCaseId: 'token-flow',
    track: 'learn',
    title: 'Token Flow (Interactive)',
    buyerStory: 'Watch the delegation and token chain unfold step by step — see how each hop is minted and validated.',
    pingOneSolution: 'An interactive visualization of the RFC 8693 token-exchange and Authorize flow — user token → delegated agent token → gateway → decision → tool.',
    trigger: { type: 'link', path: '/architecture/token-flow', label: 'Open Token Flow' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/ArchitectureTokenFlowPage.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Step through the token chain visually — every hop, what claim it carries, and who validates it.',
    advanced: false,
    whatLong: 'A learning surface (not an identity scenario): an interactive diagram of the delegation and token flow — the user token, the RFC 8693 exchange that mints the delegated agent token with the act claim, gateway validation, the Authorize decision, and the final tool dispatch — walkable hop by hop.',
    businessValue: 'Makes the abstract token chain concrete and observable, so teams can see exactly how attribution and least privilege are enforced across hops.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN7',
    useCaseId: 'ungoverned-agent',
    track: 'learn',
    title: 'The Ungoverned Agent (OpenCLI)',
    buyerStory: 'The "before" picture: an AI agent rides the user’s logged-in browser session and moves money through the bank’s own UI — full user power, no identity, no scope, no consent, no audit.',
    pingOneSolution: 'The contrast that motivates the Agent Gateway: session-riding tools like OpenCLI carry no agent identity or delegated token, so the demo records the transfer as an ordinary user session — indistinguishable from the human. Governed access adds the RFC 8693 act-chain, PingOne Authorize decision, and an agent-attributed audit trail.',
    trigger: { type: 'link', path: '/ungoverned-agent', label: 'Open Ungoverned Agent' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/UngovernedAgentPage.js', 'demo_ungoverned_agent/agent.js'],
    maturity: 'works',
    owasp: { threats: ['T2', 'T3', 'T8', 'T9'], sections: ['§3.3.3', '§4.1.1', '§8'] },
    whatToSay: 'Run a transfer via OpenCLI (or the containerized sidecar), then via the governed agent — watch the same action badge "Direct user session" vs "Governed agent".',
    advanced: false,
    whatLong: 'A learning surface (not a runnable identity scenario): it shows what agent access looks like with no governance. A session-riding agent such as OpenCLI ("Browser Use on your logged-in Chrome") inherits the user’s cookies and drives the bank UI with full user privileges — no agent identity, no least-privilege scope, no human-in-the-loop consent, and no audit trail that attributes the action to an agent. A live widget badges each transfer by clientType so the ungoverned run appears identical to the human, while the governed agent run shows the full act-chain.',
    businessValue: 'Makes the risk visceral and concrete: this is how AI tools touch your systems today when nothing governs them — the problem the Agent Gateway exists to solve.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-PAM-SETUP',
    useCaseId: 'privilege-demo-setup',
    track: 'learn',
    title: 'Privilege Demo — SE Setup',
    buyerStory: 'SEs need a repeatable checklist to onboard VMs, install the Privilege Agent, and enroll MFA before presenting the shared environment.',
    pingOneSolution: 'PingOne Privilege shared MT environment with pre-provisioned AgentPrivilege and Approver groups — SEs complete VM and agent setup locally.',
    trigger: { type: 'link', path: '/privilege-demo?tab=setup', label: 'Open SE Privilege Setup' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/pages/PrivilegeDemoPage.jsx', 'demo_api_ui/src/config/privilegeDemoConfig.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Walk the setup checklist once — snapshot your VMs so every demo starts from a known-good state.',
    advanced: false,
    whatLong: 'SE presenter resource for the shared PingOne Privilege environment: VM provisioning, agent onboarding links, MFA enrollment, clock sync, and snapshot instructions.',
    businessValue: 'Reduces prep time and demo-day failures for SEs running the shared Privilege environment.',
    productRoles: { privilege: 'Hosts JIT access requests, approvals, session brokering, and audit for privileged resources.' },
    primaryTool: null,
  },
  {
    id: 'UC-PAM-SCRIPT',
    useCaseId: 'privilege-demo-script',
    track: 'learn',
    title: 'Privilege Demo — Request Access Script',
    buyerStory: 'An end user requests JIT access to AWS AppRoles, fine-grained S3 buckets, VPC bundles, and optional Kubernetes — approved through four-eyes workflows.',
    pingOneSolution: 'PingOne Privilege brokers federated AWS access, gateway tunnels to VPC resources, sudo command filtering, session recording, and policy kill switches.',
    trigger: { type: 'link', path: '/privilege-demo?tab=script', label: 'Open SE Privilege Script' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/pages/PrivilegeDemoPage.jsx', 'demo_api_ui/src/components/privilege/PrivilegeScriptGuide.jsx'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Request access as the end user, approve as admin, then prove JIT federation, fine-grained S3, VPC bundles, and the kill switch.',
    advanced: false,
    whatLong: 'Eight-act presenter script for the shared Privilege Request Access demo: MFA and device trust, AppRole JIT requests, four-eyes approval, AWS console and CLI, VPC bundles, sudo filtering, session audit, and optional Kubernetes.',
    businessValue: 'Shows lifecycle governance for privileged access without standing elevated accounts.',
    productRoles: { privilege: 'Request, approve, broker, record, and revoke privileged sessions across cloud and on-prem targets.' },
    primaryTool: null,
  },
  {
    id: 'UC-LEARN8',
    useCaseId: 'enterprise-managed-mcp-auth',
    track: 'learn',
    title: 'Enterprise-Managed MCP Authorization',
    buyerStory: 'IT should control which MCP servers employees can use — without per-server OAuth consent for every agent.',
    pingOneSolution: 'MCP extension io.modelcontextprotocol/enterprise-managed-authorization: PingOne as IdP gates MCP access by group; this demo uses RFC 8693 as an ID-JAG stand-in until native ID-JAG ships.',
    trigger: { type: 'edu', panel: 'enterprise-managed-auth', tab: 'overview', label: 'Open EMA panel' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [
      'demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js',
      'demo_api_server/services/enterpriseMcpMetadata.js',
      'demo_api_server/services/enterpriseMcpPolicyService.js',
    ],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Walk the MCP enterprise-managed flow in the panel, then enable Enterprise-Managed MCP Auth in Quick Flags and run UC25 to see the RFC 8693 ID-JAG stand-in on the Token Chain.',
    advanced: false,
    whatLong: 'A learning surface (not a single identity scenario): explains the MCP Enterprise-Managed Authorization extension — IdP-centralized policy, ID-JAG exchange, and why employees skip per-server MCP AS redirects. The "In This Demo" tab documents what is live today (metadata + group gate + RFC 8693 stand-in) versus full spec compliance.',
    businessValue: 'Gives IT and security teams a spec-aligned story for central MCP access control — the enterprise counterpart to consumer per-server consent.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-LEARN9',
    useCaseId: 'id-jag-cross-app-access',
    track: 'learn',
    title: 'ID-JAG / Cross-App Access',
    buyerStory: 'Cross-app agent access needs a portable identity assertion — not a full federation hop for every resource server.',
    pingOneSolution: 'Identity Assertion JWT Authorization Grant (ID-JAG): the enterprise IdP issues a grant the MCP Authorization Server exchanges for an MCP access token — the token enterprise-managed auth builds on.',
    trigger: { type: 'edu', panel: 'id-jag', tab: 'how-it-works', label: 'Open ID-JAG panel' },
    expectedOutcome: 'GUIDED_LEARNING',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: ['demo_api_ui/src/components/education/IdJagPanel.js'],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'ID-JAG is the grant enterprise-managed MCP auth exchanges — open this panel for the mechanics before running UC25.',
    advanced: false,
    whatLong: 'A learning surface (not a single identity scenario): covers the ID-JAG grant, PingOne SSO integration patterns, and current product limitations. Enterprise-managed MCP authorization uses ID-JAG (or an RFC 8693 stand-in in this demo) instead of redirecting users to each MCP Authorization Server.',
    businessValue: 'Connects the IETF cross-app access draft to the MCP enterprise extension so teams understand the token grant, not just the policy story.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC25',
    useCaseId: 'enterprise-managed-mcp-access',
    track: 'controls',
    title: 'Enterprise-managed MCP access',
    buyerStory: 'Employees sign in once with corporate SSO; IT pre-approves MCP servers — no separate Connect-to-MCP OAuth step for every agent session.',
    pingOneSolution: 'When Enterprise-Managed MCP Auth is on, PingOne group policy gates token issuance; the BFF mints MCP tokens via RFC 8693 as an ID-JAG stand-in and auto-connects the agent when policy passes.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'tool-dispatched'], activity: ['token', 'mcp'] },
    codeRefs: [
      'demo_api_server/services/agentMcpTokenService.js',
      'demo_api_server/services/enterpriseMcpPolicyService.js',
      'demo_api_server/services/enterpriseMcpMetadata.js',
    ],
    maturity: 'flag:ff_enterprise_managed_mcp_auth',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§3.3.3', '§8'] },
    whatToSay: 'Enable Enterprise-Managed MCP Auth, run this scenario — group gate passes, no agent connect click, Token Chain shows enterprise-managed mode with ID-JAG stand-in.',
    advanced: false,
    match: { tool: 'get_balance' },
    whatLong: 'Demonstrates Phase 2 enterprise-managed MCP access in the demo: after PingOne SSO, IT group membership is checked before the BFF performs RFC 8693 token exchange (labeled as ID-JAG stand-in). Users in allowed groups get MCP tool access without a separate per-server OAuth consent redirect; denied users receive enterprise_mcp_policy_denied.',
    businessValue: 'Shows how IT can centralize MCP server access in PingOne — one SSO login, policy at the IdP, and immediate agent tool access for authorized employees.',
    productRoles: {
      idp:   'Evaluates group/population policy and issues delegated MCP tokens via RFC 8693 stand-in for ID-JAG.',
      gw:    'Validates MCP access tokens and routes tool calls after gateway introspection.',
    },
    primaryTool: 'get_account_balance',
    perVertical: READ_PER_VERTICAL,
  },
];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const USE_CASES = Object.freeze(RAW_USE_CASES.map(deepFreeze));

/** Exact-id lookup. @returns {UseCase|undefined} */
function getUseCase(id) {
  return USE_CASES.find((u) => u.id === id);
}

/** Deep-merge a perVertical override over the base entry. @returns {UseCase|undefined} */
function resolveUseCase(id, vertical) {
  const base = getUseCase(id);
  if (!base) return undefined;
  if (!vertical || vertical === 'banking' || !base.perVertical || !base.perVertical[vertical]) {
    // Strip internal-only fields (perVertical map, match routing bands) from served entries.
    const { perVertical, match, ...rest } = base;
    return rest;
  }
  const ov = base.perVertical[vertical];
  const merged = {
    ...base,
    ...ov,
    trigger: ov.trigger ? { ...base.trigger, ...ov.trigger } : base.trigger,
  };
  const { perVertical, match, ...rest } = merged;
  return rest;
}

/** All catalog entries resolved for a vertical. @returns {UseCase[]} */
function listUseCases(vertical) {
  return USE_CASES.map((u) => resolveUseCase(u.id, vertical));
}

/**
 * Returns true iff `id` matches a useCaseId slug in the catalog.
 * Use this to validate untrusted client-supplied useCaseId before stamping.
 * @param {*} id
 * @returns {boolean}
 */
function isValidUseCaseId(id) {
  if (!id || typeof id !== 'string') return false;
  return USE_CASES.some((u) => u.useCaseId === id);
}

/**
 * Organic reverse-map: given a resolved tool name + args, return the useCaseId
 * of the matching catalog entry, or undefined. The catalog `match` field is the SoT.
 * Per-vertical match routing is a future extension (catalog `match` is banking-only today).
 * @returns {string|undefined}
 */
function deriveUseCaseId(toolName, args = {}) {
  if (!toolName) return undefined;
  const amount = args && args.amount != null ? Number(args.amount) : undefined;
  // Exact tool + amount-band match first.
  for (const u of USE_CASES) {
    const m = u.match;
    if (!m || m.tool !== toolName) continue;
    if (m.amountMin != null && !(amount >= m.amountMin)) continue;
    if (m.amountMax != null && !(amount <= m.amountMax)) continue;
    return u.useCaseId;
  }
  // Transfers are consent-gated (Phase 170) — never fall back to UC1 for writes.
  return undefined;
}

/**
 * Single entry point for "which useCaseId applies to this call" — client-supplied
 * wins when it's a real catalog slug, else fall back to the organic tool+amount
 * derivation. Centralizes the pattern already duplicated across server.js and
 * bffMcpToolExecutor.js so both call sites resolve identically.
 * @param {string|undefined} clientId
 * @param {string} toolName
 * @param {object} args
 * @param {string} [vertical]
 * @returns {string|undefined}
 */
function resolveChipUseCaseId(clientId, toolName, args, vertical) {
  if (clientId && isValidUseCaseId(clientId)) return clientId;
  return deriveUseCaseId(toolName, args, vertical);
}

module.exports = { USE_CASES, VERTICALS, getUseCase, resolveUseCase, listUseCases, deriveUseCaseId, isValidUseCaseId, resolveChipUseCaseId };
