// The 12 steps of "how a chat client (ChatGPT, Claude) gets access to a protected MCP server", derived from what the
// BFF actually recorded (routes/privilegeMcpClient.js /connector/*). A step with no evidence stays 'pending' — the
// list never marks a step done on the strength of the script alone.

const short = (value, n = 64) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > n ? `${text.slice(0, n)}…` : text || '';
};

export const STEP_TITLES = [
  'Protected tool request',
  'Discover protected resource',
  'Discover OAuth configuration',
  'Begin browser authorization',
  'Retrieve client metadata (CIMD)',
  'Sign in and consent at the identity service',
  'Authorization-code exchange',
  'Verify client and issue token',
  'Gateway validates access token',
  'Fine-grained policy decision',
  'Call the downstream API',
  'Return authorized result',
];

const status = (done, error) => (error ? 'error' : done ? 'done' : 'pending');

/**
 * @param {{trace?: object, token?: object|null, cimdDoc?: object|null, signedIn?: boolean, call?: object|null}} input
 *   call = { ok, status, body } of the tools/call made with the bearer token, or null before it ran.
 * @returns {{n:number,title:string,status:'pending'|'done'|'error',summary:string,detail:any}[]}
 */
export function buildConnectorSteps({ trace = {}, token = null, cimdDoc = null, signedIn = false, call = null } = {}) {
  const { challenge, resource, as, authorize, token: tokenStep } = trace;
  const challenged = challenge?.response?.status === 401 || Boolean(challenge?.response?.wwwAuthenticate);
  const asBody = as?.response?.body && typeof as.response.body === 'object' ? as.response.body : null;
  const resBody = resource?.response?.body && typeof resource.response.body === 'object' ? resource.response.body : null;
  const cimd = authorize?.clientIdentity === 'cimd';
  const decision = call ? (call.ok ? 'Permit' : `Deny (${call.status})`) : '';

  const steps = [
    {
      detail: challenge ? { request: challenge.request, response: challenge.response } : null,
      done: Boolean(challenge?.response?.status), error: challenge?.response?.error,
      summary: challenge ? (challenged ? `${challenge.response.status} challenge, no token sent` : `${challenge.response.status ?? 'no answer'} - this door did not ask for a token`) : '',
    },
    {
      detail: resource ? { request: resource.request, response: resource.response } : null,
      done: resource?.response?.status === 200, error: resource?.response?.error,
      summary: resBody ? `resource ${short(resBody.resource || '', 48)}, scopes ${short((resBody.scopes_supported || []).join(' ') || 'not listed', 48)}` : '',
    },
    {
      detail: as ? { request: as.request, response: as.response } : null,
      done: as?.response?.status === 200, error: as?.response?.error,
      summary: asBody ? `PKCE ${(asBody.code_challenge_methods_supported || []).join(',') || 'n/a'} · CIMD ${asBody.client_id_metadata_document_supported ? 'supported' : 'not advertised'}` : '',
    },
    {
      detail: authorize || null, done: Boolean(authorize),
      summary: authorize ? `browser opened ${new URL(authorize.endpoint).pathname} with a PKCE S256 challenge` : '',
    },
    {
      detail: cimdDoc || (authorize ? { client_id: authorize.params?.client_id, note: cimd ? 'Document not readable from here' : 'This sign-in registered the client dynamically (DCR) instead of using a client document' } : null),
      done: Boolean(cimdDoc), error: false,
      summary: cimdDoc ? `client ${short(cimdDoc.client_name || cimdDoc.client_id, 56)}` : authorize ? (cimd ? 'client_id is the URL of the client document' : 'DCR in use - no client document') : '',
    },
    {
      detail: signedIn ? { granted_scope: token?.scope || tokenStep?.response?.scope || '', note: 'Credentials and the consent screen stay between the browser and the identity service; the granted scope below is the recorded outcome.' } : null,
      done: signedIn,
      summary: signedIn ? `approved - scope ${short(token?.scope || tokenStep?.response?.scope || 'as requested', 48)}` : '',
    },
    {
      detail: tokenStep ? { endpoint: tokenStep.endpoint, request: tokenStep.request } : null, done: Boolean(tokenStep),
      summary: tokenStep ? `POST token endpoint, client auth: ${tokenStep.request.client_authentication}` : '',
    },
    {
      detail: tokenStep ? { response: tokenStep.response, token: token ? { kind: token.kind, scope: token.scope, expiresAt: token.expiresAt } : null } : null,
      done: Boolean(token),
      summary: token ? `${token.kind} access token, ${tokenStep?.response?.expires_in ? `${tokenStep.response.expires_in}s` : 'no stated expiry'}` : '',
    },
    {
      detail: call ? { request: 'tools/call with Authorization: Bearer <token>', response_status: call.status } : null,
      done: Boolean(call) && call.status !== 401, error: call?.status === 401,
      summary: call ? (call.status === 401 ? 'token refused' : 'token accepted') : '',
    },
    {
      detail: call ? { decision, body: call.body } : null, done: Boolean(call) && call.status !== 401, error: Boolean(call) && call.status !== 401 && !call.ok,
      summary: decision,
    },
    {
      detail: call?.ok ? { note: 'Only a Permit lets the gateway reach the downstream API; a Deny stops here.' } : null, done: Boolean(call?.ok),
      summary: call?.ok ? 'downstream called' : call ? 'not called' : '',
    },
    {
      detail: call?.ok ? call.body : null, done: Boolean(call?.ok),
      summary: call?.ok ? 'authorized result returned to the client' : '',
    },
  ];

  return steps.map((step, i) => ({ n: i + 1, title: STEP_TITLES[i], status: status(step.done, step.error), summary: step.summary, detail: step.detail }));
}
