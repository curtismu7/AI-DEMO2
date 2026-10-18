// CIBA approval link: the out-of-band approval the app uses for step-up and on /mfa-test.
// PingOne path: routes/ciba.js + services/cibaService.js (bc-authorize, CIBA-grant poll; email or SMS
// DaVinci flow sends the link). PingFederate path: routes/pfAiAgent.js + services/pfAiAgentCibaService.js
// (PF's backchannel endpoint from discovery; web approver or mock phone answers).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const PF = { color: 'var(--th-status-warning)' };

export const CIBA_LINK_GROUPS = {
  user: { label: 'Browser that asked', bg: 'var(--th-status-info)' },
  bff: { label: 'Banking BFF', bg: 'var(--th-bg-emphasis)' },
  pingone: { label: 'PingOne', bg: 'var(--th-status-success)' },
  device: { label: "User's email / phone", bg: 'var(--th-status-info)' },
  pf: { label: 'PingFederate', bg: 'var(--th-status-warning)' },
};

export const CIBA_LINK_NODES = [
  N('browser', 'user', 'App page', ['/mfa-test, step-up', 'shows the match code', 'polls; never redirects'], 0, 150),
  N('bff', 'bff', 'BFF CIBA routes', ['login_hint = signed-in', 'PingOne user (PF login', 'mapped by username)'], 380, 150),
  N('p1', 'pingone', 'PingOne CIBA', ['/as/bc-authorize', 'CIBA-grant poll on /as/token'], 760, 40),
  N('dv', 'pingone', 'DaVinci flow', ['email-only or SMS-only', 'per channel'], 1140, 40),
  N('device', 'device', "User's inbox / phone", ['link + match code', 'approve on any device'], 1140, 260),
  N('pf', 'pf', 'PingFederate CIBA', ['backchannel endpoint', 'from discovery'], 760, 380),
  N('approver', 'pf', 'PF approver', ['web approver plugin', 'or mock phone (local)'], 1140, 480),
];

export const CIBA_LINK_EDGES = [
  E('browser', 'bff', 'POST /api/auth/ciba/initiate { channel: email | sms, binding_message }'), // 0
  E('bff', 'p1', 'bc-authorize: login_hint (PingOne user id), binding_message ≤ 8 chars → auth_req_id'), // 1
  E('p1', 'dv', 'runs the flow for the channel'), // 2
  E('dv', 'device', 'sends the approval link with the match code'), // 3
  E('device', 'dv', 'user checks the code and approves'), // 4
  E('browser', 'bff', 'GET /api/auth/ciba/poll/:id every few seconds'), // 5
  E('bff', 'p1', 'CIBA grant: authorization_pending … then tokens'), // 6
  E('bff', 'browser', 'approved only if the id_token sub is the signed-in PingOne user'), // 7
  E('browser', 'bff', 'PF: POST /api/pf-ai-agent/ciba/start { loginHint, bindingMessage }', PF), // 8
  E('bff', 'pf', 'PF backchannel request → auth_req_id', PF), // 9
  E('pf', 'approver', 'authenticator asks the approver', PF), // 10
  E('approver', 'pf', 'Approve / Deny', PF), // 11
  E('bff', 'pf', 'PF: CIBA-grant poll; browser polls /ciba/status', PF), // 12
];

export const CIBA_LINK_STEPS = [
  { key: 'ask', edges: [0, 1], title: 'The app asks PingOne to reach the user', what: 'The page posts the channel and a short binding message. The BFF calls PingOne bc-authorize with the signed-in user as login_hint. Under a PingFederate login that is the PingOne account with the same username, never the PF username.', why: 'The request is about this user, so it is pinned to their PingOne id before anything is sent.' },
  { key: 'deliver', edges: [2, 3], title: 'DaVinci sends the link', what: 'PingOne runs the email-only or SMS-only DaVinci flow, which sends an approval link carrying the match code. The SMS flow needs a mobile phone on the profile.', why: 'Approval happens off the page that asked, on whatever device has the inbox or phone.' },
  { key: 'approve', edges: [4], title: 'The user checks the code and approves', what: 'The user opens the link, compares the match code with the one the page shows, and approves (or declines).', why: 'The code ties this approval to this request, so a stray link cannot approve something else.' },
  { key: 'poll', edges: [5, 6], title: 'The BFF polls for the result', what: 'The page polls the BFF; the BFF polls PingOne with the CIBA grant. PingOne answers authorization_pending until the user decides, then issues tokens.', why: 'Nothing redirects back: the page learns the answer by polling.' },
  { key: 'check', edges: [7], title: 'Approved only for the right person', what: "The BFF validates the id_token and requires its sub to be the signed-in user's PingOne id; a mismatch is rejected as a different account.", why: 'A link approved by someone else cannot satisfy this user\'s step-up.' },
  { key: 'pf', edges: [8, 9, 10, 11, 12], title: 'PingFederate: same pattern, different approver', what: "With a PingFederate session the PF CIBA routes use PF's backchannel endpoint. PF's authenticator hands the request to the web approver (or the local mock phone); Approve or Deny answers it while the BFF polls PF with the CIBA grant.", why: 'Same request, poll, answer shape; only the issuer and the approver change.' },
];

export const CIBA_LINK_DIAGRAM = { GROUPS: CIBA_LINK_GROUPS, NODES: CIBA_LINK_NODES, EDGES: CIBA_LINK_EDGES, STEPS: CIBA_LINK_STEPS };
