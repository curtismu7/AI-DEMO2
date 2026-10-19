// AIC token exchange: for each arrow (EDGES index), the request on the wire, the MOCK tokens in play and the
// standards behind it. Values are teaching values, never real credentials. AIC tokens are opaque by default, so the
// "claims" shown are what introspection (RFC 7662) reports, not a decoded JWT. Vocabulary: pingStyleStandards.js.
import { RFC, AUTH, CREDS, EXCHANGE, INTROSPECT, BEARER } from './pingStyleStandards';

const AIC = 'https://openam-example.forgeblocks.com/am/oauth2/alpha';
const ISS = AIC;
const NOW = { iat: 1790000000, exp: 1790003600 };

const USER_INTROSPECT = {
  active: true, token_type: 'Bearer', client_id: 'aidemo2', sub: 'alice', iss: ISS, scope: 'openid repair',
  may_act: { client_id: 'agent' }, ...NOW,
};
const ACTOR_INTROSPECT = { active: true, token_type: 'Bearer', client_id: 'agent', sub: 'agent', iss: ISS, scope: 'repair', ...NOW };
const DELEGATED_INTROSPECT = {
  active: true, token_type: 'Bearer', client_id: 'agent', sub: 'alice', iss: ISS, scope: 'repair',
  act: { sub: 'agent' }, ...NOW,
};

const BROWSER_BFF = [RFC(6265, 'HTTP cookies: the session that holds the tokens on the BFF'), RFC(6749, 'OAuth 2.0 Authorization Framework')];

// Index = EDGES index in aicTokenExchangeDiagram.js.
export const AIC_STEP_DETAIL = [
  {
    form: `GET ${AIC}/authorize?response_type=code\n  &client_id=aidemo2&redirect_uri=https://local.ping-devops.com:4000/api/aic-demo/callback\n  &scope=openid repair&state=<nonce>\n  &code_challenge=<S256 hash>&code_challenge_method=S256`,
    refs: AUTH.slice(0, 4),
  },
  {
    form: `GET /api/aic-demo/callback?code=<one-time code>&state=<nonce>\n(then, from the BFF)\nPOST ${AIC}/access_token\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=https://local.ping-devops.com:4000/api/aic-demo/callback\n  &client_id=aidemo2&code_verifier=<PKCE secret>`,
    tokens: [
      { note: 'User access token · opaque; claims as AIC introspection reports them', claims: USER_INTROSPECT },
      { note: 'ID token · signed JWT proving who signed in', header: { alg: 'RS256', kid: 'aic-key-1' }, claims: { iss: ISS, sub: 'alice', aud: 'aidemo2', ...NOW } },
    ],
    refs: [...AUTH.slice(0, 4), ...INTROSPECT.slice(2, 3)],
  },
  {
    form: 'POST /api/aic-demo/actor-token\n  Cookie: sid=<BFF session>\n  (no body: the browser only asks, the BFF holds every token)',
    refs: [...BROWSER_BFF, { id: 'draft-ietf-oauth-browser-based-apps', title: 'OAuth 2.0 for Browser-Based Apps: the BFF pattern', kind: 'emerging' }],
  },
  {
    form: `POST ${AIC}/access_token\n  Authorization: Basic <agent:redacted>\n  grant_type=client_credentials&scope=repair`,
    tokens: [{ note: 'Actor access token · opaque; claims as AIC introspection reports them', claims: ACTOR_INTROSPECT }],
    refs: CREDS.slice(0, 3),
  },
  {
    form: `POST ${AIC}/introspect\n  Authorization: Basic <agent:redacted>\n  token=<access token>&token_type_hint=access_token`,
    tokens: [{ note: 'User token, introspected · shows the may_act claim AIC will check', claims: USER_INTROSPECT }],
    refs: INTROSPECT.slice(0, 1).concat(EXCHANGE.slice(0, 1)),
  },
  {
    form: 'POST /api/aic-demo/exchange\n  Cookie: sid=<BFF session>\n  (no body: the BFF already holds the user token and the actor token)',
    refs: BROWSER_BFF,
  },
  {
    form: `POST ${AIC}/access_token\n  Authorization: Basic <agent:redacted>\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<actor token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &requested_token_type=urn:ietf:params:oauth:token-type:access_token&scope=repair`,
    tokens: [
      { note: 'Subject token · the user token, may_act names the agent client', claims: USER_INTROSPECT },
      { note: 'Actor token · the agent identity', claims: ACTOR_INTROSPECT },
    ],
    refs: [...EXCHANGE.slice(0, 2), ...CREDS.slice(0, 1)],
  },
  {
    form: 'HTTP/1.1 200 OK\n{ "access_token": "<delegated token>",\n  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",\n  "token_type": "Bearer", "scope": "repair", "expires_in": 3600 }',
    tokens: [{ note: 'Delegated access token · opaque; claims as AIC introspection reports them', claims: DELEGATED_INTROSPECT }],
    refs: [...EXCHANGE.slice(0, 2), ...BEARER.slice(0, 1)],
  },
  {
    form: `POST ${AIC}/introspect\n  Authorization: Basic <agent:redacted>\n  token=<delegated token>&token_type_hint=access_token\n(response)\n{ "active": true, "sub": "alice", "act": { "sub": "agent" }, ... }`,
    tokens: [{ note: 'Delegated token, introspected · the act claim names who is acting for the user', claims: DELEGATED_INTROSPECT }],
    refs: [...INTROSPECT.slice(0, 1), ...EXCHANGE.slice(0, 1)],
  },
];
