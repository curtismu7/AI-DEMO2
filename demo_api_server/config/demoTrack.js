'use strict';
/**
 * Guided Demo Track — curated 2-act ordering over config/useCases.js.
 * Data only; runtime slot state lives in services/demoTrackService.js.
 * Spec: docs/superpowers/specs/2026-08-03-guided-demo-track-design.md
 */

const GAUNTLET_SIMS = [
  { sim: 'insufficient-scope',    ucId: 'UC5',  label: 'Wrong scope' },
  { sim: 'cross-owner-account',   ucId: 'UC10', label: 'Cross-owner access' },
  { sim: 'wrong-aud',             ucId: 'UC11', label: 'Bad client / wrong audience' },
  { sim: 'tampered-intent-token', ucId: 'UC15', label: 'Tampered intent token' },
  { sim: 'impersonation-no-act',  ucId: 'UC16', label: 'Impersonation (no OBO)' },
  { sim: 'introspection-down',    ucId: 'UC29', label: 'Introspection outage — fail closed' },
];

const TRACK_STEPS = [
  {
    stepId: 'delegated-access', act: 1, title: 'Delegated access — token exchange',
    capability: 'RFC 8693 · act claim', ucIds: ['UC1', 'UC3', 'UC12'],
    buyerStory: 'Every agent action must trace back to a real human — no anonymous agent access.',
    slots: {
      green: { source: 'tool', chipText: 'show my balance', match: { tools: ['get_account_balance', 'get_balance'] }, expected: ['PERMIT'] },
      red:   { source: 'sim', label: 'stolen token / wrong aud rejected', match: { sims: ['replayed-token'] }, expected: ['BLOCKED'] },
    },
    proved: {
      green: 'The agent acted for you — the act claim proves delegation, minted live via RFC 8693.',
      red: 'A replayed token died at the gateway — a bearer alone is not enough.',
      sayThis: 'Every agent action is cryptographically tied to the user who authorized it.',
    },
  },
  {
    stepId: 'a2a-delegation', act: 1, title: 'A2A delegation — specialist handoff',
    capability: 'Nested act chain', ucIds: ['UC2', 'UC2.5', 'UC13'],
    buyerStory: 'A specialist must carry proof of the original user\'s authorization through the entire chain.',
    slots: {
      green: {
        source: 'tool', chipText: 'hand off to a specialist',
        // Every a2aDelegated specialist tool (scope-topology.json) — the UC2 chip
        // dispatches a different one per vertical; banking is get_portfolio_summary.
        match: { tools: [
          'get_portfolio_summary',
          'sensitive_customer_identity', 'sensitive_holdings', 'sensitive_membership_details',
          'sensitive_order_history', 'sensitive_passenger_record', 'sensitive_patient_records',
          'sensitive_payroll_details', 'sensitive_student_finance', 'sensitive_supplier_contract',
          'sensitive_tax_record',
        ] },
        expected: ['PERMIT'],
      },
      red:   { source: 'sim', label: 'confused-deputy actor injection blocked', match: { sims: ['rogue-actor'] }, expected: ['BLOCKED'] },
    },
    proved: {
      green: 'The specialist inherited only narrowed scope — the nested act chain shows every hop back to the user.',
      red: 'An injected rogue actor was rejected — the delegation chain cannot be forged.',
      sayThis: 'Multi-agent pipelines stay governed end-to-end.',
    },
  },
  {
    stepId: 'fine-grained-authz', act: 1, title: 'Fine-grained authorization — PingOne Authorize',
    capability: 'P1AZ · policy externalized', ucIds: ['UC6', 'UC35'],
    buyerStory: 'Policy lives outside the agent — and every decision is explainable.',
    slots: {
      green: { source: 'tool', chipText: 'transfer $200 to savings', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'transfer $6,000 to savings', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'A normal transfer was permitted — the decision was evaluated live in PingOne Authorize, not hard-coded in the agent.',
      red: 'The same policy denied the large transfer — the tool was never invoked, decision ID on record.',
      sayThis: 'The agent didn\'t change between those two clicks — the policy decided.',
    },
  },
  {
    stepId: 'step-up', act: 1, title: 'Step-up authentication — trust is dynamic',
    capability: 'MFA · 428 challenge', ucIds: ['UC7'],
    buyerStory: 'A risk threshold mid-conversation forces re-authentication before money moves.',
    slots: {
      green: { source: 'tool', chipText: 'transfer after completing MFA', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'transfer above the step-up threshold', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['STEP_UP'] },
    },
    proved: {
      green: 'After MFA, the same transfer completed — trust was re-established, not assumed.',
      red: 'Without step-up the transfer was challenged (HTTP 428) — the deny is inherent to the flow.',
      sayThis: 'Trust is dynamic — it is earned per transaction, not granted once at login.',
    },
  },
  {
    stepId: 'hitl-ciba', act: 1, title: 'Human-in-the-loop — CIBA out-of-band approval',
    capability: 'HITL · CIBA', ucIds: ['UC8', 'UC22', 'UC27'],
    buyerStory: 'High-risk actions pause for a human decision on a second device — and the agent cannot skip it.',
    slots: {
      green: { source: 'tool', chipText: 'transfer approved by human on second device', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'agent attempts to bypass consent', match: { tools: ['transfer_funds', 'transfer_money'] }, expected: ['HITL', 'DENY'] },
    },
    proved: {
      green: 'A human approved out-of-band and only then did the transfer proceed.',
      red: 'The bypass attempt failed — consent is enforced server-side, not agent-side.',
      sayThis: 'The human stays in the loop by policy, not by the agent\'s good manners.',
    },
  },
  {
    stepId: 'mcp-gateway', act: 1, title: 'MCP Gateway — third-party MCP server, governed',
    capability: 'Gateway scoping', ucIds: ['UC30', 'UC31', 'UC32'],
    buyerStory: 'An external MCP server your bank did not write is still governed centrally at the gateway.',
    slots: {
      green: { source: 'tool', chipText: 'get the weather (scoped, permitted)', match: { tools: ['get_weather', 'get_forecast'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'out-of-scope third-party call', match: { tools: ['get_weather', 'get_forecast'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The third-party MCP call was permitted only for the scope the gateway granted.',
      red: 'The out-of-scope call was denied at the gateway — the external server never saw it.',
      sayThis: 'You can adopt third-party MCP servers without adopting their risk.',
    },
  },
  {
    stepId: 'attack-gauntlet', act: 1, title: 'Attack gauntlet — the chain fails closed',
    capability: 'Act 1 finale', ucIds: ['UC5', 'UC10', 'UC11', 'UC15', 'UC16', 'UC29', 'UC26'],
    buyerStory: 'Everything you just watched permit — now watch it deny. Same rails, rapid fire.',
    // Gauntlet: no green/red pair; six sim tiles tracked in run.gauntlet.
    slots: {
      red: { source: 'sim', label: 'six attacks, six denials', match: { sims: GAUNTLET_SIMS.map(g => g.sim) }, expected: ['BLOCKED'] },
    },
    proved: {
      green: null,
      red: 'Six distinct attacks, six denials — verdicts fetched live, not slideware.',
      sayThis: 'We didn\'t build a demo that works. We built one you can attack.',
    },
  },
  {
    stepId: 'pingone-mcp-admin', act: 2, title: 'PingOne MCP server — the governed admin agent',
    capability: 'Hosted PingOne MCP', ucIds: ['UC-LEARN2'],
    buyerStory: 'The AI that manages your identity platform is itself governed by it.',
    slots: {
      green: { source: 'tool', chipText: 'admin agent performs a real admin task', match: { tools: ['*'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'out-of-scope admin call denied', match: { tools: ['*'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The admin agent did real platform work through Ping\'s own hosted MCP server.',
      red: 'The same admin agent was denied outside its granted scope — dogfooding, same rails.',
      sayThis: 'The rails that govern your customers\' agents govern ours too.',
    },
  },
  {
    stepId: 'lifecycle-killswitch', act: 2, title: 'Agent lifecycle + kill switch',
    capability: 'Non-human identity', ucIds: ['UC19'],
    buyerStory: 'An agent identity is provisioned, audited, and revocable — instantly.',
    slots: {
      green: { source: 'tool', chipText: 'provisioned agent working normally', match: { tools: ['*'] }, expected: ['PERMIT'] },
      red:   { source: 'tool', chipText: 'kill switch — next call dies', match: { tools: ['*'] }, expected: ['DENY'] },
    },
    proved: {
      green: 'The agent worked because its identity was provisioned and in good standing.',
      red: 'One kill switch later, the very next call died — revocation is immediate.',
      sayThis: 'Non-human identity is managed like workforce identity — including the off switch.',
    },
  },
];

function getTrackDefinition() {
  return { steps: TRACK_STEPS, gauntletSims: GAUNTLET_SIMS };
}

module.exports = { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition };
