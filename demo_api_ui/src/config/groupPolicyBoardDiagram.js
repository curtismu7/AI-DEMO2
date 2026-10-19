// /group-policy: GroupPolicyBoardPage.jsx -> routes/groupMembership.js. One live PingOne Authorize decision
// per load (?verticalId=); the check panel asks about the PICKED user, the board about the SIGNED-IN user.
import { GROUP_POLICY_DETAIL as D } from './groupPolicyStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const WRITE = { color: 'var(--th-status-warning)' };

export const GROUP_POLICY_GROUPS = {
  user: { label: 'Page', bg: '#151a24' },
  bff: { label: 'Banking BFF', bg: '#5a5f69' },
  ping: { label: 'PingOne', bg: '#b5231a' },
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

const S = (key, i, title, what, why) => ({ key, edges: [i], title, what, why, detail: D[i] });

export const GROUP_POLICY_STEPS = [
  S('arm', 0, 'Arriving turns the policy on', 'The group decides nothing while ff_authorize_group_policy is off, so the page enables it if it was off and restores it on leave.', 'The demo never leaves the authorization surface changed behind it.'),
  S('board', 1, 'The board asks for one live decision', 'The page requests the picked vertical\'s decision for the signed-in user.', 'One vertical per call keeps the answer attributable.'),
  S('board-membership', 2, 'The BFF reads live group membership', 'The BFF reads the signed-in user\'s membership from the PingOne directory.', 'Membership comes from the manifest only if worker credentials are missing, and the page says so.'),
  S('board-evaluate', 3, 'The BFF asks PingOne Authorize', 'The BFF asks PingOne Authorize about the picked vertical\'s group-gated tool.', 'The policy, not the token scopes, decides.'),
  S('board-row', 4, 'The board shows PERMIT or DENY', 'The row shows the decision and the statement codes that answered.', 'Scopes are not entitlements: the codes say which rule fired.'),
  S('check', 5, 'The check panel asks about the picked user', 'The panel asks the same Authorize question for the user you picked.', 'Two subjects on one page: opposite verdicts are two users, not a contradiction.'),
  S('check-decision', 6, 'The panel shows that user\'s decision', 'The decision for the picked user can differ from the board.', 'Same policy, different subject.'),
  S('toggle', 7, 'Flip membership from the button', 'Add or remove the picked user from the vertical\'s group, then re-run the check and reload the board.', 'The directory changed, the token did not.'),
  S('toggle-write', 8, 'The BFF writes the directory and verifies', 'The BFF writes the membership to PingOne and re-reads it to verify.', 'The next check flips only if the directory really changed.'),
];

export const GROUP_POLICY_DIAGRAM = { GROUPS: GROUP_POLICY_GROUPS, NODES: GROUP_POLICY_NODES, EDGES: GROUP_POLICY_EDGES, STEPS: GROUP_POLICY_STEPS };
