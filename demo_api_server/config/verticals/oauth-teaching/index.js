'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const tokenDisplayService = require('../../../services/tokenDisplayService');
const { executeBffTool } = require('../../../services/bffMcpToolExecutor');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

// topic regex -> { text, panel(EDU string value), tab, rfc, code }. Panel strings
// mirror educationIds.js. `rfc` is always rendered when present ("Spec: ..."), and
// `code` is a real snippet from THIS app appended as an extra so learners can read
// the live implementation. Order matters: CONCEPTS.find takes the first match, so
// the broad OAuth-overview catch-all must stay LAST.
const CONCEPTS = [
  { re: /token\s*exchange|rfc\s*8693/i, panel: 'token-exchange',
    text: 'Token exchange swaps a subject token for a new token scoped to a downstream audience, optionally recording the actor in an `act` claim. The subject (`sub`) is preserved; the `aud` is narrowed.',
    rfc: 'RFC 8693 (OAuth 2.0 Token Exchange) — §2.1 request, §4.1 act claim',
    code: { file: 'demo_api_server/services/agentMcpTokenService.js',
      snippet: "grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',\naudience: mcpResourceUri,            // narrowed audience\nscope: (finalScopes || []).join(' '), // least-privilege scopes\nhasActorToken: !!(actorToken),        // records the agent in `act`" } },
  { re: /pkce|auth(orization)?\s*code/i, panel: 'login-flow', tab: 'pkce',
    text: 'Authorization Code + PKCE protects the code exchange with a per-request code_verifier/code_challenge so an intercepted code is useless without the verifier. OAuth 2.1 makes PKCE mandatory for all clients.',
    rfc: 'RFC 6749 §4.1 (Authorization Code) + RFC 7636 (PKCE)',
    code: { file: 'demo_api_server/routes/oauth.js',
      snippet: "// authorization request carries the hashed verifier:\npkce: { code_challenge_method: 'S256', ... }\n// the callback then exchanges code + code_verifier for tokens" } },
  { re: /scope|least\s*privilege/i, panel: 'sensitive-data',
    text: 'Scopes bound what an access token may do. Least privilege means requesting only the scopes a call needs; the resource server enforces them.',
    rfc: 'RFC 6749 §3.3 (Access Token Scope)',
    code: { file: 'demo_api_server/middleware/auth.js',
      snippet: "const requireScopes = (requiredScopes, requireAll = false) => {\n  return (req, res, next) => {\n    // rejects any token that does not carry the required scopes\n  };\n};" } },
  { re: /may_?act|act\s*claim|delegat/i, panel: 'may-act',
    text: '`may_act` (in the subject token) prospectively authorizes a downstream actor; `act` (in the exchanged token) records who is acting. Together they make the delegation chain auditable.',
    rfc: 'RFC 8693 §4.1 (act) and §4.4 (may_act)',
    code: { file: 'demo_api_server/services/agentMcpTokenService.js',
      snippet: "if (claims.may_act) result.may_act = claims.may_act; // delegation carried through the exchange" } },
  { re: /introspect/i, panel: 'introspection',
    text: 'Token introspection lets a resource server ask the issuer whether a token is active and what claims it carries — useful when local signature validation is not possible.',
    rfc: 'RFC 7662 (OAuth 2.0 Token Introspection)',
    code: { file: 'demo_api_server/services/clientCredentialsTokenService.js',
      snippet: '// Token introspection endpoint (RFC 7662) — POSTs the token to\n// PingOne /as/introspect and reads back { active, scope, aud, ... }' } },
  { re: /refresh\s*token/i, panel: 'rfc-index',
    text: 'A refresh token is a long-lived credential the client uses to obtain new access tokens without re-authenticating the user. OAuth 2.1 requires rotation or sender-constraining for public clients. PingOne only issues one when the client requests the offline_access scope.',
    rfc: 'RFC 6749 §6 (Refreshing an Access Token); OAuth 2.1 draft (refresh token rotation)',
    code: { file: 'demo_api_server/routes/oauthUser.js',
      snippet: "refreshToken: tokenData.refresh_token, // present only when offline_access was granted" } },
  { re: /client\s*credentials|machine.to.machine|\bm2m\b|worker\s*app/i, panel: 'rfc-index',
    text: 'The client credentials grant authenticates the application itself — no user involved. The client trades its own id/secret for an access token, used here by PingOne Worker apps for management API calls.',
    rfc: 'RFC 6749 §4.4 (Client Credentials Grant)',
    code: { file: 'demo_api_server/services/pingOneClientService.js',
      snippet: "grant_type: 'client_credentials' // worker app authenticates as itself to mint a management token" } },
  { re: /oidc|openid|id\s*token/i, panel: 'oidc-21',
    text: 'OpenID Connect layers identity on OAuth 2.0: the ID token (a JWT) asserts who authenticated — it is for the client, never sent to APIs — while the access token authorizes API calls at the resource server.',
    rfc: 'OpenID Connect Core 1.0 (ID Token); RFC 6749 (access token)',
    code: { file: 'demo_api_server/routes/oauth.js',
      snippet: "idTokenClaims: { sub, email, acr } // identity read from the ID token\n// the access token (aud: enduser.ping.demo) is what API calls present" } },
  { re: /hitl|human.in.the.loop|consent|approval/i, panel: 'human-in-loop',
    text: 'Human-in-the-loop gates a sensitive action behind explicit user approval; the authorization decision can require a verified consent receipt before it PERMITs. There is no single RFC — it is an authorization-policy pattern (this app implements it with PingOne Authorize challenges).',
    code: { file: 'demo_api_server/services/transactionConsentChallenge.js',
      snippet: '// over-threshold transfer -> 428 challenge; the approval receipt\n// is verified by the policy before the retried call PERMITs' } },
  { re: /step.?up|mfa/i, panel: 'step-up',
    text: 'Step-up authentication forces stronger auth (e.g. MFA) for a higher-risk action, typically driven by an `acr_values` request to the authorization server.',
    rfc: 'RFC 9470 (OAuth 2.0 Step-up Authentication Challenge); acr/acr_values from OpenID Connect Core 1.0',
    code: { file: 'demo_api_server/routes/ciba.js',
      snippet: "acr_values: 'Multi_factor' // asks PingOne for a step-up (MFA) authentication" } },
  { re: /token\s*chain/i, panel: 'token-chain',
    text: 'The token chain visualizes every hop a request takes — each exchange, its audience, scopes, and the act/may_act delegation — so you can see exactly which token reaches which service.',
    rfc: 'RFC 8693 (each hop is a token exchange); RFC 8707 (resource indicators narrow the audience)' },
  { re: /confused.?deputy|ambient.?authority/i, panel: 'sensitive-data',
    text: 'The confused deputy problem occurs when an AI agent is tricked into using its own privileged token to act on behalf of an attacker instead of the legitimate user. OAuth mitigates this with explicit delegation: `act`/`may_act` claims make the delegation chain auditable, audience-narrowing limits which services a token reaches, and least-privilege scopes bound what the agent can do even if manipulated.',
    rfc: 'RFC 8693 §4 (delegation claims); RFC 8707 (Resource Indicators)' },
  // Broad catch-all — keep LAST so specific concepts above win first match.
  { re: /\boauth\b|\boidc\b/i, panel: 'rfc-index',
    text: 'OAuth 2.0 is a delegation framework: a user (resource owner) authorizes a client to call a resource server using an access token issued by an authorization server — the user never shares their password with the client. OAuth 2.1 consolidates current best practice: PKCE everywhere, no implicit or password grants, exact redirect URIs. OpenID Connect adds the identity layer (ID tokens) on top.',
    rfc: 'RFC 6749 (OAuth 2.0); OAuth 2.1 draft; OpenID Connect Core 1.0',
    code: { file: 'demo_api_server/routes/oauth.js',
      snippet: '// this app runs the full flow: authorization code + PKCE login,\n// RFC 8693 token exchange for the agent, scopes enforced per call' } },
];

