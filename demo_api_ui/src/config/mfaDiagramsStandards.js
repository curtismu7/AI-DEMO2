// /mfa-test diagrams (CIBA approval link, simulated push, device-first sign-in): per-arrow request form on the wire,
// MOCK tokens and the standards behind each step. Keyed by EDGES index. Teaching values only, no real secrets.
// The vocabulary lives in pingStyleStandards.js; withEdgeDetail() gives each arrow its own STEP so every arrow can carry its own detail.
import { RFC, DRAFT, SPEC, AUTH, STEPUP } from './pingStyleStandards';

const P1_ISS = 'https://auth.pingone.com/<envId>/as';
// Vendor documentation, not a standard: shown as kind 'spec' by the shared vocabulary, so the id carries the "Ping docs:" prefix.
const DOCS = (id, title) => SPEC(`Ping docs: ${id}`, title);
// PingOne email and SMS codes are server-generated random codes; RFC 6238 applies only to authenticator-app (TOTP) devices.
const TOTP = RFC(6238, 'TOTP: authenticator-app codes only (SMS and email codes are server-generated, not TOTP)');
// pi.flow is Ping-specific; this IETF draft is the standards-track analogue, not what the steps implement.
const FIRST_PARTY = DRAFT('draft-ietf-oauth-first-party-apps', 'Related, not the basis: standards-track analogue of an app-driven authorization flow');
const WEBAUTHN = [SPEC('W3C WebAuthn Level 2', 'Web Authentication (passkeys)'), SPEC('FIDO2 CTAP 2.1', 'Authenticator protocol'), DRAFT('W3C WebAuthn Level 3', 'In progress: successor to Level 2')];
const MFA_API = DOCS('PingOne MFA API', 'deviceAuthentications and device management');
const NIST = SPEC('NIST SP 800-63B', 'Out-of-band authenticators and assurance levels');
const BCAUTH = [SPEC('OpenID CIBA Core 1.0', 'Backchannel authentication endpoint (bc-authorize)'), RFC(6749, 'Token endpoint and client authentication')];
const CIBA_ID_TOKEN = {
  note: 'id_token · approved CIBA request', header: { alg: 'RS256', kid: '<signing key id>' },
  claims: { iss: P1_ISS, sub: '<PingOne user id>', aud: '<banking client id>', iat: 1760000000, auth_time: 1760000000, jti: '<token id>', acr: '<sign-on policy name>', amr: ['mfa'], exp: 1760000300 },
};
const POLL_PENDING = 'HTTP/1.1 400  { "error": "authorization_pending" }   // until the user decides; slow_down asks for a longer interval';
const POLL_OK = 'HTTP/1.1 200  { "access_token": "<opaque>", "token_type": "Bearer", "expires_in": 300, "id_token": "<JWT, see Token below>" }   // after the user approves';
const PF_DISCOVERY = SPEC('OIDC Discovery 1.0', 'The endpoint URL comes from the discovery document');

