// demo_api_ui/src/config/aicTokenExchangeDiagram.js
//
// The three AIC calls behind /aic-token-exchange. Mirrors
// demo_api_server/services/aicDemoService.js (beginLogin/completeLogin,
// fetchActorToken, exchangeTokens, introspectStep) and routes/aicDemo.js.
// Embedded directly (not a demo step).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const OK = { color: 'var(--th-status-success)' };

export const AIC_EXCHANGE_GROUPS = {
  user: { label: 'Browser', bg: 'var(--th-status-info)' },
  app: { label: 'Demo BFF', bg: 'var(--th-bg-emphasis)' },
  idp: { label: 'PingOne AIC', bg: 'var(--th-status-warning)' },
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

export const AIC_EXCHANGE_STEPS = [
  { key: 'user', edges: [0, 1], title: 'User token', what: 'The person signs in directly at AIC with authorization code and PKCE. The BFF redeems the code; the browser never sees a token.', why: 'AIC only exchanges tokens it issued itself, so the app\'s normal PingOne login cannot serve as the subject token.' },
  { key: 'actor', edges: [2, 3], title: 'Actor token', what: 'The agent authenticates as its own confidential client with client_credentials.', why: 'The exchange needs a second identity: the agent acting for the user.' },
  { key: 'introspect', edges: [4], title: 'Opaque tokens are introspected', what: 'AIC access tokens are opaque by default, so the BFF asks AIC what a token carries. A client can introspect only its own tokens.', why: 'This is how the page shows claims such as may_act and act at all.' },
  { key: 'exchange', edges: [5, 6, 7, 8], title: 'Exchange the pair', what: 'With both tokens held, the BFF posts the RFC 8693 exchange as the agent client. AIC checks may_act before issuing; introspecting the result shows the act claim.', why: 'The delegated token records who is acting for the user.' },
];
