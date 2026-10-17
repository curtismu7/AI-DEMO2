// /transaction-consent: the mock-CIBA path (routes/consentMockPhone.js + services/consentMockPhoneService.js,
// ConsentMockPhoneFlow.jsx) and the real deep-link path (TransactionConsentPage -> TransactionConsentModal,
// /api/transactions/consent-challenge/:id[/confirm]). Mock moves no money and issues no token.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const REAL = { color: 'var(--th-status-warning)' };

export const CONSENT_MOCK_GROUPS = {
  user: { label: 'User / browser', bg: 'var(--th-status-info)' },
  bff: { label: 'Banking BFF', bg: 'var(--th-bg-emphasis)' },
  device: { label: 'Mock phone', bg: 'var(--th-status-success)' },
  ping: { label: 'PingOne (real run only)', bg: 'var(--th-status-warning)' },
};

export const CONSENT_MOCK_NODES = [
  N('browser', 'user', 'Browser: /transaction-consent', ['user picks a scenario', 'polls /status every 2 s'], 0, 150),
  N('bff', 'bff', 'BFF mock CIBA service', ['session-scoped, 5 min expiry', 'holds the request itself', 'no env gate, no token, no money'], 400, 150),
  N('phone', 'device', 'Mock phone', ['push: "Approve this', 'transaction?"', 'Approve / Deny taps'], 800, 150),
  N('ping', 'ping', 'PingOne CIBA', ['/bc-authorize then /token', 'push to the real device', 'NOT called in simulate mode'], 400, 380),
  N('modal', 'user', 'Consent modal (deep link)', ['/transaction-consent?challenge=', 'reads + confirms the challenge'], 0, 380),
];

export const CONSENT_MOCK_EDGES = [
  E('browser', 'bff', 'POST /api/consent-mock-phone/start (amount, type, description)'), // 0
  E('bff', 'phone', 'push shown on the mock phone; trace: bc-authorize (mock) + push'), // 1
  E('bff', 'browser', 'GET /status every 2 s: pending, then approved / denied / expired + trace'), // 2
  E('phone', 'bff', 'POST /decision approve | deny'), // 3
  E('ping', 'modal', 'real run: push deep link carries ?challenge=', REAL), // 4
  E('modal', 'bff', 'real run: GET consent-challenge, POST .../confirm', REAL), // 5
];

export const CONSENT_MOCK_STEPS = [
  { key: 'start', edges: [0], title: 'Pick a scenario: the BFF starts a mock request', what: 'The browser posts the scenario snapshot. The BFF needs a signed-in user (login_hint) and stores one pending request in the session, with a mock bc-authorize trace instead of calling PingOne.', why: 'The page proves push, tap, result without moving money or issuing a token.' },
  { key: 'push', edges: [1, 2], title: 'The push lands on the phone; the browser polls', what: 'The mock phone shows the notification. Meanwhile the page polls /status like a real CIBA client polling the token endpoint.', why: 'The decision is made on the device, never in the browser that started the request.' },
  { key: 'decide', edges: [3], title: 'The tap is the decision', what: 'Approve or Deny posts to /decision; the next poll returns approved, denied, or expired (nobody answered in 5 minutes) with the token-request trace.', why: 'Approve ends with "tokens issued in a real run; none here"; deny maps to access_denied.' },
  { key: 'real', edges: [4, 5], title: 'Real run: PingOne pushes a deep link', what: 'In production a step-up obligation makes the BFF call PingOne CIBA; the push opens this page with ?challenge=. The consent modal loads the challenge and confirms it through the BFF.', why: 'Same page, same shape: only the device and the issuer of the push differ.' },
];

export const CONSENT_MOCK_DIAGRAM = { GROUPS: CONSENT_MOCK_GROUPS, NODES: CONSENT_MOCK_NODES, EDGES: CONSENT_MOCK_EDGES, STEPS: CONSENT_MOCK_STEPS };
