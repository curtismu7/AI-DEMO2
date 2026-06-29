// Sentry must be required before anything else so it can auto-instrument the app.
// No-op unless SENTRY_DSN is set (see instrument.js).
require('./instrument');

// Load environment variables — local dev: root .env takes precedence over demo_api_server/.env
const path = require('path');
require('dotenv').config({
    path: path.resolve(__dirname, '../.env'),
    override: false
});
require('dotenv').config({
    override: false
});

// Validate required env vars at startup — exits in production if any are missing
require('./scripts/check-env');

// Phase 269: vault loader — loads encrypted secrets into configStore at startup.
// Wired below at .listen() time so the cache is populated BEFORE the first request.
const { loadVaultIntoConfigStore } = require('./services/vaultLoader');
const { startScheduler: startLighthouseScheduler } = require('./services/lighthouseScheduler');

// ConfigStore must be required early so oauth config module getters are ready
const configStore = require('./services/configStore');
const appEventService = require('./services/appEventService');
const { scrubRawJwts } = require('./services/jwtScrubber');
const structuredLogger = require('./services/structuredLogger');
const {
    mcpNoBearerResponse
} = require('./services/bffSessionGating');
const { stampUseCaseId } = require('./services/useCaseTagging');
const { deriveUseCaseId } = require('./config/useCases');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');

const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_DEPLOYMENT;
const isProduction = process.env.NODE_ENV === 'production' || isReplit;

// Log deployment context on startup
if (isReplit) console.log('[platform] Replit deployment detected');
if (!isReplit && isProduction) console.log('[platform] Production deployment');

// Security guard: SKIP_TOKEN_SIGNATURE_VALIDATION must never be enabled in production.
// Validates at startup (before any request is served) so misconfigurations are caught early.
if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true' && isProduction) {
    console.error('[FATAL] SKIP_TOKEN_SIGNATURE_VALIDATION=true is not allowed in production. Remove this env var before deploying.');
    process.exit(1);
}

// Security guard: the global TLS-verification escape hatch must never be set in
// production. Per-call dev bypasses are individually gated on NODE_ENV (CR-04/BL-04);
// this catches the blunt Node-wide override before any request is served.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && isProduction) {
    console.error('[FATAL] NODE_TLS_REJECT_UNAUTHORIZED=0 disables all TLS verification and is not allowed in production. Remove this env var before deploying.');
    process.exit(1);
}

// ── Session store ──
/** 'lmdb' | 'memory' */
let sessionStoreType = 'memory';
let sessionStore;

// ── LMDB store (no native ABI dependency — works across all Node versions) ──
try {
    const { LmdbSessionStore } = require('./services/lmdb/sessionStore');
    sessionStore = new LmdbSessionStore({ ttl: 24 * 60 * 60 * 1000 });
    sessionStoreType = 'lmdb';
    console.log('[session-store] Using LMDB store — sessions persist across restarts without native ABI dependency');
} catch (err) {
    console.warn('[session-store] LMDB store init failed, falling back to memory store:', err.message);
}

// Demo: force a fresh token after every restart. LMDB persists sessions (and the
// stored access token) on disk, so without this a user keeps their pre-restart
// token. Wiping sessions on boot makes the next request re-authenticate (silently
// via PingOne SSO) and mint a brand-new token. Opt out with CLEAR_SESSIONS_ON_BOOT=false.
if (sessionStore && typeof sessionStore.clear === 'function' && process.env.NODE_ENV !== 'test' && process.env.CLEAR_SESSIONS_ON_BOOT !== 'false') {
    sessionStore.clear((clearErr) => {
        if (clearErr) console.warn('[session-store] boot clear failed:', clearErr.message);
        else console.log('[session-store] Cleared all persisted sessions on boot (CLEAR_SESSIONS_ON_BOOT) — users get a fresh token on next request');
    });
    // Also clear the SDK-demo LMDB token store — session ids are no longer valid
    // after the session store wipe so any retained token blobs are orphaned.
    try {
        require('./services/lmdb/sdkDemoTokenStore.lmdb').clearAll();
    } catch (sdkClearErr) {
        console.warn('[session-store] sdk-demo token store boot clear failed:', sdkClearErr.message);
    }
}

// Import routes
const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const oauthUserRoutes = require('./routes/oauthUser');
const oauthService = require('./services/oauthService');
const reportsRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const accountRoutes = require('./routes/accounts');
const sensitiveBankingRoutes = require('./routes/sensitiveBanking');
const transactionRoutes = require('./routes/transactions');
const demoScenarioRoutes = require('./routes/demoScenario');
const adminRoutes = require('./routes/admin');
const pingcliRoutes = require('./routes/pingcli');
const adminAgentToolsRoutes = require('./routes/adminAgentTools');
const adminAgentRoutes = require('./routes/adminAgentRoutes');
const adminConfigRoutes = require('./routes/adminConfig');
const adminManagementRoutes = require('./routes/adminManagement');
const cibaRoutes = require('./routes/ciba');
const mfaRoutes = require('./routes/mfa');
const recognizeRoutes = require('./routes/recognize');
const mfaTestRoutes = require('./routes/mfaTest');
const authorizeRoutes = require('./routes/authorize');
const authorizeConfigRoutes = require('./routes/authorizeConfig');
const setupRoutes = require('./routes/setup');
const setupWizardRoutes = require('./routes/setupWizard');
const diagramsRoutes = require('./routes/diagrams');
const archEventsRoutes = require('./routes/archEvents');
const devToolsRoutes = require('./routes/devTools');
const selfServiceUsersRoutes = require('./routes/selfServiceUsers');
const {
    router: featureFlagsRoutes
} = require('./routes/featureFlags');
const mcpInspectorRoutes = require('./routes/mcpInspector');
const mcpTrafficRoutes = require('./routes/mcpTraffic');
const mcpToolScopesRouter = require('./routes/mcpToolScopes');
const mcpGatewayConfigRouter = require('./routes/mcpGatewayConfig');
const mcpAuditRouter = require('./routes/mcpAudit');
const agentIdentityRoutes = require('./routes/agentIdentity');
const agentDelegationRoutes = require('./routes/agentDelegation');
const adminDemoUsersRoutes = require('./routes/adminDemoUsers');
const mcpDecisionPollingRoutes = require('./routes/mcpDecisionPolling');
const mcpExchangeModeRoutes = require('./routes/mcpExchangeMode');
const testTokenScenariosRoutes = require('./routes/testTokenScenarios');
const demoAgentRoutes = require('./routes/demoAgentRoutes');
const agentRunRoutes = require('./routes/agentRun');
const demoAgentNlRoutes = require('./routes/demoAgentNl');
const agentInvokeRoutes = require('./routes/agentInvokeRoute');
const intentAuthRoutes = require('./routes/intentAuthRoute');
const langchainConfigRoutes = require('./routes/langchainConfig');
const lmstudioRoutes = require('./routes/lmstudio');
const tokenRoutes = require('./routes/tokens');
const logsRoutes = require('./routes/logs');
const delegationRoutes = require('./routes/delegation');
const agentAuthorizationRoutes = require('./routes/agentAuthorization');
const tokenChainRoutes = require('./routes/tokenChain');
const {
    router: clientRegistrationRoutes,
    wellKnownHandler,
    hydrate: hydrateCimdStore
} = require('./routes/clientRegistration');
const protectedResourceMetadataRoutes = require('./routes/protectedResourceMetadata');
const introspectRoutes = require('./routes/introspect');
const migrationRoutes = require('./routes/migration');
const securityMonitoringRoutes = require('./routes/securityMonitoring');
const oauthClientsRoutes = require('./routes/oauthClients');
const oauthTokenRoutes = require('./routes/oauthToken');
const {
    getOAuthRedirectDebugInfo,
    getFrontendOrigin
} = require('./services/oauthRedirectUris');
const {
    restoreSessionFromCookie,
    clearAuthCookie,
    readAuthCookie
} = require('./services/authStateCookie');
const { clearAllAuthCookies } = require('./services/sessionCookies');
const {
    migrateAccounts
} = require('./services/demoDataService');
const appConfigRoutes = require('./routes/appConfig');
const configCredentialsRoutes = require('./routes/configCredentials');
const thresholdsRoutes = require('./routes/thresholds');
const verticalManifestRoutes = require('./routes/verticalManifest');
const pingoneAuditRoutes = require('./routes/pingoneAudit');
const pingoneTestRoutes = require('./routes/pingoneTestRoutes');
const pinggatewayTestRoutes = require('./routes/pinggatewayTestRoutes');
const pingoneSetupRoutes = require('./routes/pingoneSetup');
const tokenDisplayRoutes = require('./routes/tokenDisplay');
const apiCallTrackerRoutes = require('./routes/apiCallTracker');
const { trackApiCall } = require('./services/apiCallTrackerService');
const resourceServerRoutes = require('./routes/resourceServer');
const resourceServerTesterRoutes = require('./routes/resourceServerTester');
const resourceServerCCRoutes = require('./routes/resourceServerCC');
const resourceServerTesterCCRoutes = require('./routes/resourceServerTesterCC');
const { initializeDiscovery, getDiscoveryEndpoint } = require('./services/oauthEndpointResolver');
const { registerCallbacks } = require('./services/callbackDispatcher');

// Import middleware
const {
    authenticateToken,
    requireAdmin,
    requireSession
} = require('./middleware/auth');
const {
    logActivity
} = require('./middleware/activityLogger');
const {
    correlationIdMiddleware
} = require('./middleware/correlationId');
const {
    delegationAuditMiddleware
} = require('./middleware/delegationAuditLogger');
const {
    refreshIfExpiring
} = require('./middleware/tokenRefresh');
const audValidationMiddleware = require('./middleware/audValidationMiddleware');
const { agentRestrictionsGate } = require('./middleware/agentRestrictionsGate');

const app = express();

// Phase 266: register sessionStore on the Express app so internal routes
// (e.g., /internal/id-token) can look up sessions by subject sub. Guarded
// so a memory-fallback install (sessionStore === undefined) does NOT
// register a null — /internal/id-token then returns 503 gracefully.
if (sessionStore) {
    app.set('sessionStore', sessionStore);
}

// Response timing instrumentation
app.use(require('./middleware/timing'));
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
    // Content-Security-Policy
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.keyless.technology'], // CRA requires unsafe-inline in prod build
            styleSrc: ["'self'", "'unsafe-inline'", "https://assets.pingone.com"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https://*.pingone.com', 'https://*.pingidentity.com', 'wss:', 'https://*.keyless.technology'],
            fontSrc: ["'self'", 'data:'],
            frameAncestors: ["'none'"],
        },
    },
    // HSTS — 2 years, include subdomains
    strictTransportSecurity: {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true,
    },
    // X-Frame-Options: DENY
    frameguard: {
        action: 'deny'
    },
    // Referrer-Policy
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    },
    // X-Content-Type-Options: nosniff (helmet default)
    noSniff: true,
    // Permissions-Policy (helmet calls this permittedCrossDomainPolicies, but we set it manually below)
    permittedCrossDomainPolicies: false,
    // Disable X-Powered-By
    hidePoweredBy: true,
    // X-XSS-Protection (legacy browsers)
    xssFilter: true,
}));

// Permissions-Policy header (not in helmet's built-in options)
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Cache-Control: no-store for all API routes
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
// Allow credentials (session cookies) from the configured origin.
app.use(cors({
    // In production, CORS_ORIGIN should be set to the frontend URL.
    // Fallback to false (block all cross-origin) rather than reflecting any Origin.
    // The React CRA dev proxy makes requests same-origin in development, so this
    // fallback only affects calls from a different origin without the env var set.
    origin: process.env.CORS_ORIGIN || 'https://api.ping.demo',
    credentials: true
}));

// Trust proxy headers from any load balancer in front of Express.
app.set('trust proxy', 1);

// Enforce HTTPS on Replit — redirect any plain HTTP request.
// Replit terminates TLS before Express and sets x-forwarded-proto.
if (isReplit) {
    app.use((req, res, next) => {
        if (req.secure) return next();
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    });
}

