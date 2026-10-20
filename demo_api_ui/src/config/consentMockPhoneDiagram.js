// /transaction-consent: the mock-CIBA path (routes/consentMockPhone.js + services/consentMockPhoneService.js,
// ConsentMockPhoneFlow.jsx) and the real deep-link path (TransactionConsentPage -> TransactionConsentModal,
// /api/transactions/consent-challenge/:id[/confirm]). Mock moves no money and issues no token.
import { CONSENT_MOCK_DETAIL } from './consentMockPhoneStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const REAL = { dashed: true };

export const CONSENT_MOCK_GROUPS = {
  user: { label: 'User / browser', bg: '#2b3342' },
  bff: { label: 'Banking BFF', bg: '#151a24' },
  device: { label: 'Mock phone', bg: '#5a5f69' },
  ping: { label: 'PingOne MFA / CIBA (real run only)', bg: '#b5231a' },
};

export const CONSENT_MOCK_NODES = [
  N('browser', 'user', 'Browser: /transaction-consent', ['user picks a scenario', 'polls /status every 2 s'], 0, 150),
  N('bff', 'bff', 'BFF mock CIBA service', ['session-scoped, 5 min expiry', 'holds the request itself', 'no env gate, no token, no money'], 400, 150),
  N('phone', 'device', 'Mock phone', ['push: "Approve this', 'transaction?"', 'Approve / Deny taps'], 800, 150),
  N('ping', 'ping', 'PingOne MFA / CIBA', ['push to the real device', 'MFA device auth or OTP', 'NOT called in simulate mode'], 400, 380),
  N('modal', 'user', 'Consent modal (deep link)', ['/transaction-consent?challenge=', 'reads + confirms the challenge'], 0, 380),
];

export const CONSENT_MOCK_EDGES = [
  E('browser', 'bff', 'POST /api/consent-mock-phone/start (amount, type, description)'), // 0
  E('bff', 'phone', 'push shown on the mock phone; trace: bc-authorize (mock) + push'), // 1
  E('bff', 'browser', 'GET /status every 2 s: pending (or expired) + trace'), // 2
  E('phone', 'bff', 'POST /decision approve | deny: answers approved | denied + trace'), // 3
  E('ping', 'modal', 'real run: push opens the deep link ?challenge=<id>', REAL), // 4
  E('modal', 'bff', 'real run: GET consent-challenge, POST .../confirm, then MFA or OTP', REAL), // 5
];

const S = (key, edges, title, what, why) => ({ key, edges, title, what, why, detail: CONSENT_MOCK_DETAIL[key] });

// One STEP per arrow so each arrow carries its own request, token and standards detail.
export const CONSENT_MOCK_STEPS = [
  S('start', [0], 'Pick a scenario: the BFF starts a mock request', 'The browser posts the scenario snapshot. The BFF needs a signed-in user (login_hint) and stores one pending request in the session, with a mock bc-authorize trace instead of calling PingOne.', 'The page proves push, tap, result without moving money or issuing a token.'),
  S('push', [1], 'The push lands on the phone', 'The mock phone shows the notification, the same way PingOne would push to a real device after bc-authorize.', 'The decision is made on the device, never in the browser that started the request.'),
  S('poll', [2], 'The browser polls for the result', 'The page polls /status like a real CIBA client polling the token endpoint. /status answers pending, or expired after 5 minutes; once a decision is posted the request is gone, so a later /status returns 409.', 'The browser never sees the tap, only what the BFF holds.'),
  S('decide', [3], 'The tap is the decision', 'Approve or Deny posts to /decision. The /decision response itself carries approved or denied with the token-request trace and removes the pending request.', 'Approve ends with "tokens issued in a real run; none here"; deny maps to access_denied.'),
  S('real', [4], 'Real run: the push opens the deep link', 'In a real run the user\'s device gets a push and tapping it opens this page with ?challenge=<id>. The id comes from the BFF\'s consent-challenge store, not from PingOne.', 'Same page, same shape: only the device and the source of the push differ.'),
  S('confirm', [5], 'Real run: the consent modal confirms the challenge', 'The consent modal loads the challenge and confirms it through the BFF. Depending on the amount that is consent only, a PingOne MFA device check, or an OTP (then verify-otp, or DaVinci / Recognize). No token is issued: the BFF stamps a short session credit.', 'The BFF, not the browser, holds the challenge and the resulting session credit.'),
];

export const CONSENT_MOCK_DIAGRAM = { GROUPS: CONSENT_MOCK_GROUPS, NODES: CONSENT_MOCK_NODES, EDGES: CONSENT_MOCK_EDGES, STEPS: CONSENT_MOCK_STEPS };