export const CIBA_DETAIL = {
  0: { form: 'POST /api/auth/ciba/initiate\n  Cookie: <BFF session>\n  { "channel": "email", "binding_message": "A7 3K" }', refs: [...STEPUP.slice(0, 1)] },
  1: { form: `POST ${P1_ISS}/bc-authorize\n  client_id=<banking client id>&client_secret=<redacted>\n  &scope=openid&login_hint=<PingOne user id>\n  &binding_message=A7 3K\n\n200 { "auth_req_id": "<opaque>", "expires_in": 120, "interval": 5 }`, refs: BCAUTH },
  2: { form: '(PingOne internal, not a public HTTP call)\n  run DaVinci flow: email-only | sms-only\n  input: user, auth_req_id, binding_message', refs: [DOCS('PingOne DaVinci', 'Flow that delivers the approval link'), ...BCAUTH.slice(0, 1)] },
  3: { form: 'To: <user email> | SMS to <user mobile>\n  "Approve sign-in? Match code A7 3K"\n  https://auth.pingone.com/<envId>/...  (single-use approval link)', refs: [NIST, SPEC('OpenID CIBA Core 1.0', 'Binding message shown on the approving device')] },
  4: { form: 'GET <approval link from the message>\n  user compares the match code, taps Approve (or Deny)', refs: [NIST, SPEC('OpenID CIBA Core 1.0', 'User consent on the authentication device')] },
  5: { form: 'GET /api/auth/ciba/poll/<auth_req_id>\n  Cookie: <BFF session>\n\n200 { "status": "pending", "engine": "pingone" }   // then "approved"; 403 denied, 410 expired', refs: [SPEC('OpenID CIBA Core 1.0', 'Poll mode')] },
  6: { form: `POST ${P1_ISS}/token\n  grant_type=urn:openid:params:grant-type:ciba\n  &auth_req_id=<opaque>&client_id=<banking client id>\n  Authorization: Basic <client_id:client_secret, redacted>\n\n${POLL_PENDING}\n${POLL_OK}`, tokens: [CIBA_ID_TOKEN], refs: [...BCAUTH, RFC(7519, 'JSON Web Token'), SPEC('OIDC Core 1.0', 'ID Token validation')] },
  7: { form: 'BFF check: id_token.sub === signed-in PingOne user id\n  match -> 200 { "status": "approved" }\n  mismatch -> 403 "approved by a different account"', tokens: [CIBA_ID_TOKEN], refs: [SPEC('OIDC Core 1.0', 'ID Token validation (sub)'), STEPUP[0]] },  // same-subject rule is this demo's BFF policy, not a spec requirement
  8: { form: 'POST /api/pf-ai-agent/ciba/start\n  { "loginHint": "<PF username>", "bindingMessage": "A7 3K" }', refs: STEPUP.slice(0, 1) },
  9: { form: 'POST {backchannel_authentication_endpoint}   // URL read from PingFederate\'s /.well-known/openid-configuration\n  Authorization: Basic <client_id:client_secret, redacted>\n  scope=openid&login_hint=<PF username>&binding_message=A7 3K\n\n200 { "auth_req_id": "<opaque>", "expires_in": 120, "interval": 5 }', refs: [...BCAUTH, PF_DISCOVERY] },
  10: { form: '(PingFederate internal)\n  CIBA authenticator -> approver (web approver plugin or mock phone)\n  request: user, binding message, transaction id', refs: [DOCS('PingFederate CIBA', 'Request policy and authenticator hand the request to the approver'), ...STEPUP.slice(0, 1)] },
  11: { form: 'POST /api/pf-ai-agent/ciba/decision\n  { "transactionId": "<id>", "decision": "approve" }   // or "deny"', refs: [DOCS('PingFederate CIBA', 'Approver answers the request'), NIST] },
  12: {
    form: `POST {token_endpoint}   // URL read from PingFederate's discovery document\n  Authorization: Basic <client_id:client_secret, redacted>\n  grant_type=urn:openid:params:grant-type:ciba&auth_req_id=<opaque>\n\n${POLL_PENDING}\n${POLL_OK}\n\nBrowser: GET /api/pf-ai-agent/ciba/status`,
    tokens: [{ note: 'id_token · PingFederate approved CIBA', header: { alg: 'RS256', kid: '<PF signing key id>' }, claims: { iss: 'https://<pf-host>:9031', sub: '<PF user>', aud: '<PF client id>', iat: 1760000000, jti: '<token id>', acr: '<acr from the PF policy contract>', exp: 1760000300 } }],
    refs: [...BCAUTH, PF_DISCOVERY, RFC(7519, 'JSON Web Token')],
  },
  13: { form: 'POST /api/auth/oauth/user/pi-flow/credentials\n  Cookie: <BFF session>\n  { "username": "<user>", "password": "<redacted>", "secondFactor": "ciba" }\n  (BFF drives the default-policy pi.flow with the normal login client)', refs: [...AUTH.slice(0, 1), DOCS('PingOne pi.flow', 'App-driven sign-in with response_mode=pi.flow'), FIRST_PARTY] },
  14: { form: '200 { "step": "approval", "channels": ["email", "sms"] }\n  BFF keeps the COMPLETED flow in the session: single use, 150 s\n  no Set-Cookie for a signed-in session yet', refs: [DOCS('PingOne pi.flow', 'COMPLETED flow carries the authorization code'), RFC(9700, 'OAuth 2.0 Security BCP: protect the authorization code')] },
  15: { form: 'POST /api/auth/ciba/login/start\n  Content-Type: application/json\n  { "channel": "email" }\n\nGET /api/auth/ciba/login/poll/<auth_req_id>   // 200 pending | approved, 403 denied, 410 expired', refs: [...STEPUP.slice(0, 1)] },
  16: { form: 'BFF check: id_token.sub === password user (PF user mapped by username)\n  match -> complete the parked flow, normal session cookie\n  denied | expired | other person -> discard the parked flow', tokens: [CIBA_ID_TOKEN], refs: [...STEPUP.slice(0, 1), SPEC('OIDC Core 1.0', 'ID Token validation (sub)'), RFC(9700, 'OAuth 2.0 Security BCP')] },
};