// Rate limiting — set DISABLE_RATE_LIMIT=true (or 1/yes) to turn off global + auth limits while testing locally or on a preview.
const rateLimitDisabled = ['1', 'true', 'yes'].includes(
    String(process.env.DISABLE_RATE_LIMIT || '').toLowerCase()
);
const _rateLimitHandler = (req, res) => {
    // Auth routes are browser-driven redirects — send to login page with friendly error.
    // Use an absolute URL so the redirect works behind a reverse proxy.
    if (req.path.startsWith('/api/auth')) {
        const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
        const host = rawHost || null;
        const origin = host ? `${proto}://${host}` : (process.env.REACT_APP_CLIENT_URL || process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000');
        return res.redirect(`${origin}/login?error=too_many_requests`);
    }
    res.status(429).json({
        error: 'Too many requests. Please wait a few minutes and try again.'
    });
};
const DEV_GLOBAL_LIMIT  = 20000;
const PROD_GLOBAL_LIMIT = 8000;
const DEV_AUTH_LIMIT    = 500;
const PROD_AUTH_LIMIT   = 300;
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // Generous defaults for demos/testing; override with RATE_LIMIT_MAX. Production can tighten via env.
    max: (() => {
        const n = parseInt(process.env.RATE_LIMIT_MAX || '', 10);
        if (Number.isFinite(n) && n > 0) return n;
        return process.env.NODE_ENV === 'development' ? DEV_GLOBAL_LIMIT : PROD_GLOBAL_LIMIT;
    })(),
    handler: _rateLimitHandler,
    skip: () => rateLimitDisabled,
});
/**
 * Paths excluded from the global IP limiter — they have their own limits or are safe, hot paths.
 * Dashboard + config GETs were tripping 429 on shared IPs (NAT) and breaking transfers after hydration failures.
 * demo-scenario + tokens/* load with the dashboard (same burst as accounts/my); counting them toward the
 * global bucket caused 429 before auth-heavy routes could succeed.
 */
function shouldSkipGlobalRateLimit(req) {
    const p = req.path || '';
    return (
        p.startsWith('/api/logs') ||
        p.startsWith('/api/demo-agent') ||
        p.startsWith('/api/agent') ||
        p.startsWith('/api/mcp') ||
        p === '/api/accounts/my' ||
        p === '/api/transactions/my' ||
        p.startsWith('/api/demo-scenario') ||
        p.startsWith('/api/tokens') ||
        p === '/api/auth/session' ||
        p === '/api/auth/oauth/status' ||
        p === '/api/auth/oauth/user/status' ||
        p.startsWith('/api/admin/config')
    );
}
app.use((req, res, next) => (shouldSkipGlobalRateLimit(req) ? next() : limiter(req, res, next)));

// Tighter rate limit for login/callback only — not status polling endpoints.
// max=100 in production: enough headroom for demo testing while still preventing abuse.
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: (() => {
        const n = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '', 10);
        if (Number.isFinite(n) && n > 0) return n;
        return process.env.NODE_ENV === 'development' ? DEV_AUTH_LIMIT : PROD_AUTH_LIMIT;
    })(),
    handler: _rateLimitHandler,
    skip: () => rateLimitDisabled,
});
app.use('/api/auth/oauth/login', authLimiter);
app.use('/api/auth/oauth/callback', authLimiter);
app.use('/api/auth/oauth/user/login', authLimiter);
app.use('/api/auth/oauth/user/callback', authLimiter);

// CR-02 fix: per-session agent message rate limiter.
// /api/demo-agent is excluded from the global IP limiter (it has per-user
// auth and its own latency profile), but must not be completely unlimited.
// Keyed by session ID so shared IPs (NAT, office) don't share the budget.
const agentLimiter = rateLimit({
    windowMs: 60 * 1000,              // 1-minute window
    max: (() => {
        const n = parseInt(process.env.RATE_LIMIT_AGENT_MAX || '', 10);
        if (Number.isFinite(n) && n > 0) return n;
        return 30; // 30 messages/session/minute — generous for demos, still bounded
    })(),
    keyGenerator: (req) => req.session?.id || req.ip,
    handler: _rateLimitHandler,
    skip: () => rateLimitDisabled,
});
app.use('/api/demo-agent/message', agentLimiter);

// Logging middleware
// Skip access-log noise from high-frequency polling endpoints
const POLL_ROUTES = new Set([
  '/api/auth/oauth/user/status',
  '/api/auth/oauth/status',
  '/api/tokens/session-preview',
  '/api/auth/session',
  '/api/auth/ciba/status',
  '/api/config/vertical',
  '/api/admin/config',
]);
app.use(morgan('combined', {
  skip: (req) => POLL_ROUTES.has(req.path),
}));

// Capture the session middleware instance so the langchain chat-WS proxy
// (attached after .listen()) can authenticate the WebSocket upgrade with the
// SAME express-session cookie logic as HTTP requests. This does not change
// session registration order, the secret resolver, store priority, or cookie
// attributes — it only keeps a reference to the existing middleware. (§1
// Session persistence: read-only reuse, no new session writes.)
const sessionMiddleware = session({
    secret: (() => {
        const s = process.env.SESSION_SECRET;
        if (!s || s === 'dev-session-secret-change-in-production') {
            if (process.env.NODE_ENV === 'production' || process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT) {
                console.error('[FATAL] SESSION_SECRET env var is not set or is using the insecure default. Set a random 32+ character string in your deployment environment.');
                process.exit(1);
            }
            console.warn('[security] SESSION_SECRET not set — using insecure default (dev only).');
        }
        return s || 'dev-session-secret-change-in-production';
    })(),
    resave: false,
    saveUninitialized: false,
    ...(sessionStore ? {
        store: sessionStore
    } : {}),
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});
app.use(sessionMiddleware);

// Session secret rotation detector: persist a hash of the current SESSION_SECRET
// into configStore on first boot; on subsequent boots, compare and warn if changed.
// A changed SESSION_SECRET invalidates all existing sessions silently — users get
// 401s with no clear message. This surfaces that at boot instead.
(function detectSessionSecretRotation() {
    try {
        const crypto = require('crypto');
        const currentSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-in-production';
        const currentHash = crypto.createHash('sha256').update(currentSecret).digest('hex').slice(0, 16);
        const storedHash = configStore.get('_session_secret_hash');
        if (storedHash && storedHash !== currentHash) {
            console.warn(
                '[session] SESSION_SECRET has changed since the last boot — all active sessions are now invalid. ' +
                'Users will be silently logged out on their next request. This is expected after a deliberate ' +
                'secret rotation; if unintentional, restore the previous SESSION_SECRET.',
            );
        }
        // Store hash for next-boot comparison. Not sensitive — it's a short prefix of a SHA-256 hash.
        configStore._cache['_SESSION_SECRET_HASH'] = currentHash;
    } catch (_) {
        // Never let this block startup.
    }
}());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

// Correlation ID — attach X-Request-ID to every request/response for distributed tracing.
app.use(correlationIdMiddleware);
// Propagate that correlation ID + a W3C traceparent onto every outbound axios
// call (PingOne token/exchange/revoke/introspect, banking API) so external legs
// are traceable end-to-end, not just BFF→gateway→MCP.
require('./utils/outboundTracing').registerOutboundTracing();

// Activity logging middleware
app.use(logActivity);

// Delegation audit logging — extract act/may_act claims for audit trail
app.use(delegationAuditMiddleware);

// Ensure configStore is loaded before any request touches OAuth config.
// The promise is memoised — this is a no-op after the first request.
app.use(async (_req, _res, next) => {
    try {
        await configStore.ensureInitialized();
        next();
    } catch (err) {
        next(err);
    }
});

// Migrate demo accounts to persistent storage on startup
migrateAccounts().catch(err => {
    console.error('[server] Demo accounts migration failed:', err.message);
});

// Seed runtimeSettings from persisted feature flags that declare a runtimeKey.
// runtimeSettings is in-memory and seeded from env at module load; without this,
// a flag toggled OFF via /api/admin/feature-flags (persisted to configStore)
// would silently revert to its hardcoded default on the next restart.
// Done after ensureInitialized() so the configStore cache is populated first.
(async () => {
    try {
        await configStore.ensureInitialized();
        const runtimeSettings = require('./config/runtimeSettings');
        const { FLAG_REGISTRY } = require('./routes/featureFlags');
        const seed = {};
        for (const flag of FLAG_REGISTRY) {
            if (!flag.runtimeKey) continue;
            const raw = configStore.get(flag.id);
            if (raw === null || raw === undefined) continue; // keep env-seeded default
            seed[flag.runtimeKey] =
                flag.type === 'boolean' ? (raw === true || raw === 'true') : raw;
        }
        if (Object.keys(seed).length > 0) {
            runtimeSettings.update(seed, 'boot-seed-from-configStore');
        }
    } catch (err) {
        console.warn('[server] runtimeSettings boot-seed from configStore failed:', err.message);
    }
})();

// Non-blocking OIDC discovery — populates endpoint cache when oauth_discovery_enabled=true
initializeDiscovery().catch(err => {
    console.warn('[server] OIDC discovery initialization failed:', err.message);
});

// Phase 266 R2: ensure banking-resource-server.db exists (idempotent seed from data/store.js on first boot)
try {
    const { initBankingDb } = require('./services/bankingDb');
    initBankingDb();
} catch (err) {
    console.warn('[server] banking-resource-server.db init failed:', err.message);
    // Routes /accounts and /transactions will 500 until fixed; recovery: delete the file and restart.
}

// Initialize vertical manifest singleton (seeds from /verticals on disk if present)
try {
    const { verticalManifest } = require('./services/verticalManifest');
    verticalManifest.init();
} catch (err) {
    console.warn('[server] verticalManifest init failed:', err.message);
    // Routes /api/verticals will 500 until fixed; recovery: ensure verticalManifest service is valid and restart.
}

// Repopulate dynamic OAuth client registrations from LMDB so DCR-registered
// clients (and their public /.well-known CIMD docs) survive a restart.
try {
    require('./services/oauthClientRegistry').hydrate();
    hydrateCimdStore();
} catch (err) {
    console.warn('[server] OAuth client registry hydrate failed:', err.message);
    // Newly-registered clients still work; previously-registered ones reappear after fix + restart.
}

// Restore the security-monitoring dashboard state (alerts, client risk, metrics)
// from its last LMDB snapshot.
try {
    require('./services/securityMonitoringService').hydrate();
} catch (err) {
    console.warn('[server] security monitoring hydrate failed:', err.message);
    // Dashboard just starts empty until new events arrive.
}

// Restore session user from signed _auth cookie when in-memory session is empty.
app.use(restoreSessionFromCookie);

// RFC 6749 §6 — silently refresh near-expired end-user access tokens on
// authenticated API routes so UIs never serve stale tokens to downstream services.
// Include /api/auth/oauth so GET /api/auth/oauth/user/status (and admin /status) run
// refresh before the handler — otherwise the SPA sees authenticated:true while
// /api/accounts/my still gets 401 from validatePingOneCoreToken on an expired JWT.
app.use(
    [
        '/api/users',
        '/api/accounts',
        '/api/transactions',
        '/api/mcp',
        '/api/demo-agent',
        '/api/tokens',
        '/api/demo-scenario',
        '/api/auth/oauth',
        '/api/mfa/test',
    ],
    refreshIfExpiring,
);

// RFC 6750 §3 — Validate audience (aud) claim on all incoming tokens
// Prevents token confusion attacks (token for API A cannot be used for API B).
// Fails closed: if aud doesn't match, return 401 Unauthorized.
// Applied to all /api/ routes after authentication.
app.use('/api', audValidationMiddleware);

// High-frequency polling paths excluded from API Explorer tracking to avoid noise
const TRACKING_SKIP_PREFIXES = [
    '/api-calls', '/tokens/session-preview', '/tokens/agent-cc-preview',
    '/healthz', '/health', '/mcp/traffic', '/oauth/monitor',
];

