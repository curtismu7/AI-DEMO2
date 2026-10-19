// /mfa-test diagrams (CIBA approval link, simulated push, device-first sign-in): per-arrow request form on the wire,
// MOCK tokens and the standards behind each step. Keyed by EDGES index. Teaching values only, no real secrets.
// The vocabulary lives in pingStyleStandards.js; withEdgeDetail() gives each arrow its own STEP so every arrow can carry its own detail.
import { RFC, DRAFT, SPEC, AUTH, STEPUP } from './pingStyleStandards';

const P1_ISS = 'https://auth.pingone.com/<envId>/as';
const OTP = [RFC(4226, 'HOTP: one-time passwords'), RFC(6238, 'TOTP: time-based one-time passwords')];
const WEBAUTHN = [SPEC('W3C WebAuthn Level 2', 'Web Authentication (passkeys)'), SPEC('FIDO2 CTAP 2.1', 'Authenticator protocol'), DRAFT('W3C WebAuthn Level 3', 'In progress: successor to Level 2')];
const MFA_API = SPEC('PingOne MFA API', 'deviceAuthentications and device management');
const NIST = SPEC('NIST SP 800-63B', 'Out-of-band authenticators and assurance levels');
const BCAUTH = [SPEC('OpenID CIBA Core 1.0', 'Backchannel authentication endpoint (bc-authorize)'), RFC(6749, 'Token endpoint and client authentication')];
const CIBA_ID_TOKEN = {
  note: 'id_token · approved CIBA request', header: { alg: 'RS256', kid: '<signing key id>' },
  claims: { iss: P1_ISS, sub: '<PingOne user id>', aud: '<banking client id>', auth_time: 1760000000, acr: 'Multi_Factor', amr: ['mfa'], exp: 1760000300 },
};
const POLL_PENDING = 'HTTP/1.1 400\n{ "error": "authorization_pending" }   // until the user decides; slow_down asks for a longer interval';