export const PUSH_DETAIL = {
  0: { form: 'POST /api/mfa/test/push-mock/start\n  Cookie: <BFF session>\n\n200 { "state": "pending", "username": "<user>", "numberToMatch": "47", "expiresAt": "<ISO time, 2 min>" }   // simulation: no PingOne call', refs: [NIST] },
  1: { form: 'Simulated phone shows:\n  "Approve sign-in?"  number to match: 47   [Approve] [Deny]', refs: [NIST, DOCS('PingOne MFA mobile SDK', 'Push approval in a phone app')] },
  2: { form: 'POST /api/mfa/test/push-mock/decision\n  Cookie: <BFF session>\n  { "decision": "approve" }   // or "deny"\n\n200 { "state": "approved", "numberToMatch": "47", ... }   // reported to the card on its next poll', refs: [NIST] },
  3: { form: 'GET /api/mfa/test/push-mock/status\n  Cookie: <BFF session>\n\n200 { "state": "pending", ... }   // then "approved" | "denied" | "expired" after 2 min\n409 { "error": "nothing_pending" }', refs: [MFA_API] },
  4: { form: 'PUT /api/auth/mfa/challenge/<daId>\n  { "deviceId": "<MOBILE device id>" }\n  (BFF -> PingOne deviceAuthentications, select device)\n\nstatus: PUSH_CONFIRMATION_REQUIRED', refs: [MFA_API, DOCS('PingOne MFA mobile SDK', 'Mobile app registration and push')] },
  5: { form: '(PingOne -> Apple APNs / Google FCM)\n  silent push to the registered phone app; payload carries the challenge reference', refs: [DOCS('PingOne MFA mobile SDK', 'Push via APNs / FCM'), NIST] },
  6: { form: '(phone app -> PingOne)\n  the SDK signs the approval with the device key\n\nGET /api/auth/mfa/challenge/<daId>/status -> COMPLETED', refs: [MFA_API, DOCS('PingOne MFA mobile SDK', 'Signed approval'), NIST] },
};

