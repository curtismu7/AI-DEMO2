// /mfa-test step-up "PUSH · simulated phone" (services/mockPushPhoneService.js, routes/mfaTest.js push-mock/*,
// MFATestStepUpSection.tsx) next to the real PingOne MFA push it stands in for. The simulation never calls
// PingOne and grants nothing; the real path needs a phone app built on the PingOne MFA SDK.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const REAL = { color: 'var(--th-status-warning)' };

export const SIM_PUSH_GROUPS = {
  user: { label: 'Browser (step-up card)', bg: 'var(--th-status-info)' },
  bff: { label: 'Banking BFF', bg: 'var(--th-bg-emphasis)' },
  device: { label: 'Phone', bg: 'var(--th-status-success)' },
  ping: { label: 'PingOne (real push only)', bg: 'var(--th-status-warning)' },
};

export const SIM_PUSH_NODES = [
  N('card', 'user', 'Step-up card', ['/mfa-test', 'shows the number', 'polls every 2 s'], 0, 150),
  N('bff', 'bff', 'BFF simulated push', ['session-scoped, 2 min', 'no PingOne call', 'no step-up granted'], 400, 150),
  N('sim', 'device', 'Simulated phone', ['"Approve sign-in?"', 'number to match', 'Approve / Deny'], 800, 150),
  N('p1', 'ping', 'PingOne MFA', ['deviceAuthentications', 'PUSH_CONFIRMATION_REQUIRED'], 400, 400),
  N('app', 'device', 'Real phone app', ['PingOne MFA SDK', 'APNs / FCM push'], 800, 400),
];

export const SIM_PUSH_EDGES = [
  E('card', 'bff', 'POST /api/mfa/test/push-mock/start'), // 0
  E('bff', 'sim', 'shows "Approve sign-in?" + number to match'), // 1
  E('sim', 'bff', 'Approve or Deny tap (POST .../decision)'), // 2
  E('card', 'bff', 'GET .../status every 2 s: pending, then approved / denied / expired'), // 3
  E('card', 'p1', 'real: PUT /api/auth/mfa/challenge/:daId { MOBILE device }', REAL), // 4
  E('p1', 'app', 'real: push via APNs / FCM', REAL), // 5
  E('app', 'p1', 'real: approve in the app (SDK signs it)', REAL), // 6
];

export const SIM_PUSH_STEPS = [
  { key: 'start', edges: [0, 1], title: 'Pick "PUSH · simulated phone"', what: 'The card asks the BFF to start a simulated push. The BFF stores one pending request in the session with a two-digit number to match and shows it on the simulated phone.', why: 'No phone app is registered with PingOne MFA here, so the BFF plays the phone to show the flow.' },
  { key: 'tap', edges: [2], title: 'The tap is the decision', what: 'Approve or Deny on the phone posts the decision. Compare the number on the phone with the one the card shows before approving.', why: 'Number matching stops a user from approving a push they did not start.' },
  { key: 'poll', edges: [3], title: 'The card learns the answer by polling', what: 'The card polls the status every 2 seconds; the next poll after the tap reports approved or denied, or expired if nobody answered in 2 minutes.', why: 'A real push client polls the same way (GET /api/auth/mfa/challenge/:daId/status).' },
  { key: 'real', edges: [4, 5, 6], title: 'Real push: what the simulation stands in for', what: 'With a phone app built on the PingOne MFA SDK, picking its MOBILE device makes PingOne send a push through APNs or FCM; approving in the app completes the device authentication and the BFF marks the session stepped up.', why: 'The simulation proves the UX only: it sends no push and grants no step-up.' },
];

export const SIM_PUSH_DIAGRAM = { GROUPS: SIM_PUSH_GROUPS, NODES: SIM_PUSH_NODES, EDGES: SIM_PUSH_EDGES, STEPS: SIM_PUSH_STEPS };