const VALID_PANELS = new Set([
  'login-flow', 'token-exchange', 'may-act', 'introspection', 'rfc-index', 'step-up',
  'human-in-loop', 'oidc-21', 'sensitive-data', 'token-chain', 'rfc-8693', 'flow-diagrams', 'token-flow',
]);

const FLOWS = {
  'auth code': 'login-flow', 'authorization code': 'login-flow', 'pkce': 'login-flow', login: 'login-flow',
  'token exchange': 'token-flow', exchange: 'token-flow', 'token chain': 'token-chain', chain: 'token-chain',
};

const LOCAL_TOOLS = new Set([
  'explain_concept', 'open_education_panel', 'show_flow_diagram', 'inspect_token',
  'demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl',
  'api_key_demo', 'dual_token_demo',
]);

// P4 DEMONSTRATE — real-pipeline teaching tools.
// $300 sits in the plain-consent HITL band on the MCP authz path (>= confirm $250, < step-up $500).
const DEMO_TRANSFER_AMOUNT = 300;
// A regular demo user's token does not carry invest:read, so this tool reliably denies.
const SCOPE_DENIAL_TOOL = 'get_investment_balance';

const TOOLS = [
  { name: 'explain_concept', description: 'Explain an OAuth/OIDC concept and open the matching education panel',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } },
  { name: 'open_education_panel', description: 'Open a specific education panel by id',
    inputSchema: { type: 'object', properties: { edu_id: { type: 'string' }, tab: { type: 'string' } }, required: ['edu_id'] } },
  { name: 'show_flow_diagram', description: 'Open the diagram for an OAuth/OIDC flow',
    inputSchema: { type: 'object', properties: { flow: { type: 'string' } }, required: ['flow'] } },
  { name: 'inspect_token', description: 'Decode the session token and the exchanged token side by side',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'demonstrate_token_exchange', description: 'Run a real RFC 8693 token exchange against the banking pipeline and narrate every hop',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'demonstrate_scope_denial', description: 'Attempt a banking call the delegated token is not scoped for and show the real denial',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'demonstrate_hitl', description: 'Run a real over-threshold transfer to trigger human-in-the-loop approval',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  // P1 stubs (still scaffolded — declared so the shared EDUCATION_HEURISTICS actions resolve to a tool).
  { name: 'api_key_demo', description: 'Demo the API-key access path (not yet implemented)',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'dual_token_demo', description: 'Demo the access + ID token path (not yet implemented)',
    inputSchema: { type: 'object', properties: {}, required: [] } },
];

