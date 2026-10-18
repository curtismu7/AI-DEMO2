'use strict';

const {
  loadHostedAccessPolicy,
  hasCurrentHostedAccessApproval,
} = require('../services/hostedAccessPolicy');
const { logger, LOG_CATEGORIES } = require('../utils/logger');

const EXACT_BYPASSES = new Set([
  'GET /api/auth/hosted-access/login',
  // Sign-in modal reads the plus-addressing policy before opening the flow.
  'GET /api/auth/hosted-access/identifier-policy',
  'GET /api/auth/hosted-access/callback',
  'GET /api/auth/hosted-access/logout',
  'POST /api/auth/hosted-registration/request',
  'POST /api/auth/hosted-registration/verify',
  'POST /api/auth/hosted-registration/resend',
  'GET /api/auth/hosted-registration/status',
  'GET /api/healthz',
  // The UI's boot health overlay polls this from signed-out pages too; it
  // carries no secrets (service up/down booleans only). Without the bypass
  // the overlay can never clear on SE — the 302 to login reads as a dead API.
  'GET /api/health/demo-status',
  // OBO demo MCP endpoint: the first, token-less POST must reach the route so it can return the
  // RFC 9728 OAuth challenge. Without this the wall answers a bare hosted_access_required and Claude
  // cannot discover PingOne. Authenticated calls are validated by the route itself.
  'POST /api/obo/mcp',
  // RFC 9728 metadata the challenge points at; must be fetchable before any sign-in.
  'GET /api/obo/mcp/oauth-protected-resource',
  // ID-JAG trusted-IdP registry: oauth-mcp and the PingFederate sync script read these
  // server-to-server with no session. Issuers, JWKS URLs and client ids only, no secrets.
  'GET /api/id-jag-playground/trusted-idps/registry',
  'GET /api/id-jag-playground/trusted-idps/pingfederate',
  // Static boot assets the signed-out shell loads: the auth-loading spinner's
  // Ping mark (PingIdentitySpinner) and the tab icons. Gating these 302s the
  // <img> requests to login — broken ping icon + favicon exactly when the
  // spinner is on screen. Brand assets, no secrets (mirrors se-ingress.yaml).
  'GET /branding/ping-logo.png',
  'GET /favicon-16.png',
  'GET /favicon-32.png',
  'GET /apple-touch-icon.png',
  // CIMD client documents Privilege fetches anonymously (mirrors se-ingress.yaml).
  'GET /api/cimd/privilege/super-banking-ai-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-investment-advisor-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-records-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-purchase-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-membership-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-payroll-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-tax-records-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-financial-aid-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-supplier-contract-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-holdings-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-passenger-records-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-fraud-watch-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-balance-sweep-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-agent/client-metadata.json',
  'GET /api/cimd/privilege/super-banking-identity-verification-specialist-agent/client-metadata.json',
  'GET /api/cimd/privilege/langchain-agent/client-metadata.json',
  'GET /api/cimd/privilege/demo-agent-service/client-metadata.json',
  'GET /api/cimd/privilege/privilege-mcp-client/client-metadata.json',
]);

// These are the two pre-existing demo identities used to administer and
// demonstrate the app. They still require their normal application login;
// this only prevents the hosted front-door gate from locking them out while
// the hosted registration flow is being tested.
const BOOTSTRAP_APPLICATION_USERNAMES = new Set(['demouser', 'demoadmin']);

function pathname(value) {
  return String(value || '').split('?')[0];
}

function isHostedAccessBypassPath(path, method) {
  return EXACT_BYPASSES.has(`${String(method || 'GET').toUpperCase()} ${pathname(path)}`);
}

function isBootstrapApplicationSession(session) {
  const username = session?.user?.username;
  const token = session?.oauthTokens?.accessToken;
  const hasRealOAuthToken = typeof token === 'string'
    && token.trim().length > 0
    && token !== '_cookie_session';
  const expiresAt = session?.oauthTokens?.expiresAt;
  const tokenNotExpired = !expiresAt || Date.now() < expiresAt;
  const authenticatedOAuthType = session?.oauthType === 'user' || session?.oauthType === 'admin';
  return typeof username === 'string'
    && BOOTSTRAP_APPLICATION_USERNAMES.has(username.trim().toLowerCase())
    && hasRealOAuthToken
    && tokenNotExpired
    && authenticatedOAuthType;
}

function sendAccessRestricted(res) {
  res.status(403);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html');
  return res.send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access restricted</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#071426;color:#fff;font:600 18px/1.5 system-ui,sans-serif}main{max-width:36rem;padding:2rem;border:1px solid #fff;border-radius:.75rem}</style></head><body><main>Access restricted to authorized Ping employees.</main></body></html>');
}

// Requests carrying an Authorization Bearer are service-to-server API calls
// (mcp-server's vertical-tool callback, /api/accounts/my data fetches —
// every BankingAPIClient endpoint), not front-door browser traffic. They
// have no hosted-access cookie by construction, and authenticateToken runs
// immediately after this gate to validate the token, so a forged Bearer
// gains nothing. Bearer-pass used to be free — the wall existed only at the
// ingress until 2026-10-12 (PR #1191) mounted it here too, which started
// 401-ing every in-cluster callback under every vertical tool call
// (UC1's list_gear → POST /api/path/vertical-tool → hosted_access_required
// → "Run failed", observed live 2026-10-13).
function hasBearerToken(req) {
  const header = req.headers?.authorization;
  return typeof header === 'string' && /^bearer\s+\S+/i.test(header);
}

function createHostedAccessGate({
  policy = loadHostedAccessPolicy(),
  hasApproval = hasCurrentHostedAccessApproval,
} = {}) {
  return function hostedAccessGate(req, res, next) {
    if (!policy.enabled || isHostedAccessBypassPath(req.originalUrl || req.url, req.method)) return next();
    if (hasBearerToken(req)) return next();
    if (hasApproval(req.hostedSession, policy) || isBootstrapApplicationSession(req.session)) return next();
    // Why-was-I-walled breadcrumb: no_approval = never signed in / cookie gone
    // (or store lost it); approval_stale = had one, but it no longer validates
    // (subject mismatch, removed from the allowlist, or group/verified-email rule changed).
    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'hosted-access gate 401', {
      reason: req.hostedSession?.hostedAccessApproval ? 'approval_stale' : 'no_approval',
      method: req.method,
      path: pathname(req.originalUrl || req.url),
    });
    // A browser opening a gated /api URL directly (stale tab, bookmark, rollout
    // that rotated the session) gets bounced to sign-in, not raw JSON. fetch()
    // calls don't ask for text/html, so the SPA keeps its 401 + nudge.
    if (req.method === 'GET' && /\btext\/html\b/.test(req.headers?.accept || '')) {
      return res.redirect(`/api/auth/hosted-access/login?return_to=${encodeURIComponent(pathname(req.originalUrl || req.url))}`);
    }
    return res.status(401).send({ error: 'hosted_access_required' });
  };
}

function hostedAccessCheck({
  policy = loadHostedAccessPolicy(),
  hasApproval = hasCurrentHostedAccessApproval,
} = {}) {
  return function check(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!policy.enabled || hasApproval(req.hostedSession, policy) || isBootstrapApplicationSession(req.session)) return res.status(204).end();
    return res.status(401).end();
  };
}

module.exports = {
  createHostedAccessGate,
  hostedAccessCheck,
  isHostedAccessBypassPath,
  isBootstrapApplicationSession,
  sendAccessRestricted,
};