export const SIGNIN_DETAIL = {
  0: { form: 'POST /api/auth/oauth/user/pi-flow/passwordless   // admin: /api/auth/oauth/pi-flow/passwordless\n  Cookie: <BFF session>\n  { "username": "<user>" }\n\n200 { devices: [...] }   // device step; the provider is the one selected for this session', refs: [...AUTH.slice(0, 1), SPEC('OIDC Core 1.0', 'acr_values requests an authentication context')] },
  1: { form: 'GET {authorization_endpoint}?response_type=code   // from PingFederate discovery\n  &client_id=<client>&response_mode=pi.flow\n  &acr_values=mfa_only&code_challenge=<S256>&code_challenge_method=S256\nthen the flow link PF returns:\n  { "username": "<user>" }   // PF action submitIdentifier', refs: [...AUTH.slice(0, 3), DOCS('PingOne pi.flow', 'response_mode=pi.flow'), FIRST_PARTY] },
  2: { form: `GET ${P1_ISS}/authorize?response_type=code\n  &client_id=<client>&response_mode=pi.flow&acr_values=mfa_only\nthen the flow link PingOne returns:\n  { "username": "<user>" }   // PingOne action user.lookup`, refs: [...AUTH.slice(0, 3), DOCS('PingOne pi.flow', 'response_mode=pi.flow'), FIRST_PARTY] },
  3: { form: 'GET /v1/environments/<envId>/users/<userId>/devices\n  Authorization: Bearer <worker token>\n  -> email device addresses in full (providers mask them)', refs: [MFA_API, RFC(6750, 'Bearer token usage')] },
  4: { form: '200 { "devices": [\n  { "id": "<id>", "type": "SMS", "target": "+1******1234" },\n  { "id": "<id>", "type": "EMAIL", "target": "user@example.com" },\n  { "id": "<id>", "type": "FIDO2" } ] }', refs: [MFA_API] },
  5: { form: 'POST /api/auth/oauth/user/pi-flow/device   { "deviceId": "<id>" }\nPOST /api/auth/oauth/user/pi-flow/otp      { "otp": "123456" }   // wrong code = 401, retry\n(BFF to PF: selectDevice, checkOtp; to PingOne: device.select, otp.check)', refs: [MFA_API, TOTP, NIST] },
  6: { form: 'Pop-up: user picks the passkey\n  <- WebAuthn options { "challenge": "<random>", "rpId": "ping-devops.com", "allowCredentials": [...] }', refs: WEBAUTHN },
  7: { form: 'navigator.credentials.get({ publicKey: <options> })\nPOST /api/auth/oauth/user/pi-flow/assertion\n  { "assertion": <formatted credential: id, clientDataJSON, authenticatorData, signature>, "origin": "https://<app host>" }\n(BFF to PF: checkAssertion; to PingOne: assertion.check)', refs: WEBAUTHN },
  8: { form: 'PF flow response: { "status": "MFA_COMPLETED" }\nBFF continues the flow (PF action continueAuthentication)\n  -> { "status": "COMPLETED", "authorizeResponse": { "code": "<one-time code>", "state": "<nonce>" } }\nBFF to browser: { "redirectTo": "https://<app>/api/auth/oauth/user/callback?code=<one-time code>&state=<nonce>" }', refs: [DOCS('PingOne pi.flow', 'COMPLETED carries the authorization code'), ...AUTH.slice(0, 2)] },
  9: { form: 'GET /api/auth/oauth/user/callback?code=<one-time code>&state=<nonce>\nBFF: POST {token_endpoint}   // from the provider\'s discovery document\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=<callback>&code_verifier=<PKCE secret>\n\n200 { "access_token": "<opaque>", "id_token": "<JWT, see Token below>", "token_type": "Bearer", "expires_in": 300 }',
    tokens: [
      { note: 'id_token · PingFederate sign-in', header: { alg: 'RS256', kid: '<PF signing key id>' }, claims: { iss: 'https://<pf-host>:9031', sub: '<PF user>', aud: '<client id>', iat: 1760000000, jti: '<token id>', acr: '<acr from the PF policy contract>', amr: ['mfa'], exp: 1760000300 } },
      { note: 'id_token · PingOne sign-in', header: { alg: 'RS256', kid: '<signing key id>' }, claims: { iss: P1_ISS, sub: '<PingOne user id>', aud: '<client id>', iat: 1760000000, auth_time: 1760000000, jti: '<token id>', acr: '<sign-on policy name>', amr: ['mfa'], exp: 1760000300 } },
    ],
    refs: [...AUTH.slice(0, 3), SPEC('OIDC Core 1.0', 'ID Token claims (sub, acr, amr)'), RFC(8176, 'Authentication Method Reference Values'), RFC(7519, 'JSON Web Token')] },
  10: {
    form: 'GET /v1/environments/<envId>/users?filter=username eq "<user>"\n  Authorization: Bearer <worker token>\nGET .../users/<id>/memberOfGroups   // must be enabled and in pingone-admin\n  not a member -> admin refused (fail closed)',
    refs: [DOCS('PingOne Management API', 'Users and memberOfGroups'), RFC(6750, 'Bearer token usage (worker token)')],
  },
  11: { form: '302 Location: /admin   (or the return path)\n  Set-Cookie: <BFF session>; HttpOnly; Secure; SameSite=Lax', refs: [SPEC('OIDC Core 1.0', 'Session established after code exchange'), RFC(9700, 'OAuth 2.0 Security BCP')] },
};

// Split each grouped STEP into one STEP per arrow so each arrow shows its own detail. The first arrow keeps the
// title/what/why; the rest reuse the title with an n/N suffix and the arrow's own label as the text.
export function withEdgeDetail(steps, edges, detailByEdge) {
  return steps.flatMap((s) => s.edges.map((e, j) => ({
    ...s,
    key: s.edges.length > 1 ? `${s.key}-${e}` : s.key,
    edges: [e],
    title: s.edges.length > 1 ? `${s.title} (${j + 1}/${s.edges.length})` : s.title,
    ...(j === 0 ? {} : { what: edges[e][2], why: undefined }),
    detail: detailByEdge[e],
  })));
}