const HEURISTICS = [
  { re: /\bdemo(nstrate)?\b.*\b(hitl|human|approval|consent|transfer)\b/i, action: 'demonstrate_hitl' },
  { re: /\bdemo(nstrate)?\b.*\b(deny|denial|denied|scope|least.?privilege|forbidden|insufficient)\b/i, action: 'demonstrate_scope_denial' },
  { re: /\bdemo(nstrate)?\b.*\b(exchange|rfc\s*8693|real\s+token|token\s+exchange)\b/i, action: 'demonstrate_token_exchange' },
  { re: /\b(inspect|decode|show\s+me|view)\b.*\btoken(s)?\b/i, action: 'inspect_token' },
  { re: /\b(show|draw|diagram|visuali[sz]e)\b.*\b(flow|auth(orization)?\s*code|pkce|exchange|chain)\b/i, action: 'show_flow_diagram' },
  { re: /\b(what\s+is|explain|how\s+does|tell\s+me\s+about)\b/i, action: 'explain_concept', extractsTopic: true },
];

function getManifest() { return verticalManifest.resolver.resolve('oauth-teaching'); }

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'learner';
  return [
    'You are the OAuth Academy teacher — an expert in OAuth 2.0, OAuth 2.1, and OIDC.',
    'Teach these protocols clearly: explain concepts, cite RFCs, and open the relevant panel.',
    `The signed-in user role is "${role}".`,
    'Use teaching language: tokens instead of accounts, flows instead of transactions.',
    'Always name the governing RFC (number and section) when one exists — e.g. RFC 6749, RFC 7636 (PKCE), RFC 8693 (token exchange), RFC 7662 (introspection), RFC 9470 (step-up), RFC 8707 (resource indicators), OpenID Connect Core 1.0.',
    'When this demo app implements the concept, point the learner at the real implementation file so they can read live code.',
    'Keep answers concise and precise.',
    'Never use banking or healthcare terminology. You are exclusively an OAuth/OIDC teacher.',
  ].join(' ');
}

function explainConcept(params) {
  const topic = String((params && params.topic) || '').trim();
  const hit = CONCEPTS.find((c) => c.re.test(topic));
  if (!hit) {
    return { result: { text: 'I can explain: OAuth 2.0/2.1, the authorization code flow + PKCE, ID token vs access token (OIDC), scopes & least privilege, refresh tokens, the client credentials grant, token exchange (RFC 8693), may_act / act delegation, introspection (RFC 7662), step-up auth (RFC 9470), HITL approval, the token chain, and the confused deputy attack. Which one?' }, render: 'text' };
  }
  // Compose: concept text, then the governing spec (always shown when one
  // exists), then a real snippet from this app as an extra learning aid.
  const parts = [hit.text];
  if (hit.rfc) parts.push(`Spec: ${hit.rfc}`);
  if (hit.code) parts.push(`How this app implements it — ${hit.code.file}:\n\`\`\`\n${hit.code.snippet}\n\`\`\``);
  return { result: { text: parts.join('\n\n'), education: { panel: hit.panel, tab: hit.tab || null } }, render: 'text' };
}

