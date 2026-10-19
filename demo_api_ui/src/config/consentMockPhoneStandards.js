// /transaction-consent: for each arrow, the request on the wire and the standards behind it.
// Vocabulary lives in pingStyleStandards.js. Teaching values only, no real secrets.
// No MOCK token anywhere: neither the mock path nor the real confirm path issues one (the BFF stamps
// session.hitlVerified / session.stepUpVerified for 5 minutes instead).
import { RFC, SPEC, STEPUP } from './pingStyleStandards';

const CIBA = STEPUP[0];
const PING_CIBA = SPEC('PingOne CIBA', 'Backchannel authentication on PingOne: /as/bc-authorize, then /as/token');
const PING_MFA = SPEC('PingOne MFA', 'Device authentication API: push, OTP and FIDO2 devices');

export const CONSENT_MOCK_DETAIL = {
  start: {
    form: 'POST /api/consent-mock-phone/start\n  Cookie: session=<signed-in BFF session>\n  Content-Type: application/json\n\n  { "amount": 5000, "type": "transfer", "description": "Wire to savings" }\n\n  <- { "state": "pending", "requestId": "<uuid>", "loginHint": "user1", "expiresAt": "...", "trace": [...] }',
    refs: [CIBA, PING_CIBA],
  },
  push: {
    form: '(mock trace entry, never sent to PingOne) POST /bc-authorize\n  login_hint=user1&scope=openid\n  &binding_message=transfer.5000\n  &auth_req_id=<held by the BFF>\n\n  A real call also carries client authentication for the CIBA app, and PingOne limits\n  binding_message to 8 characters, so a real run must send a shorter message.',
    refs: [CIBA, PING_CIBA],
  },
  poll: {
    form: 'GET /api/consent-mock-phone/status\n  Cookie: session=<signed-in BFF session>\n\n  <- { "state": "pending", "requestId": "<uuid>", "expiresAt": "...", "trace": [...] }   (every 2 s)\n  <- { "state": "expired", ... }   after 5 minutes\n\n  After a decision the request is deleted: /status then answers 409 CONSENT_MOCK_NOTHING_PENDING.',
    refs: [SPEC('OpenID CIBA Core 1.0 poll mode', 'The client polls the token endpoint; ping and push modes are the alternatives'), RFC(8628, 'Device Authorization Grant: the same polling and slow_down idea')],
  },
  decide: {
    form: 'POST /api/consent-mock-phone/decision\n  Cookie: session=<signed-in BFF session>\n  Content-Type: application/json\n\n  { "decision": "approve" }   // or "deny"\n\n  <- { "state": "approved" | "denied", "trace": [ ..., token request (poll) ] }\n  trace body: approve -> note "tokens issued in a real run; none here", deny -> { "error": "access_denied" }',
    refs: [SPEC('OpenID CIBA Core 1.0 token errors', 'authorization_pending, slow_down, access_denied and expired_token while polling'), PING_CIBA],
  },
  real: {
    form: 'Push on the user\'s device, tap opens the deep link:\n  GET https://<host>/transaction-consent?challenge=<challenge id>\n\n  The challenge id comes from the BFF: POST /api/transactions/consent-challenge\n  <- 201 { "challengeId": "<id>", "expiresAt": "...", "snapshot": {...} }',
    refs: [PING_MFA, RFC(9470, 'Step-up authentication challenge: why a high-value transaction asks for consent first')],
  },
  confirm: {
    form: 'GET  /api/transactions/consent-challenge/<challenge id>\n  <- { "challengeId": "<id>", "snapshot": {...}, "status": "pending", "expiresAt": "..." }\n\nPOST /api/transactions/consent-challenge/<challenge id>/confirm\n  Cookie: session=<signed-in BFF session>\n  <- { "mfaRequired": true, "devices": [...] }   PingOne MFA device check\n  <- { "consentOnly": true, "confirmExpiresAt": "..." }   below the step-up threshold\n  <- { "otpSent": true, "otpExpiresAt": "..." }   or { "needsContact": true }\n\nPOST /api/transactions/consent-challenge/<challenge id>/verify-otp\n  { "deviceId": "<id>", "otp": "123456" }\n  <- { "challengeId": "<id>", "confirmExpiresAt": "..." }\n\nNo token is issued. The BFF stamps session.hitlVerified (and stepUpVerified after MFA) for 5 minutes.',
    refs: [PING_MFA, RFC(6238, 'TOTP: time-based one-time passwords'), SPEC('W3C WebAuthn Level 2', 'FIDO2 assertion checked for a passkey device')],
  },
};
