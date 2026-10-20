// AIC token exchange: for each arrow (EDGES index), the request on the wire, the MOCK tokens in play and the
// standards behind it. Values are teaching values, never real credentials. AIC tokens are opaque by default, so the
// "claims" shown are what introspection (RFC 7662) reports, not a decoded JWT. Vocabulary: pingStyleStandards.js.
import { RFC, AUTH, CREDS, EXCHANGE, INTROSPECT, BEARER } from './pingStyleStandards';

const AIC = 'https://openam-example.forgeblocks.com/am/oauth2/alpha';
const ISS = AIC;
const NOW = { iat: 1790000000, exp: 1790003600 };

const USER_SCOPE = 'openid profile email repair'; // userScope = openid profile email + aic_delegated_scope
// The user token belongs to client aidemo2. The agent client sees it like this only when it holds am-introspect-all-tokens;
// without that scope AIC answers INACTIVE (see introspectStep in aicDemoService.js).
const USER_INTROSPECT = {
  active: true, token_type: 'Bearer', client_id: 'aidemo2', sub: 'alice', iss: ISS, scope: USER_SCOPE,
  may_act: { client_id: 'agent' }, ...NOW,
};
const INACTIVE = { active: false };
const ACTOR_INTROSPECT = { active: true, token_type: 'Bearer', client_id: 'agent', sub: 'agent', iss: ISS, scope: 'repair', ...NOW };
const DELEGATED_INTROSPECT = {
  active: true, token_type: 'Bearer', client_id: 'agent', sub: 'alice', iss: ISS, scope: 'repair',
  act: { sub: 'agent' }, ...NOW,
};

const BROWSER_BFF = [RFC(6265, 'HTTP cookies: the session that holds the tokens on the BFF'), RFC(6749, 'OAuth 2.0 Authorization Framework')];

// Index = EDGES index in aicTokenExchangeDiagram.js.
export const AIC_STEP_DETAIL = [
  {
    form: `GET ${AIC}/authorize?response_type=code\n  &client_id=aidemo2&redirect_uri=https://local.ping-devops.com:4000/api/aic-demo/callback\n  &scope=openid profile email repair\n  &state=<random state>&nonce=<random nonce>\n  &code_challenge=<S256 hash>&code_challenge_method=S256`,
    refs: [...AUTH.slice(0, 4), AUTH[6]],
  },
  {
    form: `GET /api/aic-demo/callback?code=<one-time code>&state=<random state>\n(then, from the BFF)\nPOST ${AIC}/access_token\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=https://local.ping-devops.com:4000/api/aic-demo/callback\n  &client_id=aidemo2&code_verifier=<PKCE secret>`,
    tokens: [
      { note: 'User access token · opaque; claims as AIC introspection reports them to a client holding am-introspect-all-tokens', claims: USER_INTROSPECT },
      { note: 'ID token · signed JWT proving who signed in', header: { alg: 'RS256', kid: 'aic-key-1' }, claims: { iss: ISS, sub: 'alice', aud: 'aidemo2', nonce: '<random nonce from step 1>', ...NOW } },
    ],
    refs: [...AUTH.slice(0, 4), AUTH[6], INTROSPECT[2]],
  },
  {
    form: 'POST /api/aic-demo/actor-token\n  Cookie: sid=<BFF session>\n  (no body: the browser only asks, the BFF holds every token)',
    refs: [...BROWSER_BFF, { id: 'draft-ietf-oauth-browser-based-apps', title: 'OAuth 2.0 for Browser-Based Apps: the BFF pattern', kind: 'emerging' }],
  },
  {
    form: `POST ${AIC}/access_token\n  Authorization: Basic <agent:redacted>\n  grant_type=client_credentials&scope=repair`,
    tokens: [{ note: 'Actor access token · opaque; claims as AIC introspection reports them', claims: ACTOR_INTROSPECT }],
    refs: [RFC(6749, 'Client credentials grant (section 4.4) with HTTP Basic client authentication (section 2.3.1)'), CREDS[4]],
  },
  {
    form: `POST ${AIC}/introspect\n  Authorization: Basic <agent:redacted>\n  token=<access token>`,
    tokens: [
      { note: 'User token, introspected by the agent client · default answer: a client can only read its own tokens', claims: INACTIVE },
      { note: 'User token, introspected with am-introspect-all-tokens granted to the agent client · shows the may_act claim AIC will check', claims: USER_INTROSPECT },
    ],
    refs: INTROSPECT.slice(0, 1).concat(EXCHANGE.slice(0, 1)),
  },
  {
    form: 'POST /api/aic-demo/exchange\n  Cookie: sid=<BFF session>\n  (no body: the BFF already holds the user token and the actor token)',
    refs: BROWSER_BFF,
  },
  {
    form: `POST ${AIC}/access_token\n  Authorization: Basic <agent:redacted>\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<actor token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &requested_token_type=urn:ietf:params:oauth:token-type:access_token&scope=repair`,
    tokens: [
      { note: 'Subject token · the user token (decoded here as if introspected with am-introspect-all-tokens); may_act names the agent client', claims: USER_INTROSPECT },
      { note: 'Actor token · the agent identity', claims: ACTOR_INTROSPECT },
    ],
    refs: [EXCHANGE[0], RFC(6749, 'Client authentication (section 2.3.1): the agent client signs in with HTTP Basic'), EXCHANGE[2], EXCHANGE[3]],
  },
  {
    form: 'HTTP/1.1 200 OK\n{ "access_token": "<delegated token>",\n  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",\n  "token_type": "Bearer", "scope": "repair", "expires_in": 3600 }',
    tokens: [{ note: 'Delegated access token · opaque; claims as AIC introspection reports them', claims: DELEGATED_INTROSPECT }],
    refs: [EXCHANGE[0], BEARER[0], EXCHANGE[2]],
  },
  {
    form: `POST ${AIC}/introspect\n  Authorization: Basic <agent:redacted>\n  token=<delegated token>\n(response)\n{ "active": true, "sub": "alice", "act": { "sub": "agent" }, ... }`,
    tokens: [{ note: 'Delegated token, introspected · the act claim names who is acting for the user', claims: DELEGATED_INTROSPECT }],
    refs: [...INTROSPECT.slice(0, 1), ...EXCHANGE.slice(0, 1)],
  },
];
