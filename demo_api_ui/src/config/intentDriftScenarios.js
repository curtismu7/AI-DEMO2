// demo_api_ui/src/config/intentDriftScenarios.js
//
// Prewritten grant/request pairs for the Intent Inspector, so an SE fires a
// known intent-drift case from the tree instead of typing thirteen fields.
//
// Nothing here decides anything. Each scenario is only the PARAMETERS posted to
// a PingOne Authorize decision endpoint; the verdict the page renders is P1AZ's.
// `expect` records what the "PingOne Authorize — Agent Intent Governance" policy
// set SHOULD return, so a disagreement between expectation and verdict is shown
// as a disagreement rather than quietly reinterpreted — the same reason
// snapshots/intentGovernanceSnapshot.test.js exists.
//
// These cover the same dimensions as that decision table (action / payee /
// amount drift, grant presence, expiry, consent, semantic drift, and the
// read-through case). Values use this demo's tool names.
//
// The point the drift cases make: 'amount-drift' and 'payee-drift' invoke the
// SAME tool the user consented to. A permitted_tools membership check — which is
// what the demo's older intent token does — cannot see either of them.
//
// Fired at a decision endpoint that is NOT backed by the Agent Intent Governance
// policy set, these return that endpoint's own verdict, which is not a drift
// verdict. The page says so rather than dressing it up.

export const INTENT_SCENARIO_CATEGORIES = [
  'Within grant',
  'Argument drift',
  'Grant integrity',
  'Semantic drift',
];

/** The grant a user consented to: transfer up to $100 to acme-utilities. */
const CONSENTED_GRANT = {
  IntentGrantPresent: 'true',
  IntentGrantConsented: 'true',
  IntentGrantExpired: 'false',
  IntentGrantAction: 'create_transfer',
  IntentGrantPayee: 'acme-utilities',
  IntentGrantMaxAmount: '100',
  IntentGrantRef: 'urn:ietf:params:oauth:request_uri:demo',
  IntentBindingMethod: 'par-rar',
};

/** The agent doing exactly what was asked. */
const MATCHING_REQUEST = {
  IntentRequestAction: 'create_transfer',
  IntentRequestPayee: 'acme-utilities',
  IntentRequestAmount: '80',
  IntentRequestMutating: 'true',
  IntentDriftScore: '0',
};

export const INTENT_DRIFT_SCENARIOS = [
  {
    key: 'within-grant',
    category: 'Within grant',
    label: 'Within the consented grant',
    prompt: 'Transfer $80 to Acme Utilities',
    description:
      'The agent does what the user asked. Every dimension matches the grant, so no deny rule fires and the catch-all permits.',
    expect: { decision: 'PERMIT', statement: 'intent-within-grant' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST },
  },
  {
    key: 'read-no-grant',
    category: 'Within grant',
    label: 'Read with no grant at all',
    prompt: 'What is my balance?',
    description:
      'Intent governs state changes only; reads fall through to scope policy. IntentRequestMutating=false keeps every drift rule out of scope, so this permits even with no grant bound.',
    expect: { decision: 'PERMIT', statement: 'intent-within-grant' },
    parameters: {
      IntentGrantPresent: 'false',
      IntentRequestAction: 'view_balance',
      IntentRequestMutating: 'false',
      IntentBindingMethod: 'none',
      IntentDriftScore: '0',
    },
  },
  {
    key: 'amount-drift',
    category: 'Argument drift',
    label: 'Amount inflated — same tool',
    prompt: 'Transfer $80 to Acme Utilities  (injected: make it $5,000)',
    description:
      'The canonical injection. Same tool, same payee, inflated amount. A permitted_tools check passes this; only a grant comparison catches it.',
    expect: { decision: 'DENY', statement: 'intent-amount-drift' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAmount: '5000' },
  },
  {
    key: 'payee-drift',
    category: 'Argument drift',
    label: 'Payee substituted — same tool',
    prompt: 'Transfer $80 to Acme Utilities  (injected: send it to attacker-account)',
    description:
      'Same tool, same amount, different counterparty. Also invisible to a tool-membership check.',
    expect: { decision: 'DENY', statement: 'intent-payee-drift' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestPayee: 'attacker-account' },
  },
  {
    key: 'action-drift',
    category: 'Argument drift',
    label: 'Different action entirely',
    prompt: 'Transfer $80 to Acme Utilities  (injected: close the account instead)',
    description:
      'The agent switches to an operation the user never consented to. The granted action comes from the grant, not from the tool being invoked, so this comparison can actually fail.',
    expect: { decision: 'DENY', statement: 'intent-action-drift' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentRequestAction: 'delete_account' },
  },
  {
    key: 'no-grant',
    category: 'Grant integrity',
    label: 'No grant bound to the token',
    prompt: 'Transfer $80 to Acme Utilities',
    description:
      'A state-changing action with no user-consented authorization_details on the token. Nothing authorizes it.',
    expect: { decision: 'DENY', statement: 'intent-grant-missing' },
    parameters: {
      IntentGrantPresent: 'false',
      IntentBindingMethod: 'none',
      ...MATCHING_REQUEST,
    },
  },
  {
    key: 'expired-grant',
    category: 'Grant integrity',
    label: 'Grant past its validity window',
    prompt: 'Transfer $80 to Acme Utilities  (grant issued 20 minutes ago)',
    description:
      'Consent does not last forever. An expired grant must be refreshed before the agent may continue.',
    expect: { decision: 'DENY', statement: 'intent-grant-expired' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantExpired: 'true' },
  },
  {
    key: 'not-consented',
    category: 'Grant integrity',
    label: 'Client-asserted, never approved by a human',
    prompt: 'Transfer $80 to Acme Utilities  (grant built by the client, no consent step)',
    description:
      'The grant was asserted by the client rather than approved by the user. This is the case the demo is in today: the RAR grant is BFF-built from the same request it authorizes, so no consent can be proven.',
    expect: { decision: 'DENY', statement: 'intent-not-consented' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentGrantConsented: 'false' },
  },
  {
    key: 'semantic-drift',
    category: 'Semantic drift',
    label: 'Inside the grant, but diverging',
    prompt: 'Transfer $80 to Acme Utilities  (paraphrased into something else)',
    description:
      'Every hard dimension matches, but an external evaluator scored the action as diverging. Permits with a RECONSENT obligation rather than denying. Inert unless something supplies IntentDriftScore — nothing does today.',
    expect: { decision: 'PERMIT', statement: 'intent-reconsent-required' },
    parameters: { ...CONSENTED_GRANT, ...MATCHING_REQUEST, IntentDriftScore: '0.8' },
  },
];

