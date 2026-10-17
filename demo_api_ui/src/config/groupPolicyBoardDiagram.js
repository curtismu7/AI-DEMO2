// /group-policy: GroupPolicyBoardPage.jsx -> routes/groupMembership.js. One live PingOne Authorize decision
// per load (?verticalId=); the check panel asks about the PICKED user, the board about the SIGNED-IN user.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const WRITE = { color: 'var(--th-status-warning)' };

export const GROUP_POLICY_GROUPS = {
  user: { label: 'Page', bg: 'var(--th-status-info)' },
  bff: { label: 'Banking BFF', bg: 'var(--th-bg-emphasis)' },
  ping: { label: 'PingOne', bg: 'var(--th-status-warning)' },
};

export const GROUP_POLICY_NODES = [
  N('page', 'user', 'Page load', ['arms the policy flag on arrival', 'restores it on leave'], 0, 0),
  N('board', 'user', 'Decision board', ['rows for the picked vertical', 'asks about the SIGNED-IN user'], 0, 200),
  N('panel', 'user', 'Check panel', ['asks about the PICKED user', '(demoUser, demoAdmin,', 'demoDelegate)'], 0, 400),
  N('toggle', 'user', 'Add / Remove button', ['changes the picked user\'s', 'membership, then re-checks'], 0, 600),
  N('flag', 'bff', 'ff_authorize_group_policy', ['group decides nothing', 'while this is off'], 400, 0),
  N('bff', 'bff', 'BFF /api/groups', ['decision-board, check,', 'check/toggle', 'one vertical per call'], 400, 300),
  N('dir', 'ping', 'PingOne directory', ['live group membership', 'manifest fallback if no', 'worker credentials'], 800, 150),
  N('authz', 'ping', 'PingOne Authorize', ['evaluates the vertical\'s', 'group-gated MCP tool:', 'PERMIT / DENY + codes'], 800, 450),
];

export const GROUP_POLICY_EDGES = [
  E('page', 'flag', 'PATCH feature-flags: arm it (only if it was off)'), // 0
  E('board', 'bff', 'GET /decision-board?verticalId='), // 1
  E('bff', 'dir', 'read membership (live)'), // 2
  E('bff', 'authz', 'evaluate the group-gated tool'), // 3
  E('authz', 'board', 'row: decision + statement codes'), // 4
  E('panel', 'bff', 'GET /check?username=&verticalId='), // 5
  E('authz', 'panel', 'decision for the picked user'), // 6
  E('toggle', 'bff', 'POST /check/toggle (inGroup)', WRITE), // 7
  E('bff', 'dir', 'write membership, re-read to verify', WRITE), // 8
];

export const GROUP_POLICY_STEPS = [
  { key: 'arm', edges: [0], title: 'Arriving turns the policy on', what: 'The group decides nothing while ff_authorize_group_policy is off, so the page enables it if it was off and restores it on leave.', why: 'The demo never leaves the authorization surface changed behind it.' },
  { key: 'board', edges: [1, 2, 3, 4], title: 'The board: one live decision for the signed-in user', what: 'The BFF reads the signed-in user\'s membership and asks PingOne Authorize about the picked vertical\'s group-gated tool. The row shows PERMIT or DENY and the statement codes that answered.', why: 'Membership comes from the manifest only if worker credentials are missing, and the page says so.' },
  { key: 'check', edges: [5, 6], title: 'The check panel: the same decision for any demo user', what: 'The panel asks the same Authorize question for the user you picked, so it can differ from the board.', why: 'Two subjects on one page: opposite verdicts are two users, not a contradiction.' },
  { key: 'toggle', edges: [7, 8], title: 'Flip membership, the next check flips', what: 'Add or remove the picked user from the vertical\'s group in PingOne, re-read it, then re-run the check and reload the board.', why: 'The directory changed, the token did not.' },
];

export const GROUP_POLICY_DIAGRAM = { GROUPS: GROUP_POLICY_GROUPS, NODES: GROUP_POLICY_NODES, EDGES: GROUP_POLICY_EDGES, STEPS: GROUP_POLICY_STEPS };
