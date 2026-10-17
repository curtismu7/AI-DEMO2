// The two runs on DelegationChainValuePage: UC2 "hand off to a specialist" and UC2.6
// "simulate an agent identity mismatch". Token-chain ids are from the catalog
// evidence in demo_api_server/config/useCases.js (a2a-delegation, a2a-generalist-mismatch).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DENY = { color: 'var(--th-status-error)' };
const SAFE = { color: 'var(--th-status-success)' };

export const DELEGATION_CHAIN_GROUPS = {
  user: { label: 'User + page', bg: 'var(--th-status-info)' },
  agent: { label: 'Agents', bg: 'var(--th-bg-emphasis)' },
  idp: { label: 'PingOne', bg: 'var(--th-status-warning)' },
  gateway: { label: 'Gateway + Authorize', bg: 'var(--th-status-success)' },
  evidence: { label: 'Evidence', bg: 'var(--th-text-faint)' },
};

export const DELEGATION_CHAIN_NODES = [
  N('page', 'user', 'This page (Run button)', ['/api/agent/invoke via', 'sendAgentMessage', 'sporting-goods vertical'], 0, 150),
  N('generalist', 'agent', 'Generalist agent', ['hop 1: actor token', 'a2a-agent1-actor'], 340, 150),
  N('specialist', 'agent', 'Specialist agent', ['hop 2: actor token', 'a2a-agent2-actor'], 680, 150),
  N('idp', 'idp', 'PingOne token exchange', ['a2a-exchange1, a2a-exchange2', 'nested act claim, scope narrowed'], 510, 0),
  N('gw', 'gateway', 'Gateway + PingOne Authorize', ['sensitive_holdings tool call', 'checks act chain and actor identity'], 1020, 150),
  N('rogue', 'agent', 'Unregistered agent identity', ['fabricated for the probe;', 'no real token minted'], 1020, 400),
  N('rail', 'evidence', 'Token-chain rail', ['each hop, claims, nested act', 'shown after a run'], 340, 400),
];

export const DELEGATION_CHAIN_EDGES = [
  E('page', 'generalist', 'prompt: hand off to a specialist'), // 0
  E('generalist', 'idp', 'exchange 1: user token to delegated token'), // 1
  E('generalist', 'specialist', 'hands off the task'), // 2
  E('specialist', 'idp', 'exchange 2: nested act, narrower scope'), // 3
  E('specialist', 'gw', 'tool dispatched with the delegated token', SAFE), // 4
  E('page', 'rogue', 'prompt: simulate an agent identity mismatch'), // 5
  E('rogue', 'gw', 'same decision call, unregistered actor', DENY), // 6
  E('gw', 'rail', 'every hop recorded', SAFE), // 7
];

export const DELEGATION_CHAIN_STEPS = [
  { key: 'accountability', edges: [0, 1, 2, 3, 4], title: 'Delegate across two agents', what: 'The generalist delegates to a specialist; each hop is a token exchange that adds a nested act claim, and the governed tool call goes through the gateway.', evidence: 'Catalog evidence chain: user-token, a2a-agent1-actor, a2a-exchange1, a2a-agent2-actor, a2a-exchange2, tool-dispatched.' },
  { key: 'authorization', edges: [5, 6], title: 'Probe with an unregistered identity', what: 'Repeats the real delegation, then probes the same Authorize decision with an unregistered actor identity; the probe mints no token.', evidence: 'Evidence adds a2a-mismatch-probe; policy denies with invalid_a2a_generalist (PERMIT_THEN_DENY).' },
  { key: 'rail', edges: [7], title: 'Evidence on the rail', what: 'After a run the page renders the token-chain rail with subject, audience, scopes and the nested act chain.', evidence: 'Shown in the "The chain from that run" section once either Run completes.' },
];
