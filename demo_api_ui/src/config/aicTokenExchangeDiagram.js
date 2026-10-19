// demo_api_ui/src/config/aicTokenExchangeDiagram.js
//
// The three AIC calls behind /aic-token-exchange. Mirrors
// demo_api_server/services/aicDemoService.js (beginLogin/completeLogin,
// fetchActorToken, exchangeTokens, introspectStep) and routes/aicDemo.js.
// Embedded directly (not a demo step).
import { AIC_STEP_DETAIL } from './aicTokenExchangeStandards';
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const OK = { dashed: true }; // token or decision coming back

export const AIC_EXCHANGE_GROUPS = {
  user: { label: 'Browser', bg: '#5a5f69' },
  app: { label: 'Demo BFF', bg: '#151a24' },
  idp: { label: 'PingOne AIC', bg: '#b5231a' },
};

export const AIC_EXCHANGE_NODES = [
  N('browser', 'user', 'Browser', ['Sign in at AIC, then the', 'Get actor / Exchange buttons;', 'never sees a token'], 0, 200),
  N('bff', 'app', 'Demo BFF', ['holds user, actor and delegated', 'tokens in the session; shows', 'a redacted protocol trace'], 400, 200),
  N('authorize', 'idp', 'AIC authorize + token', ['authorization code + PKCE (S256)', 'for the user; client_credentials', 'for the agent'], 800, 0),
  N('exchange', 'idp', 'AIC token exchange', ['RFC 8693: subject = user token,', 'actor = agent token, caller', 'authenticates as the agent client'], 800, 400),
  N('introspect', 'idp', 'AIC introspection', ['opaque tokens: ask AIC what', 'each carries (may_act, act)'], 1200, 200),
];

export const AIC_EXCHANGE_EDGES = [
  E('browser', 'authorize', 'redirect via /login/start: authorize request'), // 0
  E('authorize', 'bff', 'one-time code to /callback; BFF redeems it with the PKCE verifier = user token', OK), // 1
  E('browser', 'bff', 'POST /actor-token'), // 2
  E('bff', 'authorize', 'client_credentials as the agent client = actor token', OK), // 3
  E('bff', 'introspect', 'introspect each token the agent client may read'), // 4
  E('browser', 'bff', 'POST /exchange (needs both tokens)'), // 5
  E('bff', 'exchange', 'both tokens + actor client auth'), // 6
  E('exchange', 'bff', 'delegated token; may_act checked before issue', OK), // 7
  E('introspect', 'bff', 'act claim: who is acting for the user', OK), // 8
];

// One STEP per arrow so each carries its own detail (the step number equals the arrow badge).
const S = (key, edge, title, what, why) => ({ key, edges: [edge], title, what, why, detail: AIC_STEP_DETAIL[edge] });
export const AIC_EXCHANGE_STEPS = [
  S('authorize', 0, 'Sign in at AIC', 'The browser is sent to AIC to sign in directly, with authorization code and PKCE.', 'AIC only exchanges tokens it issued itself, so the app\'s normal PingOne login cannot serve as the subject token.'),
  S('user', 1, 'User token', 'AIC returns a one-time code; the BFF redeems it with the PKCE verifier and keeps the user token. The browser never sees a token.', 'This is the subject token of the exchange.'),
  S('actor-ask', 2, 'Ask for the agent token', 'The browser asks the BFF to get an actor token.', 'Tokens stay server-side; the browser only triggers the call.'),
  S('actor', 3, 'Actor token', 'The agent authenticates as its own confidential client with client_credentials.', 'The exchange needs a second identity: the agent acting for the user.'),
  S('introspect', 4, 'Opaque tokens are introspected', 'AIC access tokens are opaque by default, so the BFF asks AIC what a token carries. A client can introspect only its own tokens.', 'This is how the page shows claims such as may_act and act at all.'),
  S('exchange-ask', 5, 'Ask for the exchange', 'The browser asks the BFF to exchange the pair; it needs both tokens.', 'The button stays disabled until both tokens are held.'),
  S('exchange', 6, 'Exchange the pair', 'The BFF posts the RFC 8693 exchange as the agent client with the user token as subject and the agent token as actor.', 'AIC checks may_act before issuing anything.'),
  S('delegated', 7, 'Delegated token issued', 'AIC returns the delegated token to the BFF.', 'It belongs to the agent client and records who is acting for the user.'),
  S('act', 8, 'Read the act claim', 'Introspecting the delegated token shows the act claim.', 'The act claim is the proof of who is acting for the user.'),
];
