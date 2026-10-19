// /transaction-consent: for each arrow, the request on the wire, the MOCK token (real run only) and the standards behind it.
// Vocabulary lives in pingStyleStandards.js. Teaching values only, no real secrets.
import { RFC, STEPUP, AUTHZ, AUTH } from './pingStyleStandards';

const CIBA = STEPUP.slice(0, 1);

export const CONSENT_MOCK_DETAIL = {
  start: {
    form: 'POST /api/consent-mock-phone/start\n  Cookie: session=<signed-in BFF session>\n  Content-Type: application/json\n\n  { "amount": 5000, "type": "transfer", "description": "Wire to savings" }',
    refs: [...CIBA, RFC(9470, 'Step-up authentication challenge'), AUTHZ[2]],
  },
  push: {
    form: '(mock, never sent to PingOne) POST /as/bc-authorize\n  login_hint=user1&scope=openid\n  &binding_message=Approve $5,000\n  &requested_expiry=300\n\n  <- { "auth_req_id": "mock-3f9c...", "expires_in": 300, "interval": 2 }',
    refs: [...CIBA, STEPUP[2]],
  },
  poll: {
    form: 'GET /api/consent-mock-phone/status\n  Cookie: session=<signed-in BFF session>\n\n  <- { "state": "pending" }   (every 2 s)\n  <- { "state": "approved" | "denied" | "expired", "trace": [...] }',
    refs: [...CIBA, RFC(8628, 'Device Authorization Grant: the same polling and slow_down idea')],
  },
  decide: {
    form: 'POST /api/consent-mock-phone/decision\n  Cookie: session=<signed-in BFF session>\n  Content-Type: application/json\n\n  { "decision": "approve" }   // or "deny" (maps to access_denied)',
    refs: [...CIBA, AUTH[0]],
  },
  real: {
    form: 'Push notification from PingOne MFA to the user device\n  body: "Approve this transaction?"\n  deep link: https://<host>/transaction-consent?challenge=<challenge id>',
    refs: [...CIBA, STEPUP[1], STEPUP[2]],
  },
  confirm: {
    form: 'GET  /api/transactions/consent-challenge/<challenge id>\nPOST /api/transactions/consent-challenge/<challenge id>/confirm\n  Cookie: session=<signed-in BFF session>\n  { "decision": "approve" }\n\n  (BFF then polls PingOne POST /as/token with grant_type=urn:openid:params:grant-type:ciba&auth_req_id=<id>)',
    tokens: [{
      note: 'ID token after approval, real run only · none in simulate mode',
      header: { alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' },
      claims: { iss: 'https://auth.pingone.com/<env id>/as', sub: 'user1', aud: 'banking-bff', iat: 1760000000, exp: 1760000300, auth_time: 1760000120, acr: 'urn:ping:acr:mfa', amr: ['mfa', 'swk'] },
    }],
    refs: [...CIBA, STEPUP[1], AUTHZ[2]],
  },
};