function openEducationPanel(params) {
  const id = String((params && params.edu_id) || '').trim();
  if (!VALID_PANELS.has(id)) {
    return { result: { text: `I don't have a panel called "${id}". Try: ${Array.from(VALID_PANELS).join(', ')}.` }, render: 'text' };
  }
  return { result: { text: `Opening the ${id} panel.`, education: { panel: id, tab: (params && params.tab) || null } }, render: 'text' };
}

function showFlowDiagram(params) {
  const flow = String((params && params.flow) || '').toLowerCase().trim();
  const key = Object.keys(FLOWS).find((k) => flow.includes(k));
  const panel = key ? FLOWS[key] : 'flow-diagrams';
  return { result: { text: `Here's the ${key || 'OAuth'} flow diagram.`, education: { panel, tab: null } }, render: 'text' };
}

// Run a banking tool through the REAL pipeline and return the parsed result object.
// executeBffTool returns a JSON string; errors are encoded in-band as { error, ... }.
async function runBankingTool(ctx, name, args) {
  const raw = await executeBffTool({
    name,
    args: args || {},
    userId: ctx.userId,
    userToken: ctx.userToken,
    req: ctx.req,
    tokenEvents: ctx.tokenEvents,
    sessionId: ctx.sessionId,
  });
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { return { error: 'unparseable_result' }; }
}

// Extract the accounts array from a get_my_accounts result, handling every shape
// the pipeline can return: a plain { accounts }, a { result: { accounts } }, or the
// MCP content envelope { content: [{ type:'text', text:'{"accounts":[...]}' }] } that
// executeBffTool surfaces for banking tools. Without the envelope branch the HITL
// demo always sees 0 accounts and bails before raising the challenge.
function extractAccounts(res) {
  if (!res || typeof res !== 'object') return [];
  if (Array.isArray(res.accounts)) return res.accounts;
  if (res.result && Array.isArray(res.result.accounts)) return res.result.accounts;
  const text = Array.isArray(res.content) ? res.content[0]?.text : undefined;
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.accounts)) return parsed.accounts;
    } catch (_) { /* not JSON — fall through */ }
  }
  return [];
}

async function demonstrateTokenExchange(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can run a real token exchange and show every hop.' }, render: 'text' };
  }
  const res = await runBankingTool(ctx, 'get_my_accounts', {});
  if (res && res.error) {
    return { result: { text: `The exchange path returned an error (${res.error}). The Token Chain shows how far the request got.` }, render: 'text' };
  }
  return { result: { text: 'Done — I called the real banking tool get_my_accounts as the agent. That drove a genuine RFC 8693 exchange: your session token (T1, audience enduser) was swapped for a downstream-scoped agent token (T2, narrowed audience plus an act claim recording the agent), which the resource server accepted. Open the Token Chain to see each hop.' }, render: 'text' };
}

async function demonstrateScopeDenial(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can attempt a call your token is not scoped for and show the real denial.' }, render: 'text' };
  }
  const res = await runBankingTool(ctx, SCOPE_DENIAL_TOOL, {});
  if (res && res.error) {
    const missing = Array.isArray(res.required_scopes) ? res.required_scopes.join(', ')
      : (Array.isArray(res.missingScopes) ? res.missingScopes.join(', ') : 'invest:read');
    return { result: { text: `Denied — exactly as least privilege intends. I called ${SCOPE_DENIAL_TOOL} as the agent, but the exchanged token does not carry the required scope (${missing}). The resource server refused with "${res.error}". The agent only ever receives the scopes your delegation grants, narrowed by the RFC 8693 exchange.` }, render: 'text' };
  }
  return { result: { text: `Unexpected — ${SCOPE_DENIAL_TOOL} was permitted, which means your token already carries the required scope. There is no denial to show this time; sign in as a user without investment access to see least privilege block the call.` }, render: 'text' };
}