export const CIBA_DETAIL = {
  0: { form: 'POST /api/auth/ciba/initiate\n  Cookie: <BFF session>\n  { "channel": "email", "binding_message": "A7 3K" }', refs: [...STEPUP.slice(0, 1), RFC(9470, 'Step-up authentication challenge')] },
  1: { form: `POST ${P1_ISS}/bc-authorize\n  client_id=<banking client id>&client_secret=<redacted>\n  &scope=openid&login_hint=<PingOne user id>\n  &binding_message=A7 3K\n\n200 { "auth_req_id": "<opaque>", "expires_in": 120, "interval": 5 }`, refs: BCAUTH },
  2: { form: '(PingOne internal, not a public HTTP call)\n  run DaVinci flow: email-only | sms-only\n  input: user, auth_req_id, binding_message', refs: [SPEC('PingOne DaVinci', 'Flow that delivers the approval link'), ...BCAUTH.slice(0, 1)] },
  3: { form: 'To: <user email> | SMS to <user mobile>\n  "Approve sign-in? Match code A7 3K"\n  https://auth.pingone.com/<envId>/...  (single-use approval link)', refs: [NIST, SPEC('OpenID CIBA Core 1.0', 'Binding message shown on the approving device')] },
  4: { form: 'GET <approval link from the message>\n  user compares the match code, taps Approve (or Deny)', refs: [NIST, SPEC('OpenID CIBA Core 1.0', 'User consent on the authentication device')] },
  5: { form: 'GET /api/auth/ciba/poll/<auth_req_id>\n  Cookie: <BFF session>\n\n200 { "status": "pending" }', refs: [SPEC('OpenID CIBA Core 1.0', 'Poll mode')] },
  6: { form: `POST ${P1_ISS}/token\n  grant_type=urn:openid:params:grant-type:ciba\n  &auth_req_id=<opaque>&client_id=<banking client id>\n\n${POLL_PENDING}`, tokens: [CIBA_ID_TOKEN], refs: [...BCAUTH, RFC(7519, 'JSON Web Token'), SPEC('OIDC Core 1.0', 'ID Token validation')] },
  7: { form: 'BFF check: id_token.sub === signed-in PingOne user id\n  match -> 200 { "status": "approved" }\n  mismatch -> 403 "approved by a different account"', tokens: [CIBA_ID_TOKEN], refs: [SPEC('OIDC Core 1.0', 'ID Token validation (sub)'), RFC(9470, 'Step-up satisfied only for the same subject')] },
  8: { form: 'POST /api/pf-ai-agent/ciba/start\n  { "loginHint": "<PF username>", "bindingMessage": "A7 3K" }', refs: STEPUP.slice(0, 2) },
  9: { form: 'POST <backchannel_authentication_endpoint from PingFederate discovery>\n  client_id=<PF client id>&scope=openid\n  &login_hint=<PF username>&binding_message=A7 3K\n\n200 { "auth_req_id": "<opaque>", "expires_in": 120 }', refs: [...BCAUTH, SPEC('OIDC Discovery 1.0', 'Endpoint comes from the discovery document')] },
  10: { form: '(PingFederate internal)\n  CIBA authenticator -> approver (web approver plugin or mock phone)\n  request: user, binding message, transaction id', refs: [SPEC('PingFederate CIBA authenticator', 'Hands the request to the approver'), ...STEPUP.slice(0, 1)] },
  11: { form: 'POST /api/pf-ai-agent/ciba/decision\n  { "transactionId": "<id>", "decision": "approve" }   // or "deny"', refs: [SPEC('PingFederate CIBA authenticator', 'Approver answers the request'), NIST] },
  12: {
    form: `POST <PF token endpoint>\n  grant_type=urn:openid:params:grant-type:ciba&auth_req_id=<opaque>\n\n${POLL_PENDING}\n\nBrowser: GET /api/pf-ai-agent/ciba/status`,
    tokens: [{ note: 'id_token · PingFederate approved CIBA', header: { alg: 'RS256', kid: '<PF signing key id>' }, claims: { iss: 'https://<pf-host>:9031', sub: '<PF user>', aud: '<PF client id>', acr: 'urn:ping:acr:mfa', exp: 1760000300 } }],
    refs: [...BCAUTH, RFC(7519, 'JSON Web Token')],
  },
  13: { form: 'POST <BFF pi.flow sign-in endpoint>\n  { "username": "<user>", "password": "<redacted>", "secondFactor": "ciba" }\n  (BFF drives the default-policy pi.flow with the normal login client)', refs: [...AUTH.slice(0, 1), SPEC('PingOne pi.flow', 'App-driven sign-in, response_mode=pi.flow'), DRAFT('draft-ietf-oauth-first-party-apps', 'OAuth 2.0 for First-Party Applications')] },
  14: { form: '200 { "status": "approval_required" }\n  BFF keeps the COMPLETED flow in the session: single use, 150 s\n  no Set-Cookie for a signed-in session yet', refs: [SPEC('PingOne pi.flow', 'COMPLETED flow carries the authorization code'), RFC(9700, 'OAuth 2.0 Security BCP: protect the authorization code')] },
  15: { form: 'POST /api/auth/ciba/login/start\n  { "channel": "email" }\n\nGET /api/auth/ciba/login/poll/<auth_req_id>', refs: [...STEPUP.slice(0, 1), RFC(9470, 'Step-up authentication challenge')] },
  16: { form: 'BFF check: id_token.sub === password user (PF user mapped by username)\n  match -> complete the parked flow, normal session cookie\n  denied | expired | other person -> discard the parked flow', tokens: [CIBA_ID_TOKEN], refs: [...STEPUP.slice(0, 1), SPEC('OIDC Core 1.0', 'ID Token validation (sub)'), RFC(9700, 'OAuth 2.0 Security BCP')] },
};

export const PUSH_DETAIL = {
  0: { form: 'POST /api/mfa/test/push-mock/start\n  Cookie: <BFF session>\n\n200 { "id": "<mock id>", "number": "47", "expiresIn": 120 }   // simulation: no PingOne call', refs: [NIST] },
  1: { form: 'Simulated phone shows:\n  "Approve sign-in?"  number to match: 47   [Approve] [Deny]', refs: [NIST, SPEC('PingOne MFA mobile app', 'Push approval with number matching')] },
  2: { form: 'POST /api/mfa/test/push-mock/<id>/decision\n  { "decision": "approve" }   // or "deny"', refs: [NIST] },
  3: { form: 'GET /api/mfa/test/push-mock/<id>/status\n\n200 { "status": "pending" }   // then approved | denied | expired after 2 min', refs: [MFA_API] },
  4: { form: 'PUT /api/auth/mfa/challenge/<daId>\n  { "device": { "id": "<MOBILE device id>" } }\n  (BFF -> PingOne deviceAuthentications, select device)\n\nstatus: PUSH_CONFIRMATION_REQUIRED', refs: [MFA_API, SPEC('PingOne MFA SDK', 'Mobile app registration and push')] },
  5: { form: '(PingOne -> Apple APNs / Google FCM)\n  silent push to the registered phone app; payload carries the challenge reference', refs: [SPEC('PingOne MFA SDK', 'Push via APNs / FCM'), NIST] },
  6: { form: '(phone app -> PingOne)\n  the SDK signs the approval with the device key\n\nGET /api/auth/mfa/challenge/<daId>/status -> COMPLETED', refs: [MFA_API, SPEC('PingOne MFA SDK', 'Signed approval'), NIST] },
};