// Auto-track all /api/* calls into the API Explorer (skips polling endpoints to avoid noise)
app.use('/api', (req, res, next) => {
    if (TRACKING_SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();
    const start = Date.now();
    const origJson = res.json.bind(res);
    let captured = null;
    res.json = (body) => {
        captured = body;
        return origJson(body);
    };
    res.on('finish', () => {
        trackApiCall({
            sessionId: req.session?.id || 'default',
            method: req.method,
            url: req.originalUrl,
            requestHeaders: req.headers,
            requestBody: req.body && Object.keys(req.body).length ? req.body : null,
            responseStatus: res.statusCode,
            responseBody: captured,
            duration: Date.now() - start,
            category: 'api',
        }).catch(() => {});
    });
    next();
});

// Health check endpoint
app.get('/api/healthz', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Endpoint health check (for debugging tool discovery issues)
app.get('/api/admin/endpoint-health', async (req, res) => {
    const { validateEndpoints } = require('./services/endpointValidator');
    try {
        const { results } = await validateEndpoints();
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// P2 — Role switch: initiates an OAuth re-login to a different role without a
// full sign-out cycle. Clears the current session auth, sets a short-lived
// `_switch_target` cookie so the OAuth callback knows the target role, and
// returns the login URL for the client to navigate to.
app.post('/api/auth/switch', (req, res) => {
    const {
        targetRole
    } = req.body || {};
    if (!['admin', 'customer'].includes(targetRole)) {
        return res.status(400).json({
            error: 'invalid_target',
            message: 'targetRole must be "admin" or "customer".'
        });
    }

    // Clear current auth
    delete req.session.oauthTokens;
    delete req.session.user;
    delete req.session.clientType;
    delete req.session.oauthType;
    clearAuthCookie(res, isProduction);

    // Set switch_target cookie so the OAuth callback knows where to redirect
    const cookieOpts = {
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction,
        maxAge: 5 * 60 * 1000, // 5 minutes
        path: '/',
    };
    res.cookie('_switch_target', targetRole, cookieOpts);

    // Return the appropriate login URL for the client to navigate to
    const origin = req.headers.origin || '';
    const loginUrl = targetRole === 'admin' ?
        `${origin}/api/auth/oauth/login` :
        `${origin}/api/auth/oauth/user/login`;

    req.session.save(() => res.json({
        redirectUrl: loginUrl
    }));
});

// Silent re-authentication — mint a FRESH access token (new scopes / claims)
// WITHOUT a credential prompt. Demo flows call this after an action that changes
// what the token should carry (vertical switch → new featureScope; delegation
// grant/revoke → may_act) but where a refresh-token renewal is insufficient
// (refresh renews, it never adds scopes or may_act). We clear the stored token
// so /login won't short-circuit, then 302 to the role-appropriate login WITHOUT
// `prompt=login`, so PingOne SSO (if still alive) re-issues silently. GET so a
// caller just navigates to it.
app.get('/api/auth/reauth', (req, res) => {
    const wasAdmin = req.session?.oauthType === 'admin' || req.session?.user?.role === 'admin';
    delete req.session.oauthTokens;
    delete req.session.user;
    delete req.session.clientType;
    delete req.session.oauthType;
    clearAuthCookie(res, isProduction);
    const loginPath = wasAdmin ? '/api/auth/oauth/login' : '/api/auth/oauth/user/login';
    // Pass return_to through; the login route sanitises it (sanitizePostLoginReturnPath).
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : '';
    const qs = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
    req.session.save(() => res.redirect(`${loginPath}${qs}`));
});

// Belt-and-suspenders cookie/session clear — called by the SPA after it detects
// that the user just returned from the logout redirect chain.  Ensures the _auth
// cookie is cleared even if the 302-redirect Set-Cookie header was not honoured
// by an intermediate redirect (e.g. PingOne signoff without id_token_hint).
app.post('/api/auth/clear-session', (req, res) => {
    clearAllAuthCookies(res, isProduction);
    if (req.session) {
        req.session.destroy(() => {});
    }
    res.json({ ok: true });
});

// Unified logout — destroys whichever session is active and returns a JSON
// body with the PingOne signoff URL. The SPA navigates there directly so the
// cookie-clearing Set-Cookie headers are delivered on the /api/auth/logout
// response (not on a 302 redirect that gets proxied away without cookies).
app.get('/api/auth/logout', async (req, res) => {
    const idToken = req.session.oauthTokens?.idToken
        // Fallback: auth-state cookie carries the id_token for RP-Initiated Logout
        // when the server session has expired or been lost.
        || readAuthCookie(req)?.idToken
        || null;
    const accessToken = req.session.oauthTokens ?.accessToken || null;
    const refreshToken = req.session.oauthTokens ?.refreshToken || null;
    const postLogoutUri = `${getFrontendOrigin(req)}/logout`;

    // RFC 7009 — revoke tokens before destroying the session so they can no
    // longer be used even if intercepted.  Runs in parallel; non-fatal on error.
    if (accessToken && accessToken !== '_cookie_session') {
        oauthService.revokeToken(accessToken, 'access_token')
            .catch(err => console.warn('[logout] access token revoke error:', err.message));
    }
    if (refreshToken && refreshToken !== '_cookie_session') {
        oauthService.revokeToken(refreshToken, 'refresh_token')
            .catch(err => console.warn('[logout] refresh token revoke error:', err.message));
    }

    // Capture oauthType before destroy so we can pick the right client_id below.
    const oauthType = req.session.oauthType || 'user';

    // Clear in-memory demo state so next login starts fresh (fire-and-forget)
    try {
        const { clearAllTokenChains } = require('./services/tokenChainService');
        const mcpAudit = require('./services/mcpToolAuditStore');
        const appEvtSvc = require('./services/appEventService');
        // SDK-demo LMDB token cleanup — clear LMDB tokens for this session before
        // the session is destroyed so the storage does not accumulate stale entries.
        if (req.sessionID) {
            require('./services/lmdb/sdkDemoTokenStore.lmdb').clearSession(req.sessionID);
        }
        clearAllTokenChains();
        mcpAudit.clearToolCalls();
        appEvtSvc.clearEvents();
        if (global.pendingConsents) global.pendingConsents = {};
        // Clear MCP server's own audit log
        const mcpWsUrl = process.env.MCP_SERVER_URL || configStore.getEffective('mcp_server_url');
        const mcpHttpBase = mcpWsUrl.replace(/^ws(s?):/, 'http$1:');
        fetch(`${mcpHttpBase}/audit`, { method: 'DELETE', signal: AbortSignal.timeout(1500) }).catch(() => {});
        // Flush the MCP gateway's in-memory token-exchange + introspection
        // caches so a freshly-revoked token cannot be replayed from there
        // within its TTL. Fire-and-forget; gated by the shared internal secret.
        const gwBase = require('./services/mcpGatewayClient').getMcpGatewayHttpUrl();
        const gwSecret = process.env.BFF_INTERNAL_SECRET || '';
        if (gwBase && gwSecret) {
            fetch(`${gwBase}/admin/clear-token-cache`, {
                method: 'POST',
                headers: { 'x-internal-gateway-secret': gwSecret },
                signal: AbortSignal.timeout(1500),
            }).catch(() => {});
        }
    } catch (_) {}

    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error during unified logout:', err);
        }

        // Expire all auth-related cookies — session.destroy() removes server-side
        // data but the browser retains cookie values until overwritten. Clearing
        // the _auth cookie also stops the session-restore middleware from keeping
        // the user signed in on the next request.
        clearAllAuthCookies(res, isProduction);

        const envId = configStore.getEffective('pingone_environment_id');
        const region = configStore.getEffective('pingone_region') || 'com';
        const pingoneSignoff = `https://auth.pingone.${region}/${envId}/as/signoff`;

        // Pick the right OAuth client_id so PingOne ends the correct SSO session.
        // client_id is required by PingOne to locate and terminate the SSO session.
        const userClientId  = configStore.getEffective('pingone_user_client_id')  || process.env.PINGONE_USER_CLIENT_ID;
        const adminClientId = configStore.getEffective('pingone_admin_client_id') || process.env.PINGONE_ADMIN_CLIENT_ID || process.env.PINGONE_CLIENT_ID;
        const clientId = (oauthType === 'admin' ? adminClientId : userClientId) || userClientId;

        const params = new URLSearchParams({
            post_logout_redirect_uri: postLogoutUri
        });
        if (idToken) {
            params.set('id_token_hint', idToken);
        } else {
            console.warn('[logout] id_token not found in session — PingOne SSO session may not be cleared. oauthType:', oauthType);
        }
        if (clientId) {
            params.set('client_id', clientId);
        } else {
            console.warn('[logout] No client_id resolved — PingOne may not identify the RP for signoff.');
        }

        const signoffUrl = `${pingoneSignoff}?${params.toString()}`;
        console.info(`[logout] Signoff URL built (id_token_hint: ${idToken ? 'yes' : 'NO'}, client_id: ${clientId || 'none'})`);

        // Detect whether the caller expects a redirect (window.location.href navigation)
        // or a JSON body (fetch from the SPA). Accept header contains 'text/html' for
        // direct browser navigations; fetch() sends 'application/json' or '*/*'.
        const acceptsHtml = (req.get('accept') || '').includes('text/html');
        if (acceptsHtml) {
            // Direct browser navigation — redirect as before (keeps backward compat
            // for any tool or test that calls this endpoint directly).
            res.redirect(signoffUrl);
        } else {
            // Fetch from SPA — return JSON so the SPA can navigate after receiving
            // the Set-Cookie headers that clear connect.sid and _auth.
            res.json({ logoutUrl: signoffUrl });
        }
    });
});

/**
 * Safe OAuth token summary for /api/auth/debug — no secrets or raw JWTs.
 */
function summarizeOAuthTokensForDebug(tokens) {
    if (!tokens || typeof tokens !== 'object') {
        return {
            present: false
        };
    }
    const at = typeof tokens.accessToken === 'string' ? tokens.accessToken : '';
    return {
        present: true,
        accessTokenLength: at.length,
        accessTokenStub: at === '_cookie_session',
        accessTokenLooksLikeJwt: at.startsWith('eyJ'),
        hasRefreshToken: typeof tokens.refreshToken === 'string' &&
            tokens.refreshToken.length > 0 &&
            tokens.refreshToken !== '_cookie_session',
        hasIdToken: typeof tokens.idToken === 'string' && tokens.idToken.length > 0,
        expiresAt: tokens.expiresAt ?? null,
        expiresInSec: typeof tokens.expiresAt === 'number' ?
            Math.round((tokens.expiresAt - Date.now()) / 1000) : null,
    };
}

/**
 * High-signal hints for session issues.
 */
function buildSessionDiagnosisHints(req, { accessTokenStub }) {
    const hints = [];
    const stub = accessTokenStub === true;

    if (req.session?._restoredFromCookie) {
        hints.push(
            'sessionRestored: express had no user before _auth cookie middleware — identity rebuilt from signed cookie.',
        );
    }
    if (stub) {
        hints.push(
            'accessToken is _cookie_session stub — no real OAuth token in req.session (cookie restore, or session save failed after OAuth).',
        );
    }
    if (!stub && req.session ?.oauthTokens ?.accessToken && String(req.session.oauthTokens.accessToken).startsWith('eyJ')) {
        hints.push('req.session has JWT-shaped access token — OK for BFF-backed routes.');
    }
    return hints;
}

// Debug endpoint — shows auth state for the current request.
// Returns cookie presence, session state, and platform flags.
// No secrets are exposed.
app.get('/api/auth/debug', async (req, res) => {
    const cookieNames = Object.keys(
        Object.fromEntries(
            (req.headers.cookie || '').split(';').map(p => [p.split('=')[0].trim(), 1])
        )
    ).filter(Boolean);

    const accessTokenStub = req.session ?.oauthTokens ?.accessToken === '_cookie_session';
    const cookieOnlyBffSession =
        req.session?._restoredFromCookie === true || accessTokenStub;
    const token = req.session ?.oauthTokens ?.accessToken;
    const hasOAuthToken = !!(token && token !== '_cookie_session');
    const oauthUserWouldAuthenticate = !!(
        req.session ?.user &&
        hasOAuthToken &&
        req.session.oauthType === 'user'
    );

    const oauthTokenSummary = summarizeOAuthTokensForDebug(req.session ?.oauthTokens);
    const diagnosisHints = buildSessionDiagnosisHints(req, { accessTokenStub });

    res.json({
        platform: {
            replit: !!process.env.REPL_ID,
            production: isProduction
        },
        sessionPresent: !!req.session,
        sessionId: req.session ?.id ? req.session.id.slice(0, 8) + '...' : null,
        sessionHasUser: !!req.session ?.user,
        sessionOauthType: req.session ?.oauthType || null,
        sessionClientType: req.session ?.clientType || null,
        sessionRestored: !!req.session?._restoredFromCookie,
        sessionHasTokens: !!req.session ?.oauthTokens ?.accessToken,
        accessTokenStub,
        oauthTokenSummary,
        cookieOnlyBffSession,
        oauthUserWouldAuthenticate,
        cookiesPresent: cookieNames,
        hasAuthCookie: cookieNames.includes('_auth'),
        hasPkceCookie: cookieNames.includes('_pkce'),
        sessionCookieName: cookieNames.includes('connect.sid') ? 'connect.sid present' : 'connect.sid MISSING',
        sessionStoreType,
        storageType: configStore.getStorageType(),
        isConfigured: configStore.isConfigured(),
        userEmail: req.session ?.user ?.email || null,
        userRole: req.session ?.user ?.role || null,
        diagnosisHints,
    });
});

// API Routes
// IMPORTANT: /api/admin/config MUST be registered before /api/admin so that
// unauthenticated requests to the config endpoint are not blocked by the
// authenticateToken middleware that guards the broader /api/admin/* prefix.
app.use('/api/admin/pingcli', authenticateToken, pingcliRoutes);
app.use('/api/admin/config', adminConfigRoutes);

// PingOne MCP setup — isolated endpoint with its own authenticateToken guard
// (not part of the /api/admin/* prefix pattern; auth is enforced at the route level)
app.use('/api/pingone/setup', pingoneSetupRoutes);

// Feature flags — registered before the broader /api/admin/* guard so this
// more-specific path matches first (Express prefix order) and is NOT subjected
// to the authenticateToken middleware on /api/admin.
// INTENTIONALLY UNAUTHENTICATED (commit a1047b03): both GET and PATCH are open.
// This is a deliberate demo-ergonomics choice so flags can be toggled without an
// admin session. Trade-off: any caller can flip security-relevant flags
// (ff_hitl_enabled, step_up_enabled, ff_skip_token_exchange, ff_inject_*).
// See REGRESSION_PLAN.md §1 "configStore / Config UI" — do not silently add an
// auth gate here without updating that entry and the demo docs.
app.use('/api/admin/feature-flags', featureFlagsRoutes);
app.use('/api/admin/scope-audit', authenticateToken, require('./routes/scopeAudit'));
app.use('/api/admin/token-compliance', authenticateToken, require('./routes/tokenCompliance'));
app.use('/api/admin/lighthouse', authenticateToken, require('./routes/lighthouseRoute'));

// PingOne redirect URI allowlist (JSON). Registered here BEFORE /api/auth so the path is not
// handled only by routes/auth.js (avoids "Cannot GET" on some deployments).
app.get('/api/auth/oauth/redirect-info', (_req, res) => {
    try {
        res.json(getOAuthRedirectDebugInfo(_req));
    } catch (err) {
        res.status(500).json({
            error: 'redirect_info_failed',
            message: err.message
        });
    }
});

// SDK centralized-login demo (/sdk-login) — public, non-secret config for the
// browser-side @forgerock/oidc-client. Mirrors the public redirect-info handler
// above. Returns ONLY non-secret values (this is a public PKCE SPA client; it has
// no secret to leak). The browser builds its OIDC client from these.
app.get('/api/sdk-demo/config', (_req, res) => {
    try {
        res.json({
            wellknown:   getDiscoveryEndpoint(),
            clientId:    configStore.getEffective('pingone_sdk_demo_client_id'),
            redirectUri: configStore.getEffective('pingone_sdk_demo_redirect_uri'),
            scope:       configStore.getEffective('pingone_sdk_demo_scope'),
        });
    } catch (err) {
        res.status(500).json({
            error: 'sdk_demo_config_failed',
            message: err.message
        });
    }
});

// SDK demo token store — LMDB-backed custom storage adapter for @forgerock/oidc-client
// (see routes/sdkDemoTokens.js). Mounted here, next to the public config endpoint.
app.use('/api/sdk-demo', require('./routes/sdkDemoTokens'));

app.use('/api/auth', authRoutes);
app.use('/api/auth/oauth', oauthRoutes);
app.use('/api/auth/oauth/user', oauthUserRoutes);
registerCallbacks(app, oauthRoutes, oauthUserRoutes, authLimiter);
app.use('/api/auth/ciba', cibaRoutes);
app.use('/api/auth/mfa', mfaRoutes);
app.use('/api/recognize', recognizeRoutes);
app.use('/api/mfa/test', mfaTestRoutes);
app.use('/api/agent', agentIdentityRoutes);
app.use('/api/agent', agentDelegationRoutes);
app.use('/api/mcp', mcpDecisionPollingRoutes);
app.use('/api/mcp', mcpExchangeModeRoutes); // GET/POST /api/mcp/exchange-mode — UI ExchangeModeContext toggle
app.use('/api/use-cases', authenticateToken, require('./routes/useCases'));
app.use('/api/test/token-validation', testTokenScenariosRoutes); // UI TokenSecurityTester; self-gated 403 in prod unless FF_TEST_TOKEN_SCENARIOS
// NL/search routes: public LLM config + NL parsing. Must be mounted BEFORE demoAgentRoutes
// so /nl/status, /nl, and /search are handled without agentSessionMiddleware.
app.use('/api/demo-agent', demoAgentNlRoutes);
// Authenticated agent routes: /init, /message, /consent — require OAuth session.
app.use('/api/demo-agent', demoAgentRoutes);
// Intent authorization and unified agent invocation
app.use('/api', intentAuthRoutes);
app.use('/api', agentInvokeRoutes);
app.use('/api/agent', agentRunRoutes); // AG-UI Step 2: /api/agent/run
app.use('/api/agent/langchain', require('./routes/agentLangchainRunRoute')); // AG-UI Phase 2.3: LangChain /run
const { codegraphProxy, codegraphReindexProxy } = require('./routes/codegraphProxy');
app.post('/api/codegraph/query', codegraphProxy);
app.post('/api/codegraph/reindex', codegraphReindexProxy);
app.use('/api/agent', require('./routes/agentConsentRoute')); // AG-UI Phase 4.1: HITL consent
app.use('/api/langchain', langchainConfigRoutes);
app.use('/api/langchain/lmstudio', lmstudioRoutes);
app.use('/api/authorize', authorizeRoutes);
app.use('/api/admin/authorize', authorizeConfigRoutes);
app.use('/api/introspect', introspectRoutes);
app.use('/api/setup', setupRoutes);
// MCP Inspector: no auth gate at the router level — tools/list returns local catalog for
// unauthenticated visitors; tools/call and context check auth inside each handler.
app.use('/api/mcp', mcpToolScopesRouter);
app.use('/api/mcp/inspector', mcpInspectorRoutes);
// MCP Gateway Config — status + generated PingGateway mcp.json (open to any authenticated session)
app.use('/api/admin/mcp-gateway', mcpGatewayConfigRouter);
// User-accessible alias — mirrors /api/admin/mcp-gateway/* for enduser sessions
app.use('/api/mcp-gateway', mcpGatewayConfigRouter);
app.use('/api/mcp/traffic', requireSession, mcpTrafficRoutes);
// MCP Audit: admin-only route — proxies to MCP server /audit internal endpoint (D-11)
app.use('/api/mcp/audit', (req, res, next) => {
    if (!req.session ?.user || req.session.user.role !== 'admin') {
        return res.status(401).json({
            error: 'admin_required',
            message: 'Admin session required to access audit log.'
        });
    }
    next();
}, mcpAuditRouter);
// Session preview uses session data only — no full JWT validation.
// Must be registered BEFORE the auth-gated /api/tokens block.
app.get('/api/tokens/session-preview', async (req, res) => {
    try {
        const {
            tokenEvents
        } = await buildSessionPreviewTokenEvents(req);
        res.json({
            tokenEvents
        });
    } catch (err) {
        console.error('Token session-preview error:', err);
        res.json({
            tokenEvents: []
        });
    }
});

// Public app-events endpoint — available to ALL pages (not just admin)
// so the spinner activity feed works for customer dashboards too.
app.get('/api/app-events', (req, res) => {
    try {
        const VALID_CATEGORIES = new Set(['oauth','token_exchange','session','jwks','mcp','auth_lifecycle','agent','authorize','agent_prompt','delegation','introspection']);
        const VALID_SEVERITIES = new Set(['info','warning','error','warn']);
        const { category, severity, limit = 100, since } = req.query;
        const safeCategory = VALID_CATEGORIES.has(category) ? category : undefined;
        const safeSeverity = VALID_SEVERITIES.has(severity) ? severity : undefined;
        const safeSince = since && (/^\d{4}-\d{2}-\d{2}(T[\d:.Z\-+]+)?$/).test(since) ? since : undefined;
        const events = appEventService.getEvents({
            category: safeCategory,
            severity: safeSeverity,
            limit: Math.min(parseInt(limit) || 100, 500),
            since: safeSince,
        });
        res.json({ events, total: events.length });
    } catch (error) {
        console.error('Get public app-events error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/app-events/stream — SSE push for live app events (replaces 10s polling)
// Streams one event per `data:` line whenever appEventService.logEvent() fires.
// Filters (category, severity) accepted as query params, same as the GET endpoint.
app.get('/api/app-events/stream', (req, res) => {
    const VALID_CATEGORIES = new Set(['oauth','token_exchange','session','jwks','mcp','auth_lifecycle','agent','authorize','agent_prompt','delegation','introspection']);
    const VALID_SEVERITIES = new Set(['info','warning','error','warn']);
    const { category, severity } = req.query;
    const filterCategory = VALID_CATEGORIES.has(category) ? category : null;
    const filterSeverity = VALID_SEVERITIES.has(severity) ? severity : null;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send a keepalive comment every 25s to prevent proxy timeouts
    const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (_) {} }, 25000);

    const send = (event) => {
        if (filterCategory && event.category !== filterCategory) return;
        if (filterSeverity && event.severity !== filterSeverity) return;
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
    };

    const unsub = appEventService.subscribe(send);

    req.on('close', () => {
        clearInterval(keepalive);
        unsub();
    });
});

// agent-cc-preview fetches the agent's own CC token — no user OAuth token needed.
// Register before the authenticateToken block so customers with a valid session can access it.
app.get('/api/tokens/agent-cc-preview', requireSession, tokenRoutes.agentCcPreviewHandler);
app.use('/api/tokens', authenticateToken, tokenRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/self-service/users', authenticateToken, selfServiceUsersRoutes);
app.use('/api/reports', reportsRoutes);
// Agent restrictions gate — fires only on agent-originated calls (X-Agent-Sub present)
// when ff_agent_restrictions=true. No-op for all direct user calls.
app.use(['/api/accounts', '/api/transactions'], agentRestrictionsGate);
app.use('/api/accounts', authenticateToken, accountRoutes);
app.use('/api/accounts', authenticateToken, sensitiveBankingRoutes);
// Interactive tester — mounted BEFORE the general /api/resource-server router so the
// more-specific /test/* paths match here instead of falling through to a 404.
app.use('/api/resource-server/test', authenticateToken, resourceServerTesterRoutes);
app.use('/api/resource-server', authenticateToken, resourceServerRoutes);
app.use('/api/resource-server-cc/test', authenticateToken, resourceServerTesterCCRoutes);
app.use('/api/resource-server-cc', authenticateToken, resourceServerCCRoutes);

// Internal gateway-only endpoint — NOT under /api/*; NOT exposed to the browser.
// Phase 266: gateway reads the user's id_token server-to-server via shared secret.
app.use('/internal', require('./routes/agentIdToken'));
// AG-UI Step 8: BFF-internal tool execution endpoint (agent service → BFF → MCP).
// NOT browser-facing; bound to loopback per REGRESSION_PLAN §3.
app.use('/internal', require('./routes/agentTool'));
// Gateway-only durable audit ingest — the stateless gateway ships every
// cross-vertical tool-call outcome here to persist in LMDB (read back by the
// admin MCP Audit Trail page). Secret-guarded; NOT browser-facing.
app.use('/internal', require('./routes/mcpAuditIngest'));

// Phase 266 R2 — Path A info marker (session-cookie auth; no Bearer needed from SPA)
app.use('/api/path', require('./routes/pathInfo'));
app.use('/api/path', require('./routes/verticalTool'));
app.use('/api/transactions', (req, res, next) => {
    // Allow Bearer-token requests (MCP server, agent gateway, direct API calls) to bypass
    // the session-cookie check — authenticateToken validates the JWT below.
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) return next();
    return requireSession(req, res, next);
}, authenticateToken, transactionRoutes);
// GET /api/demo-scenario — return empty defaults when unauthenticated so the public
// /demo-data page never triggers a 401 console error.  All mutating methods (PUT, PATCH)
// still hit authenticateToken via the router below.
app.get('/api/demo-scenario', (req, res, next) => {
    if (req.session ?.user) return next();
    return res.json({
        accounts: [],
        settings: {},
        defaults: null,
        userData: {},
        persistenceNote: null
    });
});
app.use('/api/demo-scenario', authenticateToken, demoScenarioRoutes);
app.use('/api/admin/demo-users', adminDemoUsersRoutes);
app.use('/api/admin/agent', authenticateToken, adminAgentToolsRoutes);
app.use('/api/admin-agent', authenticateToken, requireAdmin, adminAgentRoutes);
app.use('/api/admin', authenticateToken, require('./routes/adminVerticals'));
app.use('/api/admin', authenticateToken, require('./routes/verticalThemes'));
app.use('/api/admin', authenticateToken, adminRoutes);

// AI Control Plane (cross-platform agent roster). Any authenticated user — the
// router applies authenticateToken per-route; no admin role required.
app.use('/api/control-plane', require('./routes/controlPlane'));
app.use('/api/admin/management', adminManagementRoutes);
app.use('/api/admin/setup', setupWizardRoutes);
app.use('/api/admin/vault', authenticateToken, require('./routes/adminVault'));
app.use('/api/admin/diagrams', authenticateToken, diagramsRoutes);
app.use('/api/arch-events', authenticateToken, archEventsRoutes);
app.use('/api/dev', devToolsRoutes);
app.use('/api/clients', authenticateToken, clientRegistrationRoutes);
app.use('/api/oauth/clients', authenticateToken, oauthClientsRoutes);
app.use('/api/oauth/token', oauthTokenRoutes);
// Public, read-only JWKS for the BFF's private_key_jwt client-auth key (teaching/visualization)
app.use('/api/oauth/jwks', require('./routes/oauthJwks'));
app.use('/api/delegation', authenticateToken, delegationRoutes);
app.use('/api/agent-authorization', authenticateToken, agentAuthorizationRoutes);
app.use('/api/token-chain', authenticateToken, tokenChainRoutes);
app.use('/api/token-display', authenticateToken, tokenDisplayRoutes);
app.use('/api/api-calls', apiCallTrackerRoutes);
app.use('/api/admin/app-config', authenticateToken, appConfigRoutes);
app.use('/api/verticals', authenticateToken, verticalManifestRoutes);
app.use('/api/plugin/data', authenticateToken, require('./routes/pluginData'));
app.use('/api/config/credentials', configCredentialsRoutes);
app.use('/api/config/thresholds', thresholdsRoutes);

// Health check endpoints (unauthenticated — used by monitoring + demo config UI)
const healthRoutes = require('./routes/health');
app.use('/api/health', healthRoutes);

// Token validation mode config endpoints (admin + ui accessible for demo toggle)
const validationModeConfig = require('./config/validationModeConfig');

app.get('/api/config/validation-mode', (req, res) => {
    const mode = validationModeConfig.getValidationMode();
    res.json({
        mode,
        description: validationModeConfig.getModeDescription(mode),
        metadata: validationModeConfig.getModeMetadata(mode),
        supported: validationModeConfig.SUPPORTED_MODES,
    });
});

app.post('/api/config/validation-mode', (req, res) => {
    // Require admin session to change validation mode
    if (!req.session ?.user) {
        return res.status(401).json({
            error: 'authentication_required',
            message: 'Session required to change validation mode'
        });
    }
    const {
        mode
    } = req.body || {};
    if (!mode) {
        return res.status(400).json({
            error: 'missing_mode',
            message: 'Request body must include "mode" field'
        });
    }
    try {
        validationModeConfig.setValidationMode(mode);
        res.json({
            mode: validationModeConfig.getValidationMode(),
            description: validationModeConfig.getModeDescription(),
            message: `Validation mode set to: ${mode}`,
        });
    } catch (err) {
        res.status(400).json({
            error: 'invalid_mode',
            message: err.message,
            supported: validationModeConfig.SUPPORTED_MODES
        });
    }
});

app.use('/api/logs', logsRoutes);

// PingOne Configuration Audit — admin-accessible endpoint for validating resources and scopes
app.use('/api/pingone/audit', pingoneAuditRoutes);

// PingOne Test Page — /config is public (env settings only, no user data); all other endpoints require auth
app.use('/api/pingone-test', (req, res, next) => {
    if (req.path === '/config' && req.method === 'GET') return next();
    authenticateToken(req, res, next);
}, pingoneTestRoutes);

app.use('/api/admin/pinggateway', (req, res, next) => {
    if (req.path === '/test/config' && req.method === 'GET') return next();
    requireAdmin(req, res, next);
}, pinggatewayTestRoutes);

// Migration API routes - mixed authentication (some public, some admin-only)
app.use('/api/migration', migrationRoutes);

// Security monitoring API routes - admin-only
app.use('/api/security', securityMonitoringRoutes);

const demoProvisioningRoutes = require('./routes/demoProvisioning');
app.use('/api/demo', express.json(), demoProvisioningRoutes);
app.use('/api/agent-builder', express.json(), require('./routes/agentBuilder')); // AgentBuilderPage — self-service per-user agent identity

const demoAttackSeedsRoutes = require('./routes/demoAttackSeeds');
app.use('/api/demo/attacks', express.json(), demoAttackSeedsRoutes);

const attackSimulatorRoutes = require('./routes/attackSimulator');
app.use('/api/demo/attack-sim', express.json(), attackSimulatorRoutes);

// Public CIMD well-known endpoint — no authentication required.
// Mounted after session/auth middleware but before static files.
app.get('/.well-known/oauth-client/:clientId', wellKnownHandler);

// RFC 9728 — Protected Resource Metadata (public, no authentication required)
app.use('/.well-known/oauth-protected-resource', protectedResourceMetadataRoutes);
app.use('/api/rfc9728', protectedResourceMetadataRoutes);

// OAS fragment — public, no authentication required
app.use('/api/oas', require('./routes/oas'));

// Import OAuth health check and monitoring
const {
    checkOAuthProviderHealth
} = require('./middleware/oauthErrorHandler');
const {
    oauthMonitor
} = require('./utils/oauthMonitor');
const {
    logger,
    LOG_CATEGORIES
} = require('./utils/logger');
const oauthConfig = require('./config/oauth');

// Enhanced health check endpoint with comprehensive OAuth monitoring
app.get('/health', async (req, res) => {
    const startTime = Date.now();

    const healthStatus = {
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        service: 'demo-api-server',
        components: {
            api: 'healthy'
        }
    };

    // Check OAuth provider health with monitoring
    try {
        const oauthHealth = await checkOAuthProviderHealth(oauthConfig);
        const oauthMetrics = oauthMonitor.getMetrics();

        healthStatus.components.oauth_provider = oauthHealth.healthy ? 'healthy' : 'unhealthy';
        healthStatus.components.oauth_details = {
            ...oauthHealth,
            metrics: {
                total_requests: oauthMetrics.totalRequests,
                success_rate: oauthMetrics.successRate,
                average_response_time: Math.round(oauthMetrics.averageResponseTime),
                circuit_breaker_open: oauthMetrics.circuitBreaker.isOpen,
                health_status: oauthMetrics.healthStatus,
                recent_errors: oauthMetrics.recentErrors.slice(0, 3) // Last 3 errors
            }
        };

        // Determine overall health based on OAuth metrics
        if (!oauthHealth.healthy || oauthMetrics.healthStatus === 'critical') {
            healthStatus.status = 'unhealthy';
        } else if (oauthMetrics.healthStatus === 'degraded' || oauthMetrics.healthStatus === 'unhealthy') {
            healthStatus.status = 'degraded';
        }

    } catch (error) {
        healthStatus.components.oauth_provider = 'unhealthy';
        healthStatus.components.oauth_error = error.message;
        healthStatus.status = 'unhealthy';

        logger.error(LOG_CATEGORIES.PROVIDER_HEALTH, 'Health check failed for OAuth provider', {
            error_message: error.message,
            error_code: error.code
        });
    }

    const responseTime = Date.now() - startTime;
    healthStatus.response_time_ms = responseTime;

    // Log health check results
    logger.debug(LOG_CATEGORIES.PROVIDER_HEALTH, 'Health check completed', {
        overall_status: healthStatus.status,
        oauth_status: healthStatus.components.oauth_provider,
        response_time_ms: responseTime
    });

    const statusCode = healthStatus.status === 'healthy' ? 200 :
        healthStatus.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
});

// Start periodic OAuth monitoring (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
    oauthMonitor.startPeriodicHealthCheck();
}

// Root endpoint for API-only mode (Docker deployment)
app.get('/', (req, res) => {
    res.json({
        message: 'Banking API Server',
        version: '1.0.0',
        endpoints: ['/api/auth', '/api/users', '/api/accounts', '/api/transactions', '/api/admin'],
        mode: 'api-only'
    });
});

// Redirect /login requests to frontend
app.get('/login', (req, res) => {
    const frontendUrl = process.env.REACT_APP_CLIENT_URL || process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000';
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const redirectUrl = queryString ? `${frontendUrl}/?${queryString}` : `${frontendUrl}/`;
    res.redirect(redirectUrl);
});

// Import OAuth error handler
const {
    oauthErrorHandler
} = require('./middleware/oauthErrorHandler');

// ─── Banking MCP Proxy ────────────────────────────────────────────────────────
// Proxies tool calls from the React UI to the demo_mcp_server WebSocket.
// Shared client: services/mcpWebSocketClient.js. Inspector: routes/mcpInspector.js.
//
// When MCP_SERVER_RESOURCE_URI is configured, the Backend-for-Frontend (BFF) performs an RFC 8693
// token exchange before calling the MCP server. This produces a delegated token
// with `act: { client_id: <bff> }` and a scope narrowed to what the tool needs,
// scoped to the MCP server audience — the user's raw token never leaves the Backend-for-Frontend (BFF).

const {
    resolveMcpAccessTokenWithEvents,
    buildSessionPreviewTokenEvents,
    buildTokenEvent,
} = require('./services/agentMcpTokenService');

// PingOne management tools — routed to the hosted PingOne MCP server (HTTP) when mcp_use_pingone_server flag is ON.
// These tools bypass RFC 8693 token exchange (the http adapter authenticates with a worker client_credentials token).
// Tool names are the hosted PingOne MCP server's camelCase identifiers (from tools/list).
const PINGONE_ADMIN_TOOLS = new Set([
    'listApplications', 'getApplication', 'createApplication', 'updateApplication', 'deleteApplication',
    'listEnvironments', 'getEnvironment', 'updateEnvironment',
    'getEnvironmentServices', 'updateEnvironmentServices',
    'listPopulations', 'getPopulation', 'createPopulation', 'updatePopulation',
]);
const mcpToolAuthorizationService = require('./services/mcpToolAuthorizationService');
const {
    mcpCallTool,
    getSessionAccessToken,
    getMcpServerUrl
} = require('./services/mcpWebSocketClient');
const {
    callToolLocal
} = require('./services/mcpLocalTools');
const {
    introspectToken
} = require('./middleware/tokenIntrospection');
const mcpFlowSseHub = require('./services/mcpFlowSseHub');
const { buildSsePayload } = require('./services/sseCorrelation');
const http2McpBridge = require("./services/http2McpBridge");
const mcpGatewayClient = require('./services/mcpGatewayClient');
const mcpPingOneHttpAdapter = require('./services/mcpPingOneHttpAdapter');
const { recordToolCall: recordMcpToolCall } = require('./services/mcpToolAuditStore');

// GET /api/mcp/tool/events?trace=<uuid> — Server-Sent Events for live MCP tool pipeline phases
app.get('/api/mcp/tool/events', (req, res) => {
    mcpFlowSseHub.handleSseGet(req, res);
});


// POST /api/mcp/scope-upgrade — RFC 8693 token exchange for write scope.
// Called by the UI consent modal after the user approves a scope upgrade.
// Stores the resulting write-scoped token in session.mcpWriteToken for subsequent tool calls.
app.post('/api/mcp/scope-upgrade', express.json(), requireSession, async (req, res) => {
    try {
        const { token, tokenEvents } = await resolveMcpAccessTokenWithEvents(req, 'create_transfer');
        if (!token) {
            return res.status(403).json({
                error: 'scope_upgrade_failed',
                message: 'Token exchange did not return a write-scoped token.',
                tokenEvents,
            });
        }
        req.session.mcpWriteToken = token;
        await new Promise((resolve, reject) =>
            req.session.save(err => err ? reject(err) : resolve())
        );
        return res.json({ ok: true, tokenEvents });
    } catch (err) {
        console.error('[/api/mcp/scope-upgrade] Exchange failed:', err.message);
        return res.status(500).json({ error: 'scope_upgrade_failed', message: err.message });
    }
});
/**
 * Publish token events to SSE hub for real-time Token Chain updates.
 * @param {string} flowTraceId - Trace ID for SSE subscription
 * @param {Array} tokenEvents - Array of token events to publish
 */
function publishTokenEventsToSse(flowTraceId, tokenEvents) {
  if (!flowTraceId || !Array.isArray(tokenEvents)) return;
  for (const event of tokenEvents) {
    if (event && typeof event === 'object') {
      mcpFlowSseHub.publish(flowTraceId, buildSsePayload('token-event', event));
    }
  }
}

const { publishMcpResultToSse } = require('./services/mcpSsePublisher');

const { runMcpToolPipeline } = require('./services/mcpToolPipeline');
const { createPendingDecision: _createPendingDecision } = require('./routes/mcpDecisionPolling');
const _hitlServiceClient = require('./services/hitlServiceClient');
const { decodeJwtClaims: _decodeJwtClaims } = require('./services/agentMcpTokenService');
const { setPipelineDeps: _setBffPipelineDeps } = require('./services/bffMcpToolExecutor');

// Scenario 5 — durable compliance trail for BFF-side preflight authorize
// decisions (deny / step-up / HITL, incl. the Scenario 1 group-deny). These
// never reach the MCP gateway, so the pipeline records them here directly.
// Best-effort: auditing must never break a tool call.
const _mcpAuditStoreCompliance = require('./services/lmdb/mcpAuditStore.lmdb');
function _recordComplianceAudit(event) {
  try { _mcpAuditStoreCompliance.append(event); }
  catch (err) { console.warn('[compliance-audit] append failed:', err && err.message); }
}

// Wire the full pipeline deps into bffMcpToolExecutor so agent-path tool calls
// (LangGraph reason loop → executeBffTool) go through runMcpToolPipeline with
// token exchange, HITL, PingOne Authorize, and SSE publishing — same as the
// chip/direct path at POST /api/mcp/tool.
_setBffPipelineDeps({
  resolveMcpAccessTokenWithEvents,
  evaluateMcpFirstToolGate: (a) => mcpToolAuthorizationService.evaluateMcpFirstToolGate(a),
  introspectToken,
  getSessionAccessToken,
  callToolLocal,
  mcpCallTool,
  callToolViaGateway: (url, tok, t, p, o) => mcpGatewayClient.callToolViaGateway(url, tok, t, p, o),
  http2Bridge: http2McpBridge,
  pingoneAdapter: mcpPingOneHttpAdapter,
  buildTokenEvent,
  mcpNoBearerResponse,
  createPendingDecision: _createPendingDecision,
  createHitlChallenge: (payload, corr) => _hitlServiceClient.createChallenge(payload, corr),
  decodeAgentId: (tok) => {
    const act = _decodeJwtClaims(tok)?.claims?.act;
    return act && typeof act === 'object'
      ? String(act.client_id || act.sub || '') || undefined
      : undefined;
  },
  recordMcpToolCall,
  recordComplianceAudit: _recordComplianceAudit,
  publishMcpResultToSse: (id, a) => publishMcpResultToSse(id, a),
  publishTokenEventsToSse: (id, evs) => publishTokenEventsToSse(id, evs),
  // Publish a pipeline phase milestone to the flow SSE hub for a given trace.
  // The agent path (executeBffTool) binds a per-call `emit` from this using the
  // request's flowTraceId, so the compliance checklist lights up the same phase
  // steps the chip/direct path (POST /api/mcp/tool) already shows.
  publishPhaseToSse: (id, payload) => { if (id) mcpFlowSseHub.publish(id, payload); },
  appEventLog: (cat, lvl, msg, meta) => appEventService.logEvent(cat, lvl, msg, meta),
  emit: () => {},  // fallback no-op; executeBffTool binds a trace-aware emit per call
  config: {
    get introspectionConfigured() { return !!process.env.PINGONE_INTROSPECTION_ENDPOINT; },
    get useGateway() { return !!(process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url')); },
    get gatewayHttpUrl() { return mcpGatewayClient.getMcpGatewayHttpUrl(); },
    get mcpUrl() { return getMcpServerUrl(); },
    get mcpServerUrlEnv() { return process.env.MCP_SERVER_URL; },
    get useHttp2() {
      const gw = process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url');
      if (gw) return false;
      const u = getMcpServerUrl();
      return u.startsWith('http://') || u.startsWith('https://');
    },
    get pingoneAdminEnabled() { return configStore.get('mcp_use_pingone_server') === 'true'; },
    pingoneAdminTools: PINGONE_ADMIN_TOOLS,
  },
});

/**
 * Render a pipeline Outcome to the Express response. The ONLY res.* site for
 * the MCP tool route (ADR-0004). HTTP/2 streaming is the one special case.
 * Note: the pipeline already self-publishes token events to the SSE hub
 * internally (live Token Chain). `outcome.tokenEvents` is a read-only mirror
 * for inspection/debugging — this shell must NOT re-publish it (doing so
 * double-emits to the live Token Chain). renderOutcome only writes the HTTP
 * response body; SSE side-channel ownership stays in runMcpToolPipeline.
 */
function renderOutcome(res, outcome) {
  if (outcome.kind === 'result' && outcome.stream) {
    res.setHeader('Content-Type', 'application/stream+json; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ type: 'result', data: outcome.body.result, tokenEvents: outcome.body.tokenEvents }) + '\n');
    res.write(JSON.stringify({ type: 'stream_close', status: 'success' }) + '\n');
    return res.end();
  }
  return res.status(outcome.httpStatus).json(outcome.body);
}

// POST /api/mcp/tool — call a banking MCP tool
app.post('/api/mcp/tool', express.json(), requireSession, async (req, res, next) => {
  // Defense-in-depth: scrub any JWT-shaped string from EVERY json response on
  // this route (tokenEvents success + all error/expiry paths) without editing
  // each res.json call site — keeps the §1-protected gate/branch logic byte-for-
  // byte unchanged. No raw token flows here today (tokenEvents carry decoded,
  // sanitized claims only); this matches the documented /identity+/accounts+
  // /transactions scrub contract.
  const _origJson = res.json.bind(res);
  res.json = (body) => _origJson(scrubRawJwts(body));
  try {
    // Log incoming request details for debugging 400 errors
    const startTime = Date.now();
    const userAgent = req.headers['user-agent'] || 'unknown';
    const contentType = req.headers['content-type'] || 'unknown';
    const contentLength = req.headers['content-length'] || 'unknown';

    console.log('[/api/mcp/tool] REQUEST: userAgent=%s contentType=%s contentLength=%s sessionID=%s',
        userAgent, contentType, contentLength, req.sessionID ? `${req.sessionID.substring(0, 8)}...` : 'none');

    // Log request body (safely) for debugging
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('[/api/mcp/tool] REQUEST BODY: %j', {
            keys: Object.keys(req.body),
            hasTool: 'tool' in req.body,
            toolType: typeof req.body.tool,
            toolValue: req.body.tool,
            hasParams: 'params' in req.body,
            paramsKeys: req.body.params ? Object.keys(req.body.params) : null,
            hasFlowTraceId: 'flowTraceId' in req.body
        });
    } else {
        console.log('[/api/mcp/tool] REQUEST BODY: empty or undefined');
    }
    // Defensive re-parse: the global express.json() may not have
    // buffered the body by the time this route handler runs.
    // DO NOT attempt to re-read the request stream — this causes memory leaks when the stream
    // doesn't end properly. The request stream has been fully consumed by middleware already.
    let parsedBody = req.body || {};
    // If req.body is unavailable, it's likely a middleware parsing error — proceed with empty body.
    // The 400 response below will catch this as missing tool and return an error to the client.
    if (!parsedBody.tool && req.readableLength > 0) {
        // Stream already consumed by middleware. Attempting to re-read causes hangs and memory leaks.
        // Log this rare condition and proceed with what middleware provided.
        console.warn('[/api/mcp/tool] Middleware did not parse body, but stream claims data. Using middleware result.');
    }
    const {
        tool,
        params,
        flowTraceId: bodyFlowTrace
    } = parsedBody;
    const useCaseId = typeof parsedBody.useCaseId === 'string' ? parsedBody.useCaseId.trim() : '';
    const flowTraceId = typeof bodyFlowTrace === 'string' ? bodyFlowTrace.trim() : '';

    if (!tool || typeof tool !== 'string') {
        const bodyKeys = Object.keys(parsedBody);
        const userAgent = req.headers['user-agent'] || 'unknown';
        const contentType = req.headers['content-type'] || 'unknown';
        console.error('[/api/mcp/tool] 400: tool_name_required - body keys=[%s] readableLength=%d contentType=%s userAgent=%s',
            bodyKeys.join(','), req.readableLength, contentType, userAgent);
        console.error('[/api/mcp/tool] 400: parsedBody=%j', parsedBody);
        return res.status(400).json({
            error: 'tool_name_required',
            message: `tool name is required. Received body keys: [${bodyKeys.join(', ') || 'none'}]`,
            debug: {
                receivedKeys: bodyKeys,
                readableLength: req.readableLength,
                contentType,
                hasTool: 'tool' in parsedBody,
                toolType: typeof parsedBody.tool,
                toolValue: parsedBody.tool
            }
        });
    }

    if (flowTraceId) {
        if (mcpFlowSseHub.ensurePostTrace(flowTraceId, req.sessionID) !== 'ok') {
            return res.status(403).json({
                error: 'invalid_flow_trace',
                message: 'flowTraceId is not valid for this session.',
            });
        }
    }

    const emit = (payload) => {
        if (flowTraceId) {
            mcpFlowSseHub.publish(flowTraceId, {
                ...payload,
                tool: payload.tool || tool
            });
        }
    };

    if (flowTraceId) {
        let traceEnded = false;
        const endFlowTraceOnce = () => {
            if (traceEnded) return;
            traceEnded = true;
            mcpFlowSseHub.endTrace(flowTraceId);
        };
        res.on('finish', endFlowTraceOnce);
        res.on('close', endFlowTraceOnce);
    }

    emit({
        phase: 'request_accepted'
    });

    const _gwEnabled = !!(process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url'));
    const gatewayUrl = _gwEnabled ? mcpGatewayClient.getMcpGatewayHttpUrl() : null;
    const ctx = {
      tool, params, flowTraceId, startTime, req,
      deps: {
        resolveMcpAccessTokenWithEvents,
        evaluateMcpFirstToolGate: (a) => mcpToolAuthorizationService.evaluateMcpFirstToolGate(a),
        // Session-token introspection (RFC 7662). The session token is the USER's
        // access token, minted for the enduser custom resource. The generic Worker
        // gets active:false from PingOne for it; a client introspecting its OWN
        // token gets active:true. So when the token was issued to the user app we
        // recognize, self-introspect with that app's creds (CLIENT_SECRET_POST).
        // Any other issuer falls back to the Worker (cross-client) path unchanged.
        introspectToken: (token) => {
          const issuerClientId = _decodeJwtClaims(token)?.claims?.client_id;
          if (issuerClientId
            && issuerClientId === process.env.PINGONE_USER_CLIENT_ID
            && process.env.PINGONE_USER_CLIENT_SECRET) {
            return introspectToken(token, {
              clientId: process.env.PINGONE_USER_CLIENT_ID,
              clientSecret: process.env.PINGONE_USER_CLIENT_SECRET,
              authMethod: 'post',
            });
          }
          return introspectToken(token);
        },
        getSessionAccessToken,
        callToolLocal,
        mcpCallTool,
        callToolViaGateway: (url, tok, t, p, o) => mcpGatewayClient.callToolViaGateway(url, tok, t, p, o),
        http2Bridge: http2McpBridge,
        pingoneAdapter: mcpPingOneHttpAdapter,
        buildTokenEvent,
        mcpNoBearerResponse,
        createPendingDecision: _createPendingDecision,
        // Canonical HITL service (3009) — single store for BFF + gateway.
        createHitlChallenge: (payload, corr) => _hitlServiceClient.createChallenge(payload, corr),
        // Derive the agent actor id (RFC 8693 act.sub) for caller-bound challenges.
        decodeAgentId: (tok) => {
          const act = _decodeJwtClaims(tok)?.claims?.act;
          return act && typeof act === 'object'
            ? String(act.client_id || act.sub || '') || undefined
            : undefined;
        },
        recordMcpToolCall,
        recordComplianceAudit: _recordComplianceAudit,
        publishMcpResultToSse: (id, a) => publishMcpResultToSse(id, a),
        publishTokenEventsToSse: (id, evs) => publishTokenEventsToSse(id, evs),
        appEventLog: (cat, lvl, msg, meta) => appEventService.logEvent(cat, lvl, msg, meta),
        emit,
        config: {
          introspectionConfigured: !!process.env.PINGONE_INTROSPECTION_ENDPOINT,
          useGateway: !!gatewayUrl,
          gatewayHttpUrl: gatewayUrl || null,
          mcpUrl: getMcpServerUrl(),
          mcpServerUrlEnv: process.env.MCP_SERVER_URL,
          useHttp2: !_gwEnabled && (() => { const u = getMcpServerUrl(); return u.startsWith('http://') || u.startsWith('https://'); })(),
          pingoneAdminEnabled: configStore.get('mcp_use_pingone_server') === 'true',
          pingoneAdminTools: PINGONE_ADMIN_TOOLS,
        },
      },
    };

    // Mint intent token BEFORE pipeline so req.intentToken is forwarded to the
    // MCP gateway via X-Intent-Token header (mcpToolPipeline → callToolViaGateway).
    const _itEnabled = configStore.getEffective('ff_intent_token_enabled') !== 'false';
    let _itDecoded = null;
    let _itIntent = tool;
    let _itConf = 0.50;
    if (_itEnabled && req.session?.user?.id) {
      try {
        const { mintIntentToken } = require('./services/intentTokenService');
        const { decodeJwtClaims: _decITFn } = require('./services/agentMcpTokenService');
        const _TOOL_TO_INTENT = {
          // Banking
          get_accounts: 'view_accounts', get_my_accounts: 'view_accounts',
          get_balance: 'view_balance', get_account_balance: 'view_balance',
          get_transactions: 'view_transactions', get_my_transactions: 'view_transactions',
          create_transfer: 'transfer', create_deposit: 'deposit', create_withdrawal: 'withdraw',
          get_sensitive_account_details: 'view_sensitive_account',
          update_contact_email: 'update_profile', request_fee_waiver: 'request_waiver',
          // Investment
          get_investment_accounts: 'view_investments', get_investment_balance: 'view_investments',
          get_portfolio_summary: 'view_investments', get_investment_transactions: 'view_investments',
          // Healthcare
          view_records: 'view_records', view_coverage: 'view_coverage',
          list_appointments: 'list_appointments', book_appointment: 'book_appointment',
          release_records: 'release_records', show_health_record: 'view_records',
          // Retail
          list_orders: 'list_orders', order_status: 'list_orders',
          rewards_balance: 'view_rewards', checkout: 'checkout',
          show_large_purchase: 'list_orders',
          // Sporting-goods
          list_gear: 'list_gear', list_rentals: 'list_rentals',
          gear_order_status: 'gear_order', loyalty_balance: 'view_rewards',
          extend_rental: 'extend_rental', show_gear_order: 'list_gear',
          // Workforce
          view_benefits: 'view_benefits', pto_balance: 'pto_balance',
          list_expenses: 'view_expenses', submit_expense: 'submit_expense',
          request_time_off: 'request_time_off', show_expense_report: 'view_expenses',
          // Mortgage
          show_mortgage: 'view_mortgage',
        };
        _itIntent = _TOOL_TO_INTENT[tool] || tool;
        _itConf = _TOOL_TO_INTENT[tool] ? 0.97 : 0.50;
        const { token: _it } = mintIntentToken({
          userId: req.session.user.id,
          sessionId: req.session.id,
          prompt: tool,
          intent: _itIntent,
          confidence: _itConf,
          vertical: req.body?.vertical || 'banking',
        });
        req.intentToken = _it;
        _itDecoded = _decITFn(_it);
        console.log('[mcp/tool] Intent Token minted: intent=%s confidence=%s tool=%s', _itIntent, _itConf, tool);
        appEventService.logEvent('intent_token', 'info', `Intent Token minted: ${_itIntent}`, {
          metadata: { intent: _itIntent, confidence: _itConf, tool, userId: req.session.user.id },
        });
      } catch (_itErr) {
        console.warn('[mcp/tool] Intent token minting failed (non-fatal):', _itErr.message);
      }
    }

    const outcome = await runMcpToolPipeline(ctx);

    // Prepend intent token display event to the Token Chain.
    if (_itDecoded && outcome.body && Array.isArray(outcome.body.tokenEvents)) {
      const _itEvent = buildTokenEvent(
        'intent-token',
        'Intent Token — prompt bound at origin (BFF-minted)',
        'active',
        _itDecoded,
        `The BFF extracted intent "${_itIntent}" (confidence ${_itConf}) from the tool invocation and minted ` +
          'a cryptographically signed Intent Token (HMAC-SHA256). The token\'s permitted_tools claim lists ' +
          'the MCP tools this intent is allowed to invoke. The MCP gateway validates this binding before ' +
          'forwarding any tool call — preventing the agent from invoking tools outside the stated intent.',
        {
          rfc: 'draft-ietf-oauth-intent-token',
          intent: _itIntent,
          confidence: _itConf,
          permitted_tools: _itDecoded?.claims?.permitted_tools ?? [],
        }
      );
      outcome.body.tokenEvents = [_itEvent, ...outcome.body.tokenEvents];
    }

    // Stamp useCaseId on chip-path token events (A2.2).
    // Derive from tool name if the caller didn't supply one.
    // stampUseCaseId never overwrites a launcher-supplied tag.
    const _chipUseCaseId = useCaseId || deriveUseCaseId(tool, params, req.body?.vertical);
    if (_chipUseCaseId && outcome.body && Array.isArray(outcome.body.tokenEvents)) {
      stampUseCaseId(outcome.body.tokenEvents, _chipUseCaseId);
    }

    return renderOutcome(res, outcome);
  } catch (err) {
    next(err);
  }
});

// ── Static file serving ──────────────────────────────────────────────────────
// Express serves the React build directly.
{
    const buildPath = path.join(__dirname, '..', 'demo_api_ui', 'build');
    const docsPath = path.join(__dirname, '..', 'docs');
    const fs = require('fs');

    // Serve docs directory for Postman collections and documentation
    if (fs.existsSync(docsPath)) {
        app.use('/docs', express.static(docsPath));
        console.log('[static] Serving docs from', docsPath);
    }

    // Serve public test pages (e.g. /pinggateway-test.html)
    const publicPath = path.join(__dirname, 'public');
    if (fs.existsSync(publicPath)) {
        app.use(express.static(publicPath));
        console.log('[static] Serving public from', publicPath);
    }

    if (fs.existsSync(buildPath)) {
        app.use(express.static(buildPath));
        // SPA fallback — serve index.html for all non-API routes.
        // Must not be cached so browsers always fetch the latest asset hashes.
        // Paths with a file extension that weren't served by express.static don't exist — 404 them
        // rather than falling through to the SPA (which would show the app instead of an error).
        app.get('*', (req, res) => {
            if (/\.[^\/]+$/.test(req.path)) {
                return res.status(404).send('Not Found');
            }
            res.set('Cache-Control', 'no-store');
            res.sendFile(path.join(buildPath, 'index.html'));
        });
        console.log('[static] Serving React build from', buildPath);
    } else {
        console.warn('[static] React build not found at', buildPath, '— run: cd demo_api_ui && npm run build');
        // Friendly message for unbuilt frontend
        app.get('*', (req, res) => {
            if (req.path.startsWith('/api')) return res.status(404).json({
                error: 'not_found'
            });
            res.status(503).send(`
        <html><body style="font-family:sans-serif;padding:2rem">
          <h2>Frontend not built</h2>
          <p>Run <code>cd demo_api_ui && npm run build</code> then restart the server.</p>
          <p>Or run the dev server: <code>cd demo_api_ui && npm start</code> (port 3000)</p>
        </body></html>
      `);
        });
    }
}

// POST /api/mcp/elicit/response — Handle user response to an elicitation form or URL dialog
// Called by the browser UI when user submits form (form mode) or consents to open URL (URL mode)
app.post('/api/mcp/elicit/response', express.json(), requireSession, (req, res) => {
  try {
    const { elicitationId, action, content } = req.body;

    if (!elicitationId || !action) {
      return res.status(400).json({
        error: 'missing_elicitation_params',
        message: 'elicitationId and action are required'
      });
    }

    if (!['accept', 'decline', 'cancel'].includes(action)) {
      return res.status(400).json({
        error: 'invalid_action',
        message: 'action must be one of: accept, decline, cancel'
      });
    }

    // Resolve the pending elicitation promise in mcpWebSocketClient
    const { resolveElicitation } = require('./services/mcpWebSocketClient');
    const elicitationResponse = { action };
    if (action === 'accept' && content) {
      elicitationResponse.content = content;
    }

    resolveElicitation(elicitationId, elicitationResponse);
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/mcp/elicit/response] Error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Sentry must capture errors before our handlers turn them into JSON responses.
// No-op unless SENTRY_DSN is set (see instrument.js).
if (process.env.SENTRY_DSN) {
    require('@sentry/node').setupExpressErrorHandler(app);
}

// OAuth error handling middleware (should be before general error handler)
app.use(oauthErrorHandler);

// General error handling middleware
app.use((err, req, res, _next) => {
    console.error('Error occurred for path:', req.path);
    console.error('Error details:', err.message);
    if (process.env.NODE_ENV !== 'production') {
        console.error('Full stack:', err.stack);
    }
    res.status(500).json({
        error: 'internal_server_error',
        error_description: 'An internal server error occurred',
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method
    });
});

// WR-21: In production, transient background rejections (startup validators,
// audit loggers, etc.) must not crash the server. Log and continue.
// In development/test keep the hard exit so bugs surface loudly.
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    process.exit(1);
});

/**
 * Background startup tasks — run AFTER the vault is loaded into configStore
 * and the server is listening. All tasks are fire-and-forget; failures are
 * logged as warnings and never block requests (WR-22/WR-25).
 */
async function runBackgroundStartupTasks() {
    // ── LMDB OAuth endpoint sync ──────────────────────────────────────────────
    // Sync OAuth endpoints from .env into LMDB. If LMDB has stale cached values
    // (e.g., old authz-server:9001 from a prior run), overwrites them with correct
    // .env values so LMDB stays in sync and is authoritative going forward.
    try {
        const { syncOAuthEndpointsToLmdb } = require('./services/configStore');
        await syncOAuthEndpointsToLmdb();
    } catch (err) {
        console.warn('[lmdb-sync] OAuth endpoint sync failed (non-fatal):', err.message);
    }

    // ── Credential rotation detector ─────────────────────────────────────────
    // Warns when a non-bootstrap secret key has a different value in LMDB vs .env.
    // LMDB wins for these keys (Vault > LMDB > .env), so a rotated .env credential
    // is silently ignored until the old LMDB entry is overwritten via App Config.
    try {
        const { detectRotatedCredentials } = require('./services/configStore');
        const warnings = detectRotatedCredentials();
        for (const w of warnings) console.warn(w);
    } catch (err) {
        console.warn('[config-rotation] check failed (non-fatal):', err.message);
    }

    // ── Redirect-URI guard ────────────────────────────────────────────────────
    // Silently checks (and if missing, patches) the OAuth apps' redirect_uri
    // allowlists in PingOne using the management worker token.
    // ── PingOne worker-credential preflight ──────────────────────────────────
    // The management (worker) token is the single dependency behind the steps
    // below + delegation emails + admin lookups. Validate it ONCE here with a
    // clear, actionable verdict instead of letting each consumer 400/403 on its
    // own. Non-blocking by default; PINGONE_PREFLIGHT_STRICT=true exits on a real
    // misconfig (a transient network blip is never fatal).
    try {
        const { runWorkerTokenPreflight } = require('./services/pingOneWorkerPreflight');
        const pf = await runWorkerTokenPreflight();
        if (!pf.ok && pf.fatal) {
            console.error('[pingone-preflight] Refusing to start (PINGONE_PREFLIGHT_STRICT): ' + pf.message);
            process.exit(1);
        }
    } catch (err) {
        console.warn('[pingone-preflight] Skipped (non-fatal):', err.message);
    }

    try {
        const { ensureAllRedirectUris } = require('./services/pingoneAppConfigService');
        await ensureAllRedirectUris();
    } catch (err) {
        console.warn('[redirect-uri-guard] Skipped —', err.message);
    }

    // ── PingOne Authorize cold-start warmup ──────────────────────────────────
    // Open the worker-token + TLS connection to PingOne Authorize now, so the
    // first decision after this (re)start doesn't pay the cold connect — that
    // latency is what intermittently trips the "Demo Authorize" degraded badge
    // on the agent panel. No-op in simulated mode / when unconfigured.
    // Fire-and-forget: warming is best-effort and must not delay the boot tasks
    // below (persona roles, FIDO2 RP bootstrap).
    require('./services/pingOneAuthorizeService')
        .warmup({ force: true })
        .then((w) => console.log('[authz-warmup] boot warm:', JSON.stringify(w)))
        .catch((err) => console.warn('[authz-warmup] boot warm error (non-fatal):', err.message));

    // ── Live connectivity probes ──────────────────────────────────────────────
    // MCP Gateway health check + P1AZ decision endpoint existence check.
    // Non-fatal: warns loudly but never blocks startup.
    try {
        const { runStartupHealthProbes } = require('./services/startupHealthProbe');
        await runStartupHealthProbes();
    } catch (err) {
        console.warn('[startup-probe] error (non-fatal):', err.message);
    }

    // ── PingOne config validator ──────────────────────────────────────────────
    // Validates resource servers + scopes; auto-creates missing scopes.
    // Runs whenever management worker credentials are present.
    // Opt-out: PINGONE_VALIDATE_ON_STARTUP=false
    try {
        const { runStartupValidation } = require('./services/pingoneStartupValidator');
        await runStartupValidation();
    } catch (err) {
        console.warn('[pingone-startup] Validation error (non-fatal):', err.message);
    }

    // Hardening: ensure the demo personas carry the demo admin role assignments —
    // PingOne denies interactive Management-API logins for users with no roles.
    // Non-blocking; opt out with PERSONA_ROLE_HARDEN_ON_STARTUP=false.
    try {
        const { ensureDemoPersonaRoles } = require('./services/demoPersonaRoleHardening');
        await ensureDemoPersonaRoles();
    } catch (err) {
        console.warn('[persona-roles] error (non-fatal):', err.message);
    }

    // Bootstrap: the FIDO2 policy relying-party id must match the app's serving
    // origin or the browser rejects passkey registration ("'rp.id' cannot be
    // used with the current origin"). PingOne defaults rp.id to its own domain,
    // so set it to this deployment's host. Non-blocking; opt out with
    // FIDO2_RP_BOOTSTRAP=false.
    if (process.env.FIDO2_RP_BOOTSTRAP !== 'false') {
        try {
            const configStore = require('./services/configStore');
            const mfaService = require('./services/mfaService');
            const url =
                configStore.getEffective('PUBLIC_APP_URL') ||
                configStore.getEffective('REACT_APP_CLIENT_URL') ||
                process.env.PUBLIC_APP_URL ||
                'https://api.ping.demo:4000';
            let rpId = 'api.ping.demo';
            try { rpId = new URL(url).hostname; } catch (_) { /* keep default */ }
            const r = await mfaService.ensureFido2RelyingParty(rpId);
            console.log(`[fido2-rp] bootstrap rpId=${rpId} policies=${r.count} changed=${r.changed}` +
                (r.policies?.some(p => p.error) ? ` (errors: ${JSON.stringify(r.policies.filter(p => p.error).map(p => p.error))})` : ''));
        } catch (err) {
            console.warn('[fido2-rp] bootstrap error (non-fatal):', err.message);
        }
    }
}

// Only start the server if this file is run directly (not imported for testing)
if (require.main === module) {
    // Phase 269: load encrypted vault entries into configStore BEFORE binding .listen.
    // Skips silently when no secrets.vault exists; fails fast (exit 1) when a vault
    // file is present but VAULT_PASSWORD is unset. Vercel is bypassed automatically.
    // The express() app + session middleware + all route mounts above are byte-for-byte
    // unchanged — only the .listen call is now inside an async startup wrapper.
    (async () => {
        // Capture VAULT_PASSWORD BEFORE loadVaultIntoConfigStore runs — that
        // loader deletes process.env.VAULT_PASSWORD in its finally (Phase 269
        // /proc leak-window shrink). The Helix keyfile migration below needs
        // the password to write the encrypted vault entry, so we hold it in
        // this block scope only (never module scope) for the duration of
        // startup and let it go out of scope when the IIFE returns.
        const _vaultPwForMigration = process.env.VAULT_PASSWORD;
        try {
            const result = await loadVaultIntoConfigStore({});
            if (result.loaded) {
                console.log('[vault] startup load complete — ' + result.entries + ' entries cached');
            }
        } catch (err) {
            console.error('[vault] startup load failed; refusing to start.', err.message);
            process.exit(1);
        }

        // Clear stale OAuth redirect URI values from configStore at startup.
        // These persist across restarts in LMDB and point to old deployments.
        // The comment in oauthRedirectUris.js says they should be "cleared at startup
        // to prevent stale values" — this implements that cleanup.
        // Priority resolution will now skip step 2 (direct configStore values)
        // and use environment variables or request-derived URIs instead.
        try {
            const staleRedirectUriKeys = ['PINGONE_ADMIN_REDIRECT_URI', 'PINGONE_USER_REDIRECT_URI', 'admin_redirect_uri', 'user_redirect_uri'];
            for (const key of staleRedirectUriKeys) {
                const existing = configStore.get(key);
                if (existing) {
                    configStore.deleteRaw(key);
                    console.log(`[startup] Cleared stale redirect URI: ${key}`);
                }
            }
        } catch (err) {
            console.warn('[startup] Could not clear stale redirect URIs (non-fatal):', err.message);
        }

        // One-time Helix key migration: lift the downloaded <agentName>.json
        // keyfile into the encrypted vault + SQLite so the agent "just works"
        // and survives restarts. Idempotent and best-effort — a failure here
        // must NEVER block startup (the helixAgentKeyLoader runtime fallback
        // still resolves the key for the current process).
        try {
            const { migrateHelixKey } = require('./services/helixKeyMigration');
            const { DEFAULT_VAULT_PATH } = require('./services/vaultLoader');
            const agentName = process.env.HELIX_AGENT_ID
                || configStore.get('helix_agent_id') || 'LLM';
            const m = await migrateHelixKey({
                agentName,
                vaultPath: process.env.VAULT_PATH || DEFAULT_VAULT_PATH,
                vaultPassword: _vaultPwForMigration,
            });
            if (m.migrated) {
                console.log(`[startup] Helix key migrated from ${agentName}.json `
                    + `(vault=${m.vaultWritten}, sqlite=${m.sqliteWritten})`);
            }
        } catch (e) {
            console.warn('[startup] Helix key migration skipped:', e.message);
        }

        // Helix configuration check: warn if no API key is resolvable so the
        // operator knows the NL agent will run heuristics-only.
        try {
            const helixKey = configStore.getEffective('helix_api_key');
            if (!helixKey) {
                const agentName = process.env.HELIX_AGENT_ID
                    || configStore.get('helix_agent_id') || 'LLM';
                console.warn(
                    `[startup] ⚠  Helix not configured — natural-language agent will run heuristics-only.\n` +
                    `           To enable: download the Secret API Key for agent "${agentName}" from\n` +
                    `           https://console.pingone.com → AI → Helix → Agents → ${agentName} → Secret API Keys\n` +
                    `           and save it as ${agentName}.json in the repo root, then restart.`
                );
            } else {
                console.log(`[startup] Helix configured (agent: ${configStore.getEffective('helix_agent_id') || 'LLM'})`);
            }
        } catch (e) {
            // non-fatal — configStore may not be ready yet in edge cases
        }

        // ── Source-of-truth config guard ─────────────────────────────────────
        // Fail fast at boot if the service URLs / resource audiences this BFF
        // will use don't match service-topology.json + scope-topology.json
        // (catches the stale-config class — wrong gateway port, audience 401 —
        // before the first request). TOPOLOGY_GUARD=warn downgrades to a warning.
        try {
            require('./services/startupConfigGuard').runStartupConfigGuard();
        } catch (e) {
            console.warn('[STARTUP GUARD] unexpected error (non-fatal):', e.message);
        }

        // Vertical consistency guard: every featurePage vertical's scope + tool
        // must be present across scope-topology.json, or the feature page 403s
        // silently at runtime. VERTICAL_GUARD=warn downgrades to a warning.
        try {
            require('./services/verticalConsistencyGuard').runVerticalConsistencyGuard();
        } catch (e) {
            console.warn('[VERTICAL GUARD] unexpected error (non-fatal):', e.message);
        }

        const fs = require('fs');
        const certDir = path.join(__dirname, '../certs');
        // Prefer explicit env overrides, then mkcert dev names, then k8s secret names (tls.crt/tls.key).
        // The k8s secret mounts as tls.crt/tls.key while mkcert produces api.ping.demo+2.pem —
        // falling back to the k8s names lets the pod start HTTPS so the liveness probe succeeds.
        const _mkcertCrt = path.join(certDir, 'api.ping.demo+2.pem');
        const _mkcertKey = path.join(certDir, 'api.ping.demo+2-key.pem');
        const _k8sCrt    = path.join(certDir, 'tls.crt');
        const _k8sKey    = path.join(certDir, 'tls.key');
        const certFile = process.env.SSL_CRT_FILE ||
          (fs.existsSync(_mkcertCrt) ? _mkcertCrt : _k8sCrt);
        const keyFile  = process.env.SSL_KEY_FILE  ||
          (fs.existsSync(_mkcertKey) ? _mkcertKey : _k8sKey);

        let server;
        if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
            // Single source of truth for the scheme the server actually bound — read by
            // the resource-server tester's loopback probe (resourceServerTesterService.js).
            process.env.BFF_LOOPBACK_SCHEME = 'https';
            const https = require('https');
            server = https.createServer({
                key: fs.readFileSync(keyFile),
                cert: fs.readFileSync(certFile),
            }, app).listen(PORT, () => {
                console.log(`Demo API server (HTTPS) running on https://api.ping.demo:${PORT}`);
                // Check HITL status
                const hitlEnabled = configStore.getEffective('ff_hitl_enabled') !== 'false';
                if (!hitlEnabled) {
                  console.warn('\n⚠️  [SECURITY WARNING] HITL (Human-in-the-Loop) consent enforcement is DISABLED.');
                  console.warn('   → High-value transactions will NOT require human approval.');
                  console.warn('   → Enable it at /admin/config (ff_hitl_enabled: true) or set FF_HITL_ENABLED=true.\n');
                }
            });
        } else {
            server = app.listen(PORT, () => {
                console.log(`Demo API server running on https://api.ping.demo:3001 (local port ${PORT})`);
                console.log('Tip: run mkcert in Demo/certs/ to enable HTTPS (see run-demo.sh)');
                // Check HITL status
                const hitlEnabled = configStore.getEffective('ff_hitl_enabled') !== 'false';
                if (!hitlEnabled) {
                  console.warn('\n⚠️  [SECURITY WARNING] HITL (Human-in-the-Loop) consent enforcement is DISABLED.');
                  console.warn('   → High-value transactions will NOT require human approval.');
                  console.warn('   → Enable it at /admin/config (ff_hitl_enabled: true) or set FF_HITL_ENABLED=true.\n');
                }
                // Validate OAuth endpoints
                const { validateEndpoints } = require('./services/endpointValidator');
                validateEndpoints().then(({ results, errors }) => {
                  if (errors.length > 0) {
                    console.warn('\n⚠️  [ENDPOINT VALIDATION] Some OAuth endpoints are unreachable:');
                    errors.forEach(e => console.warn(`   → ${e}`));
                    console.warn('   → Tool discovery will fail. Check authz server logs and endpoint configuration.\n');
                  }
                  Object.entries(results).forEach(([key, result]) => {
                    if (result.status === 'unconfigured') {
                      console.log(`[Endpoints] ${key}: unconfigured (optional)`);
                    } else if (result.status === 'healthy') {
                      console.log(`[Endpoints] ${key}: ✓ ${result.url}`);
                    } else {
                      console.warn(`[Endpoints] ${key}: ✗ ${result.url} (${result.error})`);
                    }
                  });
                });
            });
        }

        // WR-22/WR-25: Run background startup tasks INSIDE the IIFE's listen
        // callback so they execute only after the vault has loaded into configStore
        // and the server is actually ready. Previously these were bare setImmediate
        // calls at module scope which could fire before loadVaultIntoConfigStore
        // completed, causing false "credentials not configured" warnings.
        setImmediate(() => runBackgroundStartupTasks());
        const lighthouseTask = startLighthouseScheduler();

        // k8s rollout contract: the replacement pod boots while this one is
        // still in its termination grace period, and both mount the same LMDB
        // volume. server.close() alone can hang on keep-alive connections
        // until the kubelet SIGKILLs at 30s — holding the LMDB env open for
        // the new pod's entire boot, which breaks its read transactions
        // ("No transaction to renew") and crashes it. Release the env as soon
        // as the signal arrives and force-exit on a short deadline.
        const shutdown = async (signal) => {
            console.log(`${signal} received, shutting down gracefully...`);
            setTimeout(() => {
                console.warn('[shutdown] connections still draining after 5s — forcing exit');
                process.exit(0);
            }, 5000).unref();
            oauthMonitor.stop();
            if (lighthouseTask) lighthouseTask.stop();
            try { await structuredLogger.close(); } catch (_) { /* exit anyway */ }
            try { require('./services/lmdb/openEnv').closeEnv(); } catch (_) { /* exit anyway */ }
            server.close(() => process.exit(0));
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    })();
}

// Export app as the default (for supertest / existing requires) and attach
// named flags so other modules can do: require('./server').isReplit etc.
module.exports = app;
module.exports.app = app;
module.exports.isProduction = isProduction;
module.exports.isReplit = isReplit;