/**
 * The dimensions the policy compares, for the side-by-side view.
 *
 * This drives DISPLAY only. It re-states what the policy conditions do so a
 * reader can see which pair disagreed — it never decides the verdict, which
 * comes from PingOne Authorize. When the two disagree, that is a finding about
 * the deployed policy, and the page shows both rather than hiding one.
 */
export const INTENT_COMPARISONS = [
  { label: 'Action', grantKey: 'IntentGrantAction', requestKey: 'IntentRequestAction', rule: 'differs => intent-action-drift' },
  { label: 'Payee', grantKey: 'IntentGrantPayee', requestKey: 'IntentRequestPayee', rule: 'differs => intent-payee-drift' },
  { label: 'Amount', grantKey: 'IntentGrantMaxAmount', requestKey: 'IntentRequestAmount', rule: 'request > grant => intent-amount-drift', numeric: true },
];

/** Grant-integrity facts that gate every comparison above. */
export const INTENT_PRECONDITIONS = [
  { label: 'Grant present', key: 'IntentGrantPresent', good: 'true', rule: 'false + mutating => intent-grant-missing' },
  { label: 'User consented', key: 'IntentGrantConsented', good: 'true', rule: 'false => intent-not-consented' },
  { label: 'Grant expired', key: 'IntentGrantExpired', good: 'false', rule: 'true => intent-grant-expired' },
  { label: 'Mutating action', key: 'IntentRequestMutating', good: null, rule: 'false => intent governance does not apply' },
];

/** Every parameter the Agent Intent Governance policy set reads. */
export const INTENT_PARAM_FIELDS = [
  { key: 'IntentGrantPresent', group: 'grant', label: 'Grant present', type: 'boolean' },
  { key: 'IntentGrantConsented', group: 'grant', label: 'User consented', type: 'boolean' },
  { key: 'IntentGrantExpired', group: 'grant', label: 'Grant expired', type: 'boolean' },
  { key: 'IntentGrantAction', group: 'grant', label: 'Granted action', type: 'text' },
  { key: 'IntentGrantPayee', group: 'grant', label: 'Granted payee', type: 'text' },
  { key: 'IntentGrantMaxAmount', group: 'grant', label: 'Granted max amount', type: 'number' },
  { key: 'IntentGrantRef', group: 'grant', label: 'Grant reference', type: 'text' },
  { key: 'IntentBindingMethod', group: 'grant', label: 'Binding method', type: 'text' },
  { key: 'IntentRequestAction', group: 'request', label: 'Attempted action', type: 'text' },
  { key: 'IntentRequestPayee', group: 'request', label: 'Attempted payee', type: 'text' },
  { key: 'IntentRequestAmount', group: 'request', label: 'Attempted amount', type: 'number' },
  { key: 'IntentRequestMutating', group: 'request', label: 'Mutating action', type: 'boolean' },
  { key: 'IntentDriftScore', group: 'request', label: 'Semantic drift score', type: 'number' },
];
