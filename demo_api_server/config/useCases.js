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
 * @property {'foundations'|'controls'|'attacks'|'hitl'|'tools'|'learn'|'demo'|'nhi'} track
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
  'banking', 'healthcare', 'retail', 'abercrombie-fitch', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing',
  'investment', 'airlines',
];


/** Per-vertical chip triggers so Heuristics mode matches each vertical's phrases. */
const READ_TRIGGER_BY_VERTICAL = {
  healthcare: 'check my coverage',
  retail: 'list my orders',
  'abercrombie-fitch': 'show my A&F orders',
  government: 'show my permits',
  university: 'show my enrolled courses',
  workforce: 'my benefits',
  'sporting-goods': 'my gear',
  manufacturing: 'show my work orders',
  investment: 'show my portfolios',
  airlines: 'show my reservations',
};

/** Amount-gated write phrases ($300 HITL / $600 step-up / $2500 deny). */
function amountTriggerByVertical(amount) {
  const n = String(amount);
  return {
    healthcare: `pay my $${n} bill`,
    retail: `checkout headphones for $${n}`,
    'abercrombie-fitch': `checkout A&F outerwear for $${n}`,
    government: `pay the $${n} fee`,
    university: `pay $${n} tuition`,
    workforce: `submit a $${n} expense`,
    'sporting-goods': `extend my rental $${n}`,
    manufacturing: `approve a $${n} purchase order`,
    investment: `execute a large trade of $${n}`,
    airlines: `pay a $${n} change fee`,
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
  'abercrombie-fitch': 'list_anf_orders',
  government: 'view_permits',
  university: 'view_courses',
  workforce: 'view_benefits',
  'sporting-goods': 'list_gear',
  manufacturing: 'view_work_orders',
  investment: 'view_portfolios',
  airlines: 'get_airline_bookings',
};

/** Amount-gated write tool per vertical (UC6/7/8 DENY / step-up / consent). */
const AMOUNT_PRIMARY_TOOL_BY_VERTICAL = {
  healthcare: 'pay_bill',
  retail: 'checkout',
  'abercrombie-fitch': 'checkout',
  government: 'pay_fee',
  university: 'pay_tuition_balance',
  workforce: 'submit_expense',
  'sporting-goods': 'extend_rental',
  manufacturing: 'approve_purchase_order',
  investment: 'large_trade',
  airlines: 'pay_airline_fee',
};

/**
 * UC33 — SECOND product type per vertical. The point of UC33 is that delegated
 * proof travels to a tool that is NOT the everyday read, so this MUST differ
 * from READ_PRIMARY_TOOL_BY_VERTICAL. Every vertical already owns an api_key
 * (Path A) feature tool via its manifest `featurePage.mcpTool`; these are those
 * tools. Falling back to READ_PER_VERTICAL here — the old behaviour — silently
 * made UC33 a duplicate of UC1 while every gate stayed green, which is exactly
 * what useCases.scenarioDistinctness.test.js now blocks.
 */
const SECOND_PRODUCT_TRIGGER_BY_VERTICAL = {
  healthcare: 'show my health records',
  retail: 'show my large purchase',
  'abercrombie-fitch': 'show my saved items at A&F',
  government: 'show my permit status',
  university: 'show my enrollment status',
  workforce: 'show my expense report',
  'sporting-goods': 'show my gear warranty',
  manufacturing: 'show my work order status',
  investment: 'show my portfolio',
  // airlines has no featurePage/api_key tool yet, but it does own a genuine
  // second product: a FLIGHT is not a RESERVATION. get_flight_status is a
  // different tool against different rows, which is all UC33 needs to prove.
  airlines: 'what is the status of flight UA328',
};
const SECOND_PRODUCT_TOOL_BY_VERTICAL = {
  healthcare: 'show_health_record',
  retail: 'show_large_purchase',
  'abercrombie-fitch': 'view_wishlist',
  government: 'show_permit',
  university: 'show_enrollment',
  workforce: 'show_expense_report',
  'sporting-goods': 'show_gear_warranty',
  manufacturing: 'show_work_order',
  investment: 'show_investment',
  airlines: 'get_flight_status',
};

/**
 * UC28 — REQUEST-ONLY tool per vertical (Air Canada pattern). The tool must be
 * one the agent can call to FILE a request but that cannot GRANT the thing
 * asked for; that asymmetry is the whole demo. Like UC33 this must differ from
 * the vertical's read tool.
 */
const REQUEST_ONLY_TRIGGER_BY_VERTICAL = {
  healthcare: 'can you request a copy of my records?',
  government: 'can you submit my permit filing?',
  university: 'can you request campus housing for me?',
  workforce: 'can you request a schedule change for me?',
  'sporting-goods': 'can you price-match my last order?',
  retail: 'can you request a price adjustment on my order?',
  'abercrombie-fitch': 'can you request a price adjustment on my A&F order?',
  manufacturing: 'can you request a spec exception?',
  investment: 'can you request a fee tier review?',
};
const REQUEST_ONLY_TOOL_BY_VERTICAL = {
  healthcare: 'request_document',
  government: 'submit_filing',
  university: 'request_housing_assignment',
  workforce: 'request_schedule_change',
  'sporting-goods': 'request_price_match',
  retail: 'request_price_adjustment',
  'abercrombie-fitch': 'request_price_adjustment',
  manufacturing: 'request_spec_exception',
  investment: 'request_fee_tier_review',
};

/**
 * Verticals with no request-only tool YET. Explicit and justified, never a
 * silent fallback — the completeness gate requires every vertical to appear
 * either in the map above or here, so adding a vertical fails the build until
 * someone decides which it is.
 */
const REQUEST_ONLY_NOT_APPLICABLE = {
  airlines: 'No request-only tool yet — needs a "request a change-fee waiver" tool the agent can FILE but not GRANT (wave 2). pay_airline_fee is the opposite: it completes the transaction.',
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

/** UC33 — every vertical's own second product. No READ fallback: see the map's comment. */
const SECOND_PRODUCT_PER_VERTICAL = chipOverrides(
  SECOND_PRODUCT_TRIGGER_BY_VERTICAL,
  withPrimaryTool(SECOND_PRODUCT_TOOL_BY_VERTICAL),
);

/**
 * UC28 — request-only chip for the verticals that own such a tool; the three
 * listed in REQUEST_ONLY_NOT_APPLICABLE keep the READ fallback until wave 2
 * gives them a real one, so their chip still routes and the coverage gate holds.
 */
const REQUEST_ONLY_PER_VERTICAL = {
  ...Object.fromEntries(Object.keys(REQUEST_ONLY_NOT_APPLICABLE).map((v) => [v, READ_PER_VERTICAL[v]])),
  ...chipOverrides(REQUEST_ONLY_TRIGGER_BY_VERTICAL, withPrimaryTool(REQUEST_ONLY_TOOL_BY_VERTICAL)),
};

/**
 * A2A-specific per-vertical triggers for UC2.
 * Each entry maps to a tool marked a2aDelegated:true in scope-topology.json and
 * registered in a2aSpecialists.js. Using READ_PER_VERTICAL here would route to
 * the standard read tool (e.g. list_orders) which is NOT a2aDelegated — the A2A
 * delegation code path would never fire and the token chain would show UC1-style
 * single-exchange dispatch instead of the expected nested-act chain.
 */
const A2A_TRIGGER_BY_VERTICAL = {
  healthcare:        'show my sensitive patient records',
  retail:            'show my sensitive order history',
  'abercrombie-fitch':'show my sensitive A&F order history',
  government:        'show my sensitive tax record',
  university:        'access my sensitive student finance',
  workforce:         'show my sensitive payroll details',
  'sporting-goods':  'show my sensitive membership details',
  manufacturing:     'show my sensitive supplier contract',
  investment:        'show my sensitive holdings',
  airlines:          'show my sensitive passenger record',
};
const A2A_PRIMARY_TOOL_BY_VERTICAL = {
  healthcare:        'sensitive_patient_records',
  retail:            'sensitive_order_history',
  'abercrombie-fitch':'sensitive_order_history',
  government:        'sensitive_tax_record',
  university:        'sensitive_student_finance',
  workforce:         'sensitive_payroll_details',
  'sporting-goods':  'sensitive_membership_details',
  manufacturing:     'sensitive_supplier_contract',
  investment:        'sensitive_holdings',
  airlines:          'sensitive_passenger_record',
};
const A2A_PER_VERTICAL = chipOverrides(A2A_TRIGGER_BY_VERTICAL, withPrimaryTool(A2A_PRIMARY_TOOL_BY_VERTICAL));

/**
 * UC2.6 reuses the SAME per-vertical specialist tool as UC2 (same delegation
 * leg 1) but keeps ONE neutral trigger phrase across all verticals — the
 * mismatch heuristic is vertical-agnostic (config/verticals/a2a/index.js), so
 * unlike A2A_PER_VERTICAL there is no per-vertical trigger text to override.
 * resolveUseCase falls back to the base `trigger` when an override omits it.
 */
const A2A_MISMATCH_PER_VERTICAL = Object.fromEntries(
  Object.entries(A2A_PRIMARY_TOOL_BY_VERTICAL).map(([v, primaryTool]) => [v, { primaryTool }]),
);

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
    maturity: 'works',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Generalist hands off to specialist — the nested act claim shows the full chain back to the user.',
    advanced: false,
    whatLong: "A generalist AI agent hands a task to a specialist sub-agent. Without enforced delegation chains, the specialist acts with the original user's full authority — no narrowing, no proof of the handoff. This scenario demonstrates nested-act token exchange so each hop is attributable and scoped.",
    businessValue: 'Multi-agent pipelines stay governed end-to-end. Each specialist inherits only the scope the handoff explicitly granted — least privilege across agent hops, with the full chain visible in the token.',
    productRoles: {
      idp:   'Mints a nested-act delegated token for the specialist, narrowing scope at each exchange hop.',
      gw:    'Validates the nested act chain on the A2A gateway audience and routes the specialist tool call after PERMIT.',
      authz: 'Evaluates the full act chain at each hop; denies if any link is unauthorized.',
    },
    // Topology / Authorize teach against the specialist tool that hits the gateway.
    primaryTool: 'get_portfolio_summary',
    perVertical: A2A_PER_VERTICAL,
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
    primaryTool: 'get_portfolio_summary',
    // The trigger phrase is vertical-neutral, but the specialist tool is not:
    // without this every vertical inherited banking's get_portfolio_summary and
    // the orchestrator entry advertised a banking tool inside a sports/health
    // demo. Same per-vertical values UC2 uses; trigger stays inherited.
    perVertical: Object.fromEntries(
      Object.entries(A2A_PRIMARY_TOOL_BY_VERTICAL).map(([v, primaryTool]) => [v, { primaryTool }]),
    ),
  },
  {
    id: 'UC2.7',
    useCaseId: 'a2a-protocol-walkthrough',
    track: 'learn',
    title: 'A2A end to end — protocol + identity',
    buyerStory: 'Show a buyer what "agent-to-agent" actually means on the wire and in the token, with the real artifacts rather than a diagram.',
    pingOneSolution: 'One page carries both halves: PingOne mints the nested-act RFC 8693 chain, and the Linux Foundation A2A wire protocol discovers the specialist by Agent Card and calls it with its own PingOne bearer.',
    // Link, not a chip: this is a walkthrough page, not an agent turn. Same
    // shape UC14b uses for the intent-binding lesson.
    trigger: { type: 'link', path: '/a2a-protocol-learning' },
    expectedOutcome: 'PERMIT',
    evidence: {
      tokenChain: ['a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'a2a-protocol-bearer', 'a2a-agent-card', 'a2a-protocol-message'],
      activity: [],
    },
    codeRefs: [
      'demo_api_ui/src/pages/A2AProtocolLearningPage.jsx',
      'demo_api_ui/src/pages/a2aTeachingPanes.js',
      'demo_api_server/services/a2aDelegationService.js',
      'demo_api_server/services/a2aProtocolClient.js',
    ],
    maturity: 'works',
    owasp: { threats: ['T9', 'T13'], sections: ['\u00a74.2.3', '\u00a74.3'] },
    whatToSay: 'Two things are called A2A. Here they are side by side, with the real Agent Card, a real 401 when the bearer is missing, and a real nested-act chain.',
    advanced: false,
    whatLong: 'A walkthrough of A2A using this demo\'s own agent. Signed out it still teaches with live artifacts: the Agent Card is fetched unauthenticated from the browser, and a JSON-RPC call sent with no Authorization header returns the real 401 that proves the wire hop is gated. Signed in, "Run the delegation" executes the real chain and the page renders every hop: two client_credentials tokens, two RFC 8693 exchanges, the scope narrowing, and the act nesting Authorize decides over. Each pane states what its data actually is — a reconstructed parameter summary, decoded claims, or a genuine HTTP request — because the evidence is real but it is not a captured HTTP transcript.',
    businessValue: 'Removes the most common confusion in agent-to-agent conversations: the wire protocol and the identity chain are different layers with different credentials. Seeing the Agent Card, the refusal, and the nested act claim in one place turns an architecture debate into a five-minute demo.',
    productRoles: {
      idp:   'Mints both the nested-act delegated token and the separate client_credentials bearer the wire hop authenticates with.',
      gw:    'Serves the public Agent Card and enforces the bearer requirement on the JSON-RPC endpoint.',
      authz: 'Decides over the full act chain — ActChainDepth 2, specialist acting for generalist acting for the user.',
    },
    primaryTool: null,
  },
  {
    id: 'UC2.6',
    useCaseId: 'a2a-generalist-mismatch',
    track: 'foundations',
    title: 'A2A generalist mismatch',
    buyerStory: 'A resource server must be able to tell WHICH agent is acting on the user\'s behalf, not just that some agent is — the same user with a different, unregistered agent must be denied.',
    pingOneSolution: 'PingOne Authorize evaluates the nested act chain\'s actor identity, not just the subject — an unregistered generalist is denied even though the user and the delegation shape are otherwise valid.',
    trigger: { type: 'chip', text: 'simulate an agent identity mismatch' },
    expectedOutcome: 'PERMIT_THEN_DENY',
    evidence: {
      tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched', 'a2a-mismatch-probe'],
      activity: ['token', 'delegate', 'authorize', 'mcp', 'authorize'],
    },
    codeRefs: [
      'demo_api_server/services/a2aDelegationService.js',
      'demo_api_server/services/demoAgentLangGraphService.js',
      'demo_authz_server/routes/decision.js',
    ],
    maturity: 'works',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Same user, same delegation shape — but an unregistered agent identity is denied. Authorization keys on WHO is acting, not just who they act for.',
    advanced: false,
    whatLong: 'Runs the same real, governed delegation as A2A delegation (a genuine PERMIT), then probes the same PingOne Authorize decision the gateway calls with a fabricated, unregistered actor identity in place of the real generalist. The result is a genuine invalid_a2a_generalist DENY from live policy — proof that authorization decisions account for the AGENT\'s identity, not only the user\'s. The probe does not mint a real second agent token; it demonstrates the policy branch directly.',
    businessValue: 'A stolen or rogue agent credential cannot ride on a legitimate user\'s delegation shape — the policy engine denies based on actor identity even when the subject and act-chain depth look correct. This is the authorization half of the delegation-chain value proposition (the audit-trail half is UC2/UC2.5).',
    productRoles: {
      idp:   'Mints the real leg-1 delegated token exactly as UC2; the mismatch probe itself mints no token.',
      gw:    'Not involved in the probe leg — the probe calls the decision endpoint directly, same contract the gateway uses.',
      authz: 'Evaluates ActChainDepth and NestedActClientId; DENYs invalid_a2a_generalist when the actor does not match the registered generalist.',
    },
    primaryTool: 'sensitive_holdings',
    perVertical: A2A_MISMATCH_PER_VERTICAL,
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
    primaryTool: 'get_account_balance',
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
    primaryTool: 'get_account_balance',
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
    primaryTool: 'get_account_balance',
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC33',
    useCaseId: 'mortgage-delegated-access',
    track: 'foundations',
    title: 'My mortgage',
    buyerStory: "Delegated-access proof can't be special-cased per tool — every account type the agent touches needs the same chain of custody, not just the everyday balance check.",
    pingOneSolution: 'The same RFC 8693 delegated token (act={agent}) authorizes every tool call, including less-common products like a mortgage — one token exchange covers the whole tool surface.',
    trigger: { type: 'chip', text: 'show my mortgage' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
    maturity: 'works',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§3.3.3', '§8'] },
    whatToSay: 'Same delegated token, a different tool — the act claim proves the agent all the way to a mortgage lookup, not just a balance check.',
    advanced: false,
    whatLong: "Delegated-access proof isn't special-cased per tool. This scenario runs the identical RFC 8693 chain from UC1 — user token, act={agent}, gateway validation, Authorize decision — against a less-common tool (mortgage lookup) to show the proof travels with every call the agent makes, not just the common ones.",
    businessValue: "Attribution coverage doesn't shrink as the agent's tool surface grows. Adding a new tool never means adding new attribution plumbing — every call already carries the same proof.",
    productRoles: {
      idp:   'Mints the same delegated token regardless of which tool the agent calls next.',
      gw:    'Validates the token identically no matter which tool it is routed to.',
      authz: 'Evaluates the same act-claim policy for every tool in scope.',
    },
    primaryTool: 'show_mortgage',
    // Mortgage is a banking-only product — verticals without a second product
    // type fall back to their own read chip/tool (same convention as UC28) so the
    // routing gate holds everywhere. sporting-goods ships its own second product
    // (gear warranty) on the SAME api_key disposition as show_mortgage, so it
    // demonstrates the point instead of repeating UC1's read.
    perVertical: {
      ...SECOND_PRODUCT_PER_VERTICAL,
      'abercrombie-fitch': {
        ...SECOND_PRODUCT_PER_VERTICAL['abercrombie-fitch'],
        title: 'My saved styles',
        buyerStory: "Delegated-access proof must cover every A&F customer tool, not just order history.",
        pingOneSolution: 'The same RFC 8693 delegated token (act={agent}) authorizes the saved-styles lookup without changing the chain of custody.',
        whatToSay: 'Same delegated token, a different A&F tool — the act claim proves the agent through the saved-styles lookup, not just order history.',
        whatLong: "This A&F scenario runs the same RFC 8693 chain as the order lookup against the customer's saved styles, proving attribution travels with every tool call.",
      },
      'sporting-goods': {
        ...SECOND_PRODUCT_PER_VERTICAL['sporting-goods'],
        whatToSay: 'Same delegated token, a different product — the act claim proves the agent all the way to a warranty lookup, not just the gear list.',
      },
    },
  },
  {
    id: 'UC34',
    useCaseId: 'ai-spot-unusual-patterns',
    track: 'foundations',
    title: 'Spot unusual patterns',
    buyerStory: 'A security-aware agent should be able to reason over live activity, not just execute fixed lookups — and that reasoning has to run through the same governed pipeline as everything else.',
    pingOneSolution: 'The free-form LLM path runs through the identical RFC 8693 → gateway → Authorize legs as a heuristic chip — reasoning is not a shortcut around the policy chain.',
    trigger: { type: 'chip', text: 'Check for unusual patterns in my recent activity' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/demoAgentLangGraphService.js'],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§3.3.3'] },
    whatToSay: 'The analysis path runs the full pipeline — same RFC 8693 → gateway → Authorize legs as a heuristic chip, no shortcut.',
    advanced: false,
    whatLong: 'Not every useful agent action is a fixed lookup. This scenario asks the agent to reason freely over recent activity for anything unusual — the LLM decides what to look at and how to summarize it, but every underlying tool call it makes still goes through the same token-exchange and Authorize legs as a deterministic chip.',
    businessValue: 'Free-form reasoning does not create a policy gap. Whatever the agent decides to look at, every tool call it actually makes is still attributed and authorized — reasoning changes what runs, never whether it is governed.',
    productRoles: {
      llm: 'Reasons over the request and issues whichever tool calls it decides are relevant.',
      gw: 'Validates and routes every tool call the reasoning step issues, same as any other call.',
      authz: 'Evaluates each resulting tool call independently — freeform intent grants no special access.',
    },
    // Free-form LLM analysis — no single deterministic tool to declare (see
    // LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js). Same shape as the
    // banking manifest's own bk8 chip, which is deliberately kept out of the
    // catalog for the same reason; this entry exists instead so the demo stays
    // reachable from /use-cases after the Actions dropdown is removed.
    primaryTool: null,
  },
  {
    id: 'UC35',
    useCaseId: 'ai-explain-last-denial',
    track: 'foundations',
    title: 'Why was that blocked?',
    buyerStory: 'When a control fires, the person watching the demo should be able to ask the agent to explain itself in plain language — backed by the real evidence, not a canned line.',
    pingOneSolution: "The agent explains its own security posture by reading the live token-chain events, not a scripted explanation — the explanation is only as good as the evidence PingOne actually produced.",
    trigger: { type: 'chip', text: 'Explain why my last blocked action was denied and walk me through the token chain' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision'], activity: ['token', 'authorize'] },
    codeRefs: ['demo_api_server/services/demoAgentLangGraphService.js', 'demo_api_server/services/appEventService.js'],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§3.3.3', '§8'] },
    whatToSay: 'The agent explained its own security posture from the live token-chain events — useful for teaching why a control fired.',
    advanced: false,
    whatLong: "After a control fires (a DENY, a step-up, a consent gate), the agent can be asked to explain what just happened. It reads the real token-chain events from the run — not a canned script — and narrates the decision in plain language, teaching the audience why the control triggered.",
    businessValue: 'Every enforcement decision is self-explaining. Support and audit teams get a plain-language narration of what PingOne decided and why, sourced from the same evidence an auditor would pull, not a separate explanation system that can drift from reality.',
    productRoles: {
      llm: "Narrates the live token-chain evidence in plain language — it explains PingOne's decision, it doesn't make one.",
      authz: 'Recorded the original PERMIT/DENY/STEP_UP decision the explanation is built from.',
    },
    // Free-form LLM explanation — no single deterministic tool (see UC34's note
    // and LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js).
    primaryTool: null,
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
    primaryTool: 'get_account_balance',
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
      'abercrombie-fitch': '$2500 A&F checkout exceeds the policy ceiling — Authorize returns DENY.',
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
    // Declared step-up method: this demo IS the step-up case, so Authorize must
    // return STEP_UP (device-list MFA) — not HITL. The live P1AZ MCP policy
    // returns HITL for every amount, so without this declaration UC7 evaluated
    // to HITL and the proof strip flagged an authorize-decision mismatch. Same
    // mechanism as UC22's 'ciba', differing only by method. See
    // mcpToolAuthorizationService._applyTransactionPolicy.
    stepUpMethod: 'p1mfa',
    perVertical: AMOUNT_PER_VERTICAL(600, {
      healthcare: '$600 bill payment >= the step-up bar → MFA required first.',
      retail: '$600 checkout >= the step-up bar → MFA required first.',
      'abercrombie-fitch': '$600 A&F checkout >= the step-up bar → MFA required first.',
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
      'abercrombie-fitch': '$300 A&F checkout requires human consent before it runs.',
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
    primaryTool: 'create_transfer',
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
    buyerStory: "An AI agent has no browser to prompt for step-up. When it performs a sensitive action, approval must be requested out-of-band on the user's own device — driven by the action and the agent context, not by a dollar amount.",
    pingOneSolution: 'Because an agent is acting (no browser redirect) on a sensitive money movement, PingOne Authorize returns a CIBA obligation. The backend calls bc-authorize and polls for the auth_req_id, proceeding only after the user approves out-of-band on their phone.',
    trigger: { type: 'chip', text: 'transfer $150 from checking to savings' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['authorize-decision', 'ciba-poll', 'tool-dispatched'], activity: ['authorize', 'mcp', 'ciba'] },
    codeRefs: ['demo_api_server/services/cibaService.js', 'demo_api_server/routes/ciba.js'],
    maturity: 'flag:ciba_enabled',
    owasp: { threats: ['T10'], sections: ['§3.1.5'] },
    whatToSay: "Note the amount — $150, below the MFA threshold. A person doing this in-browser would sail through. But an AGENT moving money is a sensitive, agent-context action, so approval is requested out-of-band on the user's phone. CIBA is triggered by the action and the actor, not the amount.",
    advanced: false,
    whatLong: "An AI agent performs a sensitive action — moving money on the user's behalf — with no browser in which to prompt for step-up. PingOne CIBA (Client-Initiated Backchannel Authentication) requests decoupled approval on the user's separate device. The trigger is the agent context plus the sensitivity of the action, NOT a dollar threshold: this demo uses a deliberately small $150 transfer to make that explicit — the same amount in-browser needs no step-up, yet the agent-initiated action still requires out-of-band approval. The agent polls for the result and proceeds only after the user approves on their phone.",
    businessValue: "Out-of-band approval is meaningfully stronger than in-session step-up — a compromised browser (or a rogue agent) cannot self-approve. Basing the trigger on agent-context and action sensitivity, not amount, means an autonomous agent can never move money without a real human's decoupled confirmation. CIBA is natively supported by PingOne; no custom push infrastructure needed.",
    productRoles: {
      idp:   "Receives the CIBA auth_req_id request and delivers the approval challenge to the user's device.",
      authz: 'Returns the CIBA obligation for the sensitive, agent-initiated action; PERMITs only after the user approves out-of-band.',
      gw:    'Holds the tool call until the agent presents the CIBA approval receipt.',
      mfa:   "Delivers the CIBA challenge to the user's enrolled device (push notification / OTP).",
    },
    primaryTool: 'create_transfer',
    // Explicit CIBA trigger — the durable, cross-vertical signal that instigates
    // out-of-band approval. It is AMOUNT-INDEPENDENT by design: CIBA models a
    // policy decision ("this sensitive, agent-initiated action needs decoupled
    // approval"), NOT a dollar gate — so it never collides with the amount-based
    // MFA step-up. The trigger is the CIBA intent (this useCase / the agent
    // context), which is why the demo amount is a small $150. Authorize reads
    // this declared method and routes through the SAME step-up path as MFA,
    // differing only by step_up_method='ciba'. Declared once; every vertical
    // inherits it via the shared catalog + perVertical below.
    stepUpMethod: 'ciba',
    perVertical: AMOUNT_PER_VERTICAL(150),
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
    pingOneSolution: 'The public catalog path skips PingOne Authorize, the Agent Gateway, and token exchange.',
    trigger: { type: 'chip', text: 'What branches are near me?' },
    hint: 'Works for Austin, Dallas, Houston, Miami, or Denver.',
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['authorize-decision', 'tool-dispatched'], activity: ['mcp', 'authorize'] },
    codeRefs: ['docs/planning/PLAN-progressive-trust-demo.md', 'demo_api_server/data/publicBranchCatalog.js', 'oauth-mcp/src/tools/handlers/publicCatalogHandlers.ts'],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§4.1.1'] },
    whatToSay: 'Low-friction first — no token exchange for public catalog data.',
    advanced: false,
    match: { tool: 'get_branch_hours' },
    whatLong: 'Act 1 of the progressive trust demo. The agent answers a public branch-catalog question without authentication — mirroring the MyHotels public hotel search. The local public tool (get_branch_hours) does not call PingOne Authorize or the Agent Gateway.',
    businessValue: 'Demonstrates progressive authentication — users are not forced to sign in before seeing non-sensitive catalog data.',
    productRoles: {
      authz: 'Not called for this public catalog request.',
      gw:    'Not in path for this local public catalog request.',
    },
    primaryTool: 'get_branch_hours',
    // Every vertical stores its own primaryTool even though the value is the
    // same everywhere (the public catalog tool) — isolation over DRY, so a
    // change to one vertical's entry cannot ripple into another's.
    perVertical: chipOverrides({
      healthcare: 'What clinics are near me?',
      retail: 'What stores are near me?',
      'abercrombie-fitch': 'What A&F stores are near me?',
      government: 'What city offices are near me?',
      university: 'What campus locations are near me?',
      workforce: 'What office locations are near me?',
      'sporting-goods': 'What stores are near me?',
      manufacturing: 'What plant locations are near me?',
      investment: 'What branches are near me?',
      airlines: 'What airports are near me?',
    }, withPrimaryTool({
      healthcare: 'get_branch_hours',
      retail: 'get_branch_hours',
      'abercrombie-fitch': 'get_branch_hours',
      government: 'get_branch_hours',
      university: 'get_branch_hours',
      workforce: 'get_branch_hours',
      'sporting-goods': 'get_branch_hours',
      manufacturing: 'get_branch_hours',
      investment: 'get_branch_hours',
      airlines: 'get_branch_hours',
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
    // Gateway-level deny: the scope check runs BEFORE PingOne Authorize is consulted,
    // so no 'authorize-decision' evidence exists. Declare the events the sim emits.
    evidence: { tokenChain: ['sim-exchange-ok', 'sim-gateway-deny'], activity: ['token', 'mcp'] },
    codeRefs: ['oauth-mcp/src/auth/validateTokenScopes.js', 'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
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
    // Gateway-level deny: aud/exp/iss/nbf validation runs BEFORE PingOne Authorize
    // is consulted, so no 'authorize-decision' evidence exists.
    evidence: { tokenChain: ['sim-exchange-ok', 'sim-gateway-deny'], activity: ['token', 'gateway'] },
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
    // Audience binding is enforced at the gateway BEFORE PingOne Authorize is
    // consulted, so this sim never produces an 'authorize-decision'. The replayed
    // user token is carried on 'sim-replay-start'.
    evidence: { tokenChain: ['sim-replay-start', 'sim-gateway-deny'], activity: ['token', 'gateway'] },
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
    pingOneSolution: "PingOne stamps a native, cryptographically-issued act claim on the exchanged token whenever the actor actually performed the RFC 8693 exchange. The gateway and Authorize always prefer that native claim over any header — a header can only fill in on hops where no native claim exists. A rogue actor can't win by spoofing a header; it would have to perform a real token exchange as an unauthorized client, and Authorize's ActClientId check on the resulting native claim then denies it.",
    trigger: { type: 'attack', sim: 'rogue-actor' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'gateway'] },
    codeRefs: [
      'demo_api_server/services/mcpGatewayClient.js',
      'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts',
      'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts',
      'ping-gateway/scripts/groovy/p1az-decision.groovy',
      'demo_authz_server/routes/decision.js',
    ],
    maturity: 'works',
    owasp: { threats: ['T13'], sections: ['§4.2.2'] },
    whatToSay: "Actor identity comes from a native, PingOne-issued claim on the token — never from a header. Headers are only a fallback for hops where PingOne can't natively stamp an actor; they can never override a real claim. That's why this rogue actor is denied.",
    advanced: false,
    whatLong: "A rogue agent tries to force itself into the delegation chain by claiming to be the authorized actor. PingOne's resource attribute mapping stamps a native act claim on the exchanged token whenever a real RFC 8693 actor-token exchange happened — that claim always wins over any header. Only on hops where PingOne can't natively emit act does the gateway fall back to a trusted, internal-secret-gated header bridge. Either way, the ActClientId Authorize receives traces back to a real, authenticated exchange — never an attacker-controlled value.",
    businessValue: "Actor identity is anchored to a real token exchange, not a request header. Even a compromised internal service that could forge headers still can't spoof identity once PingOne has stamped a native claim — there is no path for a rogue actor to talk its way past the authorized-actor check.",
    productRoles: {
      gw:    "Prefers the token's native act claim; falls back to the trusted X-Act-Client-Id header bridge only when no native claim is present, then forwards act.sub to Authorize as ActClientId.",
      authz: 'Checks ActClientId against the configured authorized actor; returns DENY for any other value.',
    },
    primaryTool: null,
  },
  {
    id: 'UC14',
    useCaseId: 'par-rar-intent-violation',
    track: 'attacks',
    title: 'PAR + RAR intent violation (pushed intent exceeded)',
    buyerStory: "An agent that exceeds the amount or payee granted via Pushed Authorization Request (RFC 9126) must be denied.",
    pingOneSolution: 'PingOne Authorize evaluates the PAR-submitted authorization details; exceeding the granted amount or payee yields DENY.',
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
    useCaseId: 'par-rar-intent-verified',
    track: 'learn',
    title: 'PAR + RAR intent verified (PERMIT)',
    buyerStory: 'A transfer that stays within its PAR (RFC 9126) request_uri authorization cap is verified and permitted — the legitimate counterpart to the PAR overage attack.',
    pingOneSolution: 'RFC 9126 PAR authorization details bind the transfer to an amount cap; the MCP gateway and PingOne Authorize verify the requested transfer against it before permitting.',
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
    maturity: 'works',
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
    primaryTool: 'get_account_balance',
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
  {
    id: 'UC29',
    useCaseId: 'oauth-fail-closed',
    track: 'attacks',
    title: 'OAuth introspection outage — fail closed',
    buyerStory: "If the token-validation backend itself goes down, the gateway must reject every call — not silently let traffic through.",
    pingOneSolution: 'RFC 7662 introspection is on the request path for every call; when it cannot be reached, the gateway fails closed rather than open.',
    trigger: { type: 'attack', sim: 'introspection-down' },
    expectedOutcome: 'DENY_503',
    evidence: { tokenChain: ['user-token'], activity: ['gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts', 'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts'],
    maturity: 'works',
    owasp: { threats: ['T2'], sections: ['§3.2.1', '§8'] },
    whatToSay: 'Kill the introspection path and the gateway stops every call cold — it never fails open.',
    advanced: false,
    whatLong: 'The gateway validates every inbound token against the authorization server via RFC 7662 introspection before anything else runs. This scenario simulates that introspection endpoint going unreachable and shows the gateway reject the call with a fail-closed 503, rather than letting it through.',
    businessValue: 'Many systems degrade to "allow" when their auth backend is unreachable. This gateway is built to fail closed instead — an outage in token validation becomes a blocked request, not an open door.',
    productRoles: {
      gw: 'Introspects every token before evaluating policy; on introspection failure, rejects the call rather than forwarding it.',
    },
    primaryTool: null,
  },
  {
    id: 'UC30',
    useCaseId: 'weather-mcp-texas-permit',
    track: 'controls',
    title: 'Third-party MCP server, scoped at the gateway',
    buyerStory: "A third-party tool the agent calls must be constrained to the business's actual footprint — even though the tool itself has no idea what that footprint is. That footprint should be something the business can change, not a hardcoded assumption.",
    pingOneSolution: 'The Agent Gateway fronts a third-party weather MCP server and enforces a live, admin-configurable state-scope policy (Texas by default) entirely at the edge — the backend never sees the restriction.',
    trigger: { type: 'chip', text: "what's the weather in Austin, TX" },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'tool-dispatched'], activity: ['token', 'mcp'] },
    codeRefs: ['ping-gateway/scripts/groovy/tx-weather-scope.groovy', 'ping-gateway/config/routes/00-mcp-weather.json'],
    maturity: 'works',
    owasp: { threats: ['T6'], sections: ['§4.2.2'] },
    whatToSay: 'Austin is in Texas — the gateway lets the call through to the real weather server.',
    advanced: false,
    match: { tool: 'get_weather' },
    whatLong: 'The agent calls a real, unmodified third-party weather MCP server through the Agent Gateway. A city in the gateway\'s currently-configured state (Texas by default) is in scope for this demo policy, so the gateway forwards the call and the backend responds normally — the third-party server itself has no concept of the restriction.',
    businessValue: 'Any third-party or unmanaged MCP server can be brought into a governed environment without modifying it — the gateway enforces the business boundary, not the tool.',
    productRoles: {
      gw: 'Validates the token, then runs the currently-configured state-scope policy (Texas by default) before forwarding the call to the third-party server.',
    },
    primaryTool: 'get_weather',
  },
  {
    id: 'UC31',
    useCaseId: 'weather-mcp-texas-deny',
    track: 'controls',
    title: 'Third-party MCP server — out-of-scope call denied',
    buyerStory: "When an agent's tool call falls outside the business's actual footprint, it must be stopped before the third-party tool ever runs — not after.",
    pingOneSolution: 'The Agent Gateway denies the call before it reaches the third-party weather MCP server, based on the currently-configured state scope (Texas by default) — the demo policy the backend never sees.',
    trigger: { type: 'chip', text: "what's the weather in Miami" },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['user-token', 'tool-dispatched'], activity: ['token', 'mcp'] },
    codeRefs: ['ping-gateway/scripts/groovy/tx-weather-scope.groovy', 'ping-gateway/config/routes/00-mcp-weather.json'],
    maturity: 'works',
    owasp: { threats: ['T6'], sections: ['§4.2.2'] },
    whatToSay: 'Miami is outside Texas — the gateway denies the call before the third-party server ever sees it.',
    advanced: false,
    whatLong: 'The agent asks for weather in a city outside the demo policy\'s currently-configured state scope (Texas by default). The gateway denies the call before it is ever forwarded to the third-party weather MCP server — the backend never runs, and never sees the request.',
    businessValue: 'Scoping happens once, at the gateway, instead of being re-implemented (or forgotten) in every tool integration — a policy change takes effect for every agent immediately.',
    productRoles: {
      gw: 'Runs the currently-configured state-scope policy (Texas by default) and returns DENY before the call is forwarded to the third-party server.',
    },
    primaryTool: 'get_weather',
  },
  {
    id: 'UC32',
    useCaseId: 'weather-mcp-live-reconfigure',
    track: 'controls',
    title: 'Live-reconfigure the gateway\'s scope policy',
    buyerStory: "A demo of a policy control isn't credible if the policy is actually hardcoded in the app. The business needs to change the rule itself — live, without a code change or a restart — and see the SAME request's outcome flip.",
    pingOneSolution: 'An admin-editable Allowed State control, right on the gateway capability card, changes ff_weather_mcp_allowed_state live; the Agent Gateway reads it on the very next request, no restart.',
    trigger: { type: 'link', path: '/agent-gateway-capabilities', label: 'Open Capability Tour' },
    expectedOutcome: 'POLICY_RECONFIGURED',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [
      'demo_api_server/routes/featureFlags.js',
      'demo_api_ui/src/components/WeatherStateControl.jsx',
      'ping-gateway/scripts/groovy/tx-weather-scope.groovy',
    ],
    maturity: 'works',
    owasp: { threats: ['T6'], sections: ['§4.2.2'] },
    whatToSay: 'Watch: the same "weather in Miami" query — denied under Texas, permitted the moment I switch this dropdown to Any.',
    advanced: false,
    whatLong: 'UC30/UC31 each show one fixed outcome (Texas permits Austin, denies Miami). This use case is the proof that the scope itself is a live, admin-owned policy value — not app logic: switch the Allowed State dropdown on the Capability Tour card to Michigan, Any, or back to Texas, and the exact same weather chat query changes its outcome immediately, with no gateway restart.',
    businessValue: 'A policy that can only be changed by redeploying code isn\'t really externalized governance — it just moved the hardcoding one layer down. Making the scope itself admin-editable, live, is what makes the "the gateway decides, not the app" story provable in front of a customer.',
    productRoles: {
      gw: 'Reads the currently-configured state on every request via the same flag-check call that already gates ff_weather_mcp_showcase — no new round-trip.',
    },
    primaryTool: null,
  },

  // --- DEVELOPER TOOLS ---
  {
    id: 'UC-TOOL1',
    useCaseId: 'code-search',
    track: 'tools',
    title: 'Protected RAG',
    buyerStory: 'Grounded code retrieval is useful only when the agent cannot widen its own access to the indexed source.',
    pingOneSolution: 'The BFF exchanges the user token for a delegated MCP token with code:search, then the Agent Gateway and PingOne Authorize enforce the code_search call before Weaviate retrieval.',
    trigger: { type: 'chip', text: 'find where the BFF performs MCP token exchange' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/bffMcpToolExecutor.js', 'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts', 'oauth-mcp/src/tools/handlers/codeSearchHandlers.ts', 'demo_mcp_code_search/src/server.ts'],
    maturity: 'works',
    owasp: { threats: ['T2', 'T6'], sections: ['§4.2.2'] },
    whatToSay: 'The answer is grounded in indexed code, but retrieval happens only after RFC 8693 delegation, code:search scope enforcement, and a PingOne Authorize PERMIT.',
    advanced: false,
    whatLong: 'The chip routes deterministically to code_search. The BFF performs RFC 8693 token exchange for the narrow code:search scope, the Agent Gateway validates that scope and asks PingOne Authorize whether this tool call is permitted, and only then does the MCP server query the ai-demo2-server index in Weaviate. The returned file and line ranges prove the answer came from the protected corpus.',
    businessValue: 'Organizations can add RAG without turning an indexed source corpus into an ungoverned side door: the same delegated identity, least-privilege scope, policy decision, and audit evidence protect retrieval.',
    productRoles: {
      idp: 'Issues the user and delegated tokens used to preserve caller identity.',
      authz: 'Evaluates the code_search tool request and returns the visible PERMIT or DENY decision.',
      gw: 'Enforces code:search and the PingOne Authorize decision before forwarding retrieval.',
    },
    primaryTool: 'code_search',
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

  // --- NHI GOVERNANCE --- (link-type cards; AI Control Plane's own pages own the actual behavior)
  {
    id: 'UC-NHI1',
    useCaseId: 'nhi-inventory',
    track: 'nhi',
    title: 'Multi-source NHI inventory',
    buyerStory: 'Security teams managing agents across AWS, GCP, Azure, and on-prem have no single place to see them all, tagged by source, in one governed roster.',
    pingOneSolution: 'The AI Control Plane roster tags every agent identity — demo and live — with its source platform and lets you filter the governed view by source, all revocable from the same place.',
    trigger: { type: 'link', path: '/ai-control-plane', label: 'Open AI Control Plane' },
    expectedOutcome: 'SOURCE_TAGGED_ROSTER',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [
      'demo_api_server/services/controlPlane/demoAgentRoster.js',
      'demo_api_server/services/controlPlane/liveAgentInfo.js',
      'demo_api_ui/src/components/ControlPlaneRoster.jsx',
    ],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Every agent here is tagged by source — AWS, GCP, Azure, on-prem, or this app — filter the roster the same way you\'d triage a real multi-cloud agent fleet.',
    advanced: false,
    whatLong: 'An NHI governance utility (not a per-vertical banking scenario): the roster aggregates the live agent plus the demo platform identities (ChatGPT, Copilot, Glean, Agentforce, ServiceNow) into one view, each tagged with an illustrative source (aws/gcp/azure/on-prem/this-app). Filter chips narrow the roster to a single source, and every stop/revoke works identically regardless of source.',
    businessValue: 'A centralized, filterable inventory is the first thing security and platform teams ask for when they don\'t know the full scope of their AI ecosystem — this makes that inventory concrete instead of a slide.',
    productRoles: {},
    primaryTool: null,
  },
  {
    id: 'UC-NHI2',
    useCaseId: 'nhi-lifecycle-export',
    track: 'nhi',
    title: 'Agent lifecycle export (JML)',
    buyerStory: 'Teams governing agents through an existing IGA tool (like SailPoint) need agent join/move/leave events in a shape that tool can consume — not a competing identity store.',
    pingOneSolution: 'Agent register/kill-switch/re-enable actions emit joiner/mover/leaver events, queryable live at GET /api/control-plane/lifecycle-events and optionally forwarded to an external webhook — illustrating how Ping would feed an existing IGA process rather than replace it.',
    trigger: { type: 'link', path: '/agent-lifecycle', label: 'Open Agent Lifecycle' },
    expectedOutcome: 'JML_EVENT_FEED',
    evidence: { tokenChain: [], activity: [] },
    codeRefs: [
      'demo_api_server/services/agentLifecycleEvents.js',
      'demo_api_server/services/lmdb/agentLifecycleEventStore.lmdb.js',
      'demo_api_server/services/sailpointForwarder.js',
    ],
    maturity: 'works',
    owasp: { threats: [], sections: [] },
    whatToSay: 'Run the self-service revoke below, then open the lifecycle export feed — that\'s the same joiner/mover/leaver shape an IGA system like SailPoint would pull to certify this agent the way it certifies a human.',
    advanced: false,
    whatLong: 'An NHI governance utility (not a per-vertical banking scenario): every demo-roster reset emits a joiner event per re-seeded agent, every kill-switch (demo or live) emits a leaver event, and every re-enable emits a mover event. Each event carries complianceTags, an auditId linking back to the immutable kill-switch audit record, and the agent\'s source tag. Illustrative-only — this is a generic webhook/pollable-JSON shape, not a real SailPoint API integration.',
    businessValue: 'Teams locked into an existing IGA tool don\'t want Ping to replace it — they want agent lifecycle events shaped so that tool can certify agents the way it already certifies humans. This proves the export pattern without overclaiming an integration that doesn\'t exist.',
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
    title: 'Generic MCP Inspector',
    buyerStory: 'Explore the demo’s own banking MCP server the same way you would any MCP endpoint.',
    pingOneSolution: 'Inspects the demo’s banking MCP server — tool discovery, schema-driven invocation, and the live tool-call pipeline with token-exchange and Authorize gates.',
    trigger: { type: 'link', path: '/mcp-inspector', label: 'Open Generic MCP Inspector' },
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
  {
    id: 'UC39',
    useCaseId: 'enterprise-mcp-revocation',
    track: 'controls',
    title: 'Centralized MCP revocation',
    buyerStory: 'When someone changes teams or leaves, IT revokes their MCP access in one console — not service by service.',
    pingOneSolution: 'Removing the user from the allowed PingOne group makes the enterprise IdP refuse to issue an ID-JAG on the next tool call, and any MCP token the session still holds is revoked.',
    trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['user-token', 'enterprise-managed-mode'], activity: ['token', 'mcp'] },
    codeRefs: [
      'demo_api_server/services/enterpriseMcpPolicyService.js',
      'demo_api_server/routes/enterpriseIdp.js',
    ],
    maturity: 'flag:ff_enterprise_managed_mcp_auth',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§8'] },
    whatToSay: 'Remove the user from the group in PingOne, run the same scenario again — the IdP refuses to mint, and access is gone everywhere at once.',
    advanced: false,
    match: { tool: 'get_balance' },
    whatLong: 'Demonstrates the centralized-revocation claim of the MCP Enterprise-Managed Authorization extension. Because policy is evaluated at the IdP before an ID-JAG is issued, removing the user from the allowed PingOne group denies the next tool call with enterprise_mcp_policy_denied — the refusal happens at the IdP, not downstream at the resource server. Any MCP access token the session still holds is revoked so it cannot outlive the decision. For a live demo lower enterprise_mcp_policy_cache_ttl_ms; the default 5-minute policy cache would otherwise delay the effect and make revocation look broken.',
    businessValue: 'One console controls MCP access for every employee and every server — the offboarding story enterprises ask about first.',
    productRoles: {
      idp: 'Evaluates group membership and refuses to issue the ID-JAG when policy denies.',
    },
    primaryTool: 'get_account_balance',
    perVertical: READ_PER_VERTICAL,
  },
  {
    // Same feature as UC39 above (kept adjacent — same source research, same
    // track): this is the successful-path walkthrough of the whole ID-JAG
    // chain via its own dedicated page; UC39 is that feature's revocation story.
    id: 'UC40',
    useCaseId: 'enterprise-managed-mcp-authorization',
    track: 'controls',
    title: 'Enterprise-Managed MCP Authorization (native ID-JAG)',
    buyerStory: 'IT wants MCP access granted centrally per employee and per server — not a consent screen per MCP server, and not a shared credential the agent framework has to hold.',
    pingOneSolution: 'The enterprise IdP evaluates PingOne group policy and signs a single-use Identity Assertion JWT Authorization Grant (ID-JAG); the MCP Authorization Server verifies it and issues an access token scoped to that one server — no MCP-side consent screen, and no token at all for an employee IT hasn\'t granted.',
    trigger: { type: 'link', path: '/demo/enterprise-mcp', label: 'Open Enterprise-Managed MCP Auth' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'enterprise-managed-mode', 'id-jag-issued', 'id-jag-redeemed'], activity: ['token', 'mcp'] },
    codeRefs: [
      'demo_api_server/services/idJagService.js',
      'demo_api_server/routes/enterpriseIdp.js',
      'oauth-mcp/src/oauth/IdJagGrantHandler.ts',
      'demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx',
    ],
    maturity: 'flag:ff_enterprise_managed_mcp_auth',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§8'] },
    whatToSay: 'Arm the flag, ask for a balance — watch the token chain: an ID-JAG issued by the enterprise IdP, redeemed at the MCP Authorization Server, and that\'s the token that calls the tool. No MCP-side consent screen anywhere in the flow.',
    advanced: false,
    whatLong: 'Walks the full MCP Enterprise-Managed Authorization extension end to end from a dedicated page: arm ff_enterprise_managed_mcp_auth, send a request that needs a tool call, and step through the live token-chain pipeline — group-membership policy evaluated at the IdP before anything is minted, a signed single-use ID-JAG issued naming this user/server/scopes, that grant redeemed at the MCP Authorization Server for an access token, and that exact token calling the tool.',
    businessValue: 'Centralizes MCP access grants at the IdP instead of per-server consent screens or a shared static credential the agent framework has to hold — the access decision, the grant, and the revocation all live in one place IT already controls.',
    productRoles: {
      idp: 'Evaluates PingOne group policy and signs the ID-JAG before anything is minted.',
      authz: 'The MCP Authorization Server verifies the ID-JAG and issues the scoped access token.',
    },
    primaryTool: null,
  },
  {
    id: 'UC27',
    useCaseId: 'hitl-consent-bypass-attempt',
    track: 'hitl',
    title: 'HITL consent bypass attempt',
    buyerStory: 'A client claiming "consent already given" must never skip the human approval gate.',
    pingOneSolution: 'The BFF verifies a real, live HITL receipt — no boolean flag can substitute for it.',
    // Canonical $600 tier (DEMO_HITL_TRANSFER) — policy: no hardcoded amounts
    // unless the amount IS the demo, and here it is: $600 crosses the
    // consent/step-up boundary. Same tier as UC7/UC9/UC22, not a new magic number.
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },
    expectedOutcome: 'HITL_REQUIRED',
    evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'mcp', 'hitl'] },
    codeRefs: ['demo_api_server/services/agentPreflightService.js', 'demo_api_server/tests/hitlBypass.regression.test.js'],
    maturity: 'works',
    owasp: { threats: ['T5'], sections: ['§4.2.3'] },
    whatToSay: 'Even a request claiming consent was already given still stops at the HITL gate — the flag is verified, not trusted.',
    advanced: false,
    whatLong: 'A prior hardening removed a raw consentGiven boolean the preflight service used to trust blindly — any authenticated caller could set it to true and skip token exchange, the P1AZ policy check, and HITL entirely. The hardened path requires a real, verifiable HITL receipt (hitlChallengeId, checked via hitlServiceClient.getChallengeStatus + verifyHitlReceipt) before it will PERMIT. No raw flag can substitute for it, and any verification mismatch falls through to a fresh HITL challenge (fail-closed).',
    businessValue: 'Consent cannot be forged by a client-supplied flag. Every transfer above the HITL policy boundary requires a verified, server-issued receipt tied to the specific user, agent, and tool — closing a class of bug where trusting client-asserted state lets attackers skip authorization.',
    productRoles: {
      authz: 'P1AZ policy still governs whether HITL is required for this transaction type.',
      gw: 'Routes the call to the BFF preflight check before any tool dispatch.',
    },
    primaryTool: 'create_transfer',
    perVertical: AMOUNT_PER_VERTICAL(600),
  },
  {
    id: 'UC28',
    useCaseId: 'unauthorized-commitment-fee-waiver',
    track: 'controls',
    title: 'Tool set as the authorization boundary (Air Canada pattern)',
    buyerStory: 'An agent must never be able to promise something it has no tool to actually do.',
    pingOneSolution: 'The tool catalog itself is the authorization boundary — no tool can GRANT a waiver, so no waiver can be promised, no matter what the LLM says.',
    trigger: { type: 'chip', text: 'Can you waive the fee on my checking account?' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange'], activity: ['mcp'] },
    codeRefs: [
      'oauth-mcp/src/tools/BankingToolRegistry.ts',
      'oauth-mcp/src/tools/handlers/commitmentHandlers.ts',
      'demo_api_server/services/intentTokenService.js',
    ],
    maturity: 'works',
    owasp: { threats: ['T1'], sections: ['§3.1'] },
    whatToSay: 'The agent can only submit a request for human review — it has no tool that actually grants a waiver, so it cannot hallucinate one into existence.',
    advanced: false,
    whatLong: 'In 2024, Air Canada’s chatbot promised a bereavement discount that was never real policy; a court held the airline responsible because it could not distinguish what the agent said from what it could mechanically do. This demo’s request_fee_waiver tool constrains the agent to what actually exists: it logs a request for human review and explicitly cannot grant a waiver. When the agent replies that a request was submitted, that statement is backed by a real, audited tool call — the bank never promised anything the tool can’t deliver.',
    businessValue: 'Removes an entire class of liability: the agent is structurally incapable of promising something outside its tool set, regardless of how the LLM phrases its response. No prompt-engineering required — the boundary is enforced by what tools exist, not by asking the model nicely.',
    productRoles: {
      gw: 'Routes the tool call; the tool itself (not a policy check) is what bounds the action.',
    },
    primaryTool: 'request_fee_waiver',
    // Policy-story convention (same as UC2): verticals with no request-only tool
    // surface their own read chip + own tool, so every vertical stores its own
    // prompt/response and the coverage/routing gates hold everywhere.
    // sporting-goods ships its own request-only tool (request_price_match, which
    // cannot grant a price match), so it demonstrates the boundary directly.
    perVertical: {
      ...REQUEST_ONLY_PER_VERTICAL,
      'sporting-goods': {
        ...REQUEST_ONLY_PER_VERTICAL['sporting-goods'],
        whatToSay: 'The agent can only submit a price-match request for human review — it has no tool that actually approves one, so it cannot hallucinate a discount into existence.',
      },
    },
  },

  // --- COUPA/NIQ GAP-CLOSURE DEMO (Protect risk-eval + Verified Trust A2A assertion) ---
  // Keep UC36/UC37 adjacent — same source research, same track, meant to be browsed
  // as a pair. UC36 (Protect) is not built yet — see docs/superpowers/plans/
  // 2026-08-10-protect-agent-dispatch-risk.md Task 6; insert it above this comment,
  // before UC37, when it lands.
  {
    id: 'UC37',
    useCaseId: 'verified-trust-a2a-assertion',
    track: 'controls',
    title: 'Verified Trust — signed agent assertion on A2A delegation',
    buyerStory: "When an agent hands off to another organization's agent, a bearer token alone doesn't let the receiving side verify the claim offline or prove it later without calling back to the issuer.",
    pingOneSolution: 'PingOne Credentials issues a signed SD-JWT Verifiable Credential asserting which agent is acting for which user at A2A delegation start; the receiving specialist advertises it as a second security scheme alongside the existing bearer token.',
    trigger: { type: 'chip', text: 'hand off to a specialist' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'verified-trust-issuance', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched'], activity: ['token', 'delegate', 'verified-trust', 'authorize', 'mcp'] },
    codeRefs: [
      'demo_api_server/services/verifiedTrustService.js',
      'demo_api_server/services/a2aDelegationService.js',
      'demo_api_server/services/a2aAgentCardService.js',
    ],
    maturity: 'flag:ff_verified_trust_a2a',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Same specialist handoff as before — but now the chain carries a signed, independently-verifiable credential too, not just a bearer token the receiving side has to trust blindly.',
    advanced: false,
    whatLong: "A2A delegation already proves the chain via RFC 8693 nested-act tokens, but a bearer token only means something to a party that can call back to the issuer. This scenario adds a signed SD-JWT Verifiable Credential at chain start, asserting agent_id/acting_for/scope/chain_id — independently verifiable, portable across an org boundary. Issuance is fail-open: if Credentials issuance fails (no DaVinci flow is configured on this tenant yet), the existing bearer-token delegation still completes unaffected.",
    businessValue: "Directly answers Coupa's cross-boundary trust ask: an external agent receiving a handoff doesn't have to trust a bearer token on faith or maintain a live connection to the issuing org — it can verify the credential's signature offline.",
    productRoles: {
      idp:   'Mints the nested-act delegated bearer token exactly as UC2 does.',
      authz: 'Evaluates the act chain as usual — the credential is additive, not a replacement authorization signal.',
    },
    primaryTool: 'get_portfolio_summary',
    perVertical: A2A_PER_VERTICAL,
  },
  {
    id: 'UC38',
    useCaseId: 'personal-agent-concierge',
    track: 'foundations',
    title: 'Personal Agent Concierge',
    buyerStory: "Users want a trusted agent acting on their behalf — but delegation must require proof of identity and be scoped to what the user explicitly registered.",
    pingOneSolution: 'User authenticates with MFA; BFF verifies the registered personal agent (Agent Builder); RFC 8693 exchange mints a delegated token (sub=user, act=agent) scoped to airlines:read airlines:write.',
    // `/airlines` is not a route — no match in App.js or routes/*, so this step
    // fell through to the catch-all and landed the presenter on the wrong page.
    // `/personal-agent` is the Personal Agent Studio this step is named for.
    trigger: { type: 'link', path: '/personal-agent', label: 'Airlines vertical only — switch vertical to demo' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'personal-agent-lookup', 'mcp-exchange', 'tool-dispatched'], activity: ['token', 'mcp'] },
    codeRefs: [
      'demo_api_server/routes/agentInvokeRoute.js',
      'demo_api_server/services/agentBuilderService.js',
      'demo_mcp_resource_server/src/tools/airlinesToolHandler.ts',
    ],
    maturity: 'flag:ff_personal_agent_concierge',
    owasp: { threats: ['T1', 'T9'], sections: ['§4.1', '§4.2'] },
    whatToSay: 'User proves identity with MFA, their registered personal agent is looked up, RFC 8693 delegates authority — the agent redeems miles for a seat upgrade.',
    advanced: false,
    whatLong: 'A user triggers the premium flyer concierge. The BFF requires a multi-factor authentication claim before delegation — a token without the MFA acr causes a step-up prompt. Once MFA is proved, the BFF looks up the user\'s registered personal agent (created on the Agent Builder page). An RFC 8693 token exchange mints a delegated token where the user remains the subject and the agent carries the act claim, scoped to airlines:read airlines:write. The agent then calls get_loyalty_status to check the miles balance and redeem_miles to upgrade the cabin on the next upcoming booking.',
    businessValue: 'End users get personalized agentic services that act on their behalf — but delegation is always gated on explicit identity proof (MFA) and pre-registered agent authorization, not implied by session context alone.',
    productRoles: {
      idp:   'Issues the high-assurance (MFA-satisfied) user token; serves as the source of truth for the personal agent identity registered via the Agent Builder.',
      gw:    'Passes the delegated token to the MCP resource server; the act claim is visible in every tool call.',
      authz: 'Can extend this pattern: add a P1AZ policy that further constrains the personal agent\'s allowed actions based on the user\'s loyalty tier.',
    },
    primaryTool: 'redeem_miles',
    // The SECOND tool this use case runs. `primaryTool` is the chip's entry
    // point and was, until now, the only tool a use case declared anywhere
    // machine-readable — so every gate built on this catalog was blind to the
    // rest of a multi-tool flow. get_loyalty_status sat intent-unreachable
    // through two rounds of fixes because nothing could see it; it was found by
    // driving the live stack, not by a test (PR #2446).
    // Declare every gateway tool a use case calls, not just the first.
    // `useCases.secondaryTools.test.js` fails on a gateway tool named in this
    // entry's prose but absent from primaryTool/secondaryTools.
    secondaryTools: ['get_loyalty_status'],
    studioPath: '/personal-agent',
    perVertical: {
      airlines: {
        trigger: { type: 'chip', text: 'have my agent use my miles for an upgrade' },
        primaryTool: 'redeem_miles',
        whatToSay: 'MFA proved, personal agent verified, miles redeemed — cabin upgraded.',
      },
    },
  },
];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/**
 * True when the entry's primary tool is only reachable through a two-hop A2A
 * chain. Served to the UI as `a2aDelegated` so surfaces can label the delegated
 * path from the SoT flag instead of a hand-kept list of use-case ids. (It used
 * to drive arming ff_a2a_delegation; that flag is gone — delegation is always
 * on — but the SoT field remains the one truthful marker of the two-hop tools.)
 */
function isA2aDelegatedPrimaryTool(tool) {
  if (!tool) return false;
  // Required lazily: this module is loaded by scripts with no need of the
  // topology, and a load failure there must not take the catalog with it.
  try {
    return require('../services/scopeTopology').isA2aDelegatedTool(tool) === true;
  } catch (_) {
    return false;
  }
}

// Stamped on the CANONICAL array, before the freeze — not only on resolveUseCase's
// output. The client mirror keys on this field, so an entry that reaches it
// without the field silently loses the requirement; USE_CASES is passed raw in
// places (requiredFlagsForUseCaseId, the parity test), and that path must carry it
// too. resolveUseCase recomputes it because a perVertical override may change
// primaryTool.
const USE_CASES = Object.freeze(
  RAW_USE_CASES.map((u) => deepFreeze({ ...u, a2aDelegated: isA2aDelegatedPrimaryTool(u.primaryTool) })),
);

// Tool→resource-server routing (mirrors demo_mcp_gateway disposition logic)
const INVEST_TOOLS = new Set([
  'get_investment_accounts', 'get_investment_balance',
  'get_investment_transactions', 'get_portfolio_summary',
]);
const APIKEY_TOOLS = new Set([
  'show_mortgage', 'show_investment', 'show_large_purchase', 'show_health_record',
  'show_gear_order', 'show_gear_warranty', 'show_expense_report', 'show_permit', 'show_enrollment', 'show_work_order',
]);
function resolveResourceServer(tool) {
  if (!tool) return null;
  if (INVEST_TOOLS.has(tool)) return { id: 'invest', name: 'MCP Invest', port: 8081 };
  if (APIKEY_TOOLS.has(tool)) return { id: 'apikey', name: 'Mortgage Service', port: 8082 };
  return { id: 'olb', name: 'MCP Server (OLB)', port: 8080 };
}

/** Exact-id lookup. @returns {UseCase|undefined} */
function getUseCase(id) {
  return USE_CASES.find((u) => u.id === id);
}

/** Deep-merge a perVertical override over the base entry. @returns {UseCase|undefined} */
function resolveUseCase(id, vertical) {
  const base = getUseCase(id);
  if (!base) return undefined;
  if (!vertical || vertical === 'banking' || !base.perVertical || !base.perVertical[vertical]) {
    const { perVertical, match, ...rest } = base;
    // No perVertical override applies here, so rest.primaryTool === base.primaryTool
    // always — reuse the value stamped once at module load instead of re-deriving
    // it (isA2aDelegatedPrimaryTool -> scopeTopology.load() does a sync fs.statSync
    // every call).
    return {
      ...rest,
      resourceServer: resolveResourceServer(rest.primaryTool),
      a2aDelegated: base.a2aDelegated,
    };
  }
  const ov = base.perVertical[vertical];
  const merged = {
    ...base,
    ...ov,
    trigger: ov.trigger ? { ...base.trigger, ...ov.trigger } : base.trigger,
  };
  const { perVertical, match, ...rest } = merged;
  return {
    ...rest,
    resourceServer: resolveResourceServer(rest.primaryTool),
    // Only recompute when the override actually swapped primaryTool; otherwise
    // reuse the precomputed base value (same statSync-avoidance as above).
    a2aDelegated: rest.primaryTool === base.primaryTool
      ? base.a2aDelegated
      : isA2aDelegatedPrimaryTool(rest.primaryTool),
  };
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
 * The declared step-up method for a use case (by useCaseId slug), or null.
 * This is the explicit, amount-independent trigger for a specific step-up
 * modality (e.g. 'ciba' on UC22): Authorize reads it to route the transaction
 * through the shared step-up path — no amount threshold, no hardcoded id string.
 * Declared once in the catalog, so every vertical inherits it.
 * @param {string|undefined} slug useCaseId slug (resolveActiveUseCaseId result)
 * @returns {string|null} e.g. 'ciba' | 'p1mfa' | 'email' | null
 */
function getUseCaseStepUpMethod(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const uc = USE_CASES.find((u) => u.useCaseId === slug);
  return (uc && typeof uc.stepUpMethod === 'string') ? uc.stepUpMethod : null;
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

module.exports = { USE_CASES, VERTICALS, getUseCase, resolveUseCase, listUseCases, deriveUseCaseId, isValidUseCaseId, getUseCaseStepUpMethod, resolveChipUseCaseId, READ_PRIMARY_TOOL_BY_VERTICAL, A2A_PRIMARY_TOOL_BY_VERTICAL, AMOUNT_PRIMARY_TOOL_BY_VERTICAL, SECOND_PRODUCT_TOOL_BY_VERTICAL, REQUEST_ONLY_TOOL_BY_VERTICAL, REQUEST_ONLY_NOT_APPLICABLE };