export const SIGNIN_DETAIL = {
  0: { form: 'POST /api/auth/pi-flow/start\n  { "username": "<user>", "provider": "pingone" | "pingfederate" }\nthen\n  { "deviceId": "<id>", "otp": "123456" }', refs: [...AUTH.slice(0, 1), SPEC('OIDC Core 1.0', 'acr_values requests an authentication context')] },
  1: { form: 'GET <PF>/as/authorization.oauth2?response_type=code\n  &client_id=<client>&response_mode=pi.flow\n  &acr_values=mfa_only&code_challenge=<S256>&code_challenge_method=S256\nPOST <PF flow>  { "username": "<user>" }   // submitIdentifier', refs: [...AUTH.slice(0, 3), SPEC('PingOne pi.flow', 'response_mode=pi.flow'), DRAFT('draft-ietf-oauth-first-party-apps', 'OAuth 2.0 for First-Party Applications')] },
  2: { form: `GET ${P1_ISS}/authorize?response_type=code\n  &client_id=<client>&response_mode=pi.flow&acr_values=mfa_only\nPOST <flow>  { "username": "<user>" }   // user.lookup`, refs: [...AUTH.slice(0, 3), SPEC('PingOne pi.flow', 'response_mode=pi.flow'), DRAFT('draft-ietf-oauth-first-party-apps', 'OAuth 2.0 for First-Party Applications')] },
  3: { form: 'GET /v1/environments/<envId>/users/<userId>/devices\n  Authorization: Bearer <worker token>\n  -> email device addresses in full (providers mask them)', refs: [MFA_API, RFC(6750, 'Bearer token usage')] },
  4: { form: '200 { "devices": [\n  { "id": "<id>", "type": "SMS", "target": "+1******1234" },\n  { "id": "<id>", "type": "EMAIL", "target": "user@example.com" },\n  { "id": "<id>", "type": "FIDO2" } ] }', refs: [MFA_API] },
  5: { form: 'POST <PF flow>  { "selectDevice": { "deviceRef": "<id>" } }\nPOST <PF flow>  { "checkOtp": { "otp": "123456" } }   // wrong code = retry\n(PingOne: device.select, otp.check)', refs: [MFA_API, ...OTP, NIST] },
  6: { form: 'Pop-up: user picks the passkey\n  <- WebAuthn options { "challenge": "<random>", "rpId": "ping-devops.com", "allowCredentials": [...] }', refs: WEBAUTHN },
  7: { form: 'navigator.credentials.get({ publicKey: <options> })\nPOST /pi-flow/assertion\n  { "id": "<credential id>", "response": { "clientDataJSON": "<b64>", "authenticatorData": "<b64>", "signature": "<b64>" } }\n(PF: checkAssertion, PingOne: assertion.check)', refs: WEBAUTHN },
  8: { form: 'PF flow response: { "status": "MFA_COMPLETED" }\nBFF: POST <PF flow>  continueAuthentication\n  -> { "status": "COMPLETED", "authorizeResponse": { "code": "<one-time code>", "state": "<nonce>" } }', refs: [SPEC('PingOne pi.flow', 'COMPLETED carries the authorization code'), ...AUTH.slice(0, 1)] },
  9: { form: 'GET /callback?code=<one-time code>&state=<nonce>\nBFF: POST <token endpoint>\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=<callback>&code_verifier=<PKCE secret>', refs: [...AUTH.slice(0, 3)] },
  10: {
    form: 'GET /v1/environments/<envId>/users?filter=username eq "<user>"\nGET .../users/<id>/memberOfGroups   // must be enabled and in pingone-admin\n  not a member -> admin refused (fail closed)',
    tokens: [{ note: 'id_token · PingFederate sign-in', header: { alg: 'RS256', kid: '<PF signing key id>' }, claims: { iss: 'https://<pf-host>:9031', sub: '<PF user>', aud: '<client id>', acr: 'mfa_only', amr: ['mfa'], exp: 1760000300 } }],
    refs: [SPEC('OIDC Core 1.0', 'ID Token claims (sub, acr, amr)'), RFC(8176, 'Authentication Method Reference Values'), RFC(7519, 'JSON Web Token')],
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