async function demonstrateHitl(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can run a real over-threshold transfer and trigger human-in-the-loop approval.' }, render: 'text' };
  }
  const acctRes = await runBankingTool(ctx, 'get_my_accounts', {});
  const accounts = extractAccounts(acctRes);
  if (!Array.isArray(accounts) || accounts.length < 2) {
    return { result: { text: 'I could not find two of your accounts to move money between. Reload your dashboard so your demo accounts are seeded, then ask again.' }, render: 'text' };
  }
  const args = {
    from_account_id: accounts[0].id,
    to_account_id: accounts[1].id,
    amount: DEMO_TRANSFER_AMOUNT,
    description: 'OAuth Academy HITL demo',
  };
  // On the approve-retry the dispatch passes the approved challenge id in ctx; echo it
  // so the gateway/pipeline verifies the receipt and PERMITs instead of re-challenging.
  if (ctx.hitlChallengeId) args._hitl_challenge_id = ctx.hitlChallengeId;
  const res = await runBankingTool(ctx, 'create_transfer', args);
  if (res && res.error === 'mcp_hitl_required') {
    return { result: {
      text: `This $${DEMO_TRANSFER_AMOUNT} transfer is over the consent threshold, so PingOne Authorize returned a human-in-the-loop challenge before any money moved. Approve it and I will retry — your approval becomes a receipt the policy verifies (receipt-aware PERMIT).`,
      error: 'hitl_required',
      hitl: { type: 'consent' },
      hitlChallengeId: res.challengeId || res.taskId || null,
    }, render: 'text' };
  }
  if (res && res.error) {
    return { result: { text: `The transfer could not be completed (${res.error}).` }, render: 'text' };
  }
  return { result: { text: `Approved and executed — the $${DEMO_TRANSFER_AMOUNT} transfer went through. The policy verified your approval receipt and PERMITted the retry, so the money actually moved between your own demo accounts. Reset them any time from the dashboard.` }, render: 'text' };
}

async function executeTool(name, params, ctx) {
  switch (name) {
    case 'explain_concept': return explainConcept(params);
    case 'open_education_panel': return openEducationPanel(params);
    case 'show_flow_diagram': return showFlowDiagram(params);
    case 'inspect_token': return inspectToken(params, ctx); // Task 6
    case 'demonstrate_token_exchange':
      return demonstrateTokenExchange(params, ctx);
    case 'demonstrate_scope_denial': return demonstrateScopeDenial(params, ctx);
    case 'demonstrate_hitl': return demonstrateHitl(params, ctx);
    default:
      return { result: { text: `Teaching tool "${name}" is not implemented yet.` }, render: 'text' };
  }
}

function decodeForCard(token) {
  const d = tokenDisplayService.decodeToken(token);
  if (!d) return null;
  return { header: d.header, payload: d.payload, tokenType: tokenDisplayService.classifyTokenType(d.payload) };
}

// Mint+decode the exchanged token (T2) using the REAL production agent exchange path.
// resolveMcpAccessTokenWithEvents(req, tool, opts) returns { token, tokenEvents, need_auth };
// we decode `token` for display and merge its tokenEvents so the live Token Chain updates.
// Returns null (not an error) when no token can be minted, so T1 still renders.
async function getExchangedTokenDecoded(ctx) {
  try {
    const { resolveMcpAccessTokenWithEvents } = require('../../../services/agentMcpTokenService');
    if (!ctx || !ctx.req) return null;
    const ex = await resolveMcpAccessTokenWithEvents(ctx.req, 'inspect_token', {});
    if (!ex || !ex.token || ex.need_auth) return null;
    // Merge exchange events only on a SUCCESSFUL exchange (M1) — a failed/need_auth
    // attempt returns t2=null and renders T1 alone, so it must not pollute the live
    // Token Chain with a half-completed exchange.
    if (Array.isArray(ex.tokenEvents) && Array.isArray(ctx.tokenEvents)) {
      ctx.tokenEvents.push(...ex.tokenEvents);
    }
    return decodeForCard(ex.token);
  } catch (_e) {
    return null;
  }
}

async function inspectToken(params, ctx) {
  const userToken = ctx && ctx.userToken;
  if (!userToken) {
    return { result: { text: 'Please sign in first — then I can decode your token and show what the exchange changes.' }, render: 'text' };
  }
  const t1 = decodeForCard(userToken);
  if (!t1) {
    return { result: { text: "I couldn't decode the current token." }, render: 'text' };
  }
  const t2 = await getExchangedTokenDecoded(ctx); // null if exchange unavailable — T1 still renders
  return { result: { t1, t2 }, render: 'token_pair' };
}

module.exports = {
  getManifest,
  getTools: () => TOOLS,
  getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],
  getSystemPrompt,
  getDataStore: () => null,
  isLocalTool: (name) => LOCAL_TOOLS.has(name),
  executeTool,
  getAuthz: () => ({}),
};
