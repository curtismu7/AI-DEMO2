// Device-first sign-in: the sign-in modal (components/PiFlowSignInModal.jsx) drives a pi.flow on the
// BFF (services/piFlowDriver.js) — no redirect, no password. PingOne: acr_values=mfa_only policy.
// PingFederate: mfa_only selects identifier-first -> PingOne MFA adapter
// (scripts/pingfederate/enable-pf-passwordless.js). Admin sign-in through PF is gated on PingOne
// group pingone-admin (routes/oauth.js callback, pingOneGroupMembershipService.isPingOneAdminByUsername).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const PF = { color: 'var(--th-status-warning)' };

export const SIGNIN_GROUPS = {
  user: { label: 'Browser', bg: 'var(--th-status-info)' },
  bff: { label: 'BFF', bg: 'var(--th-bg-emphasis)' },
  pf: { label: 'PingFederate', bg: 'var(--th-status-warning)' },
  pingone: { label: 'PingOne', bg: 'var(--th-status-success)' },
};

export const SIGNIN_NODES = [
  N('modal', 'user', 'Sign-in pop-up', ['username (prefilled)', 'device list, code', 'never leaves the page'], 0, 200),
  N('webauthn', 'user', 'Passkey in the browser', ['navigator.credentials.get', 'rpId ping-devops.com'], 0, 480),
  N('driver', 'bff', 'BFF pi.flow driver', ['acr_values=mfa_only', 'carries the flow cookies'], 460, 200),
  N('callback', 'bff', 'BFF /callback', ['code exchange', 'session + return path'], 460, 480),
  N('pfid', 'pf', 'PF identifier first', ['submitIdentifier', 'then authenticate'], 920, 0),
  N('pfmfa', 'pf', 'PF PingOne MFA adapter', ['selectDevice', 'checkOtp / checkAssertion'], 920, 160),
  N('p1', 'pingone', 'PingOne sign-on', ['mfa_only policy', 'user.lookup, device.select'], 920, 320),
  N('dir', 'pingone', 'PingOne directory', ['users + MFA devices', 'group pingone-admin'], 920, 560),
];

export const SIGNIN_EDGES = [
  E('modal', 'driver', 'username, then the device and code'), // 0
  E('driver', 'pfid', 'PF: pi.flow authorize + username', PF), // 1
  E('driver', 'p1', 'PingOne: pi.flow authorize + user.lookup'), // 2
  E('driver', 'dir', 'full address of each email device'), // 3
  E('driver', 'modal', 'devices: SMS, Email, Passkey'), // 4
  E('driver', 'pfmfa', 'selectDevice, checkOtp / checkAssertion', PF), // 5
  E('modal', 'webauthn', 'passkey picked'), // 6
  E('webauthn', 'modal', 'signed assertion → POST /pi-flow/assertion'), // 7
  E('pfmfa', 'driver', 'MFA_COMPLETED → continue → code', PF), // 8
  E('driver', 'callback', 'code + state'), // 9
  E('callback', 'dir', 'PF admin: in pingone-admin?'), // 10
  E('callback', 'modal', 'signed in: /admin or the return path'), // 11
];

export const SIGNIN_STEPS = [
  { key: 'open', edges: [0, 1, 2], title: 'Username first, in the pop-up', what: 'Every sign-in entry (Sign In, the Admin button, a signed-out /admin) opens the same pop-up, and the BFF starts a pi.flow at the selected provider with acr_values=mfa_only, the policy with no password step. The last username that actually signed in is prefilled. PingFederate takes the username as submitIdentifier, then authenticate; PingOne as user.lookup.', why: 'Device-first: the whole sign-in happens in the app, and the second factor proves the person, so there is no password to type or steal.' },
  { key: 'devices', edges: [3, 4], title: 'Devices the user can tell apart', what: 'The providers mask device emails hard (PF: cm****@domain). The BFF looks the user up in PingOne and swaps in each email device’s full address; PF’s device ids are PingOne MFA device ids, so they match. SMS keeps its masked number.', why: 'Two addresses on one domain looked identical, so the user could not pick the right one.' },
  { key: 'otp', edges: [5], title: 'SMS or email: a one-time code', what: 'Picking SMS or Email selects that device (PF: selectDevice with deviceRef) and sends a code, which the user types into the pop-up (PF: checkOtp; a wrong code is a retry, not a failure). On PingOne the same happens through device.select and otp.check.', why: 'The code arrives on a device the user already registered.' },
  { key: 'passkey', edges: [6, 7], title: 'Or a passkey', what: 'Picking the passkey returns WebAuthn options (rpId ping-devops.com). The browser signs the challenge and the BFF posts the assertion to PF as checkAssertion, the same body PingOne takes as assertion.check.', why: 'One touch and phishing-resistant; proven live on PingFederate 2026-10-18.' },
  { key: 'complete', edges: [8, 9], title: 'The flow finishes with a code', what: 'After the factor PF answers MFA_COMPLETED; the BFF continues it to COMPLETED, which carries the authorization code, and the browser goes to the normal /callback.', why: 'Without continueAuthentication the flow would stall and fall back to the hosted password page.' },
  { key: 'gate', edges: [10, 11], title: 'Admin through PF: the PingOne group still decides', what: 'PingOne’s admin app only lets the pingone-admin group in, but a PF admin sign-in never touches that app. So the callback requires the PingOne user with the same username to be enabled and a member of pingone-admin, and refuses admin otherwise (fail closed). Then the session is made and the user lands on /admin or the page they came from.', why: 'One admin list, whichever provider the user signed in with.' },
];

export const SIGNIN_DIAGRAM = { GROUPS: SIGNIN_GROUPS, NODES: SIGNIN_NODES, EDGES: SIGNIN_EDGES, STEPS: SIGNIN_STEPS };
