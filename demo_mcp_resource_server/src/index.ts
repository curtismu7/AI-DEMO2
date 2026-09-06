'use strict';

/**
 * banking-mcp-resource-server — entry point
 *
 * MCP server for ten mock verticals plus investment tools. Runs over WebSocket
 * (same protocol as banking_mcp_server) and HTTP. Validates inbound token aud
 * against MCP_RESOURCE_SERVER_RESOURCE_URI — a comma-separated ACCEPTED list
 * whose first entry is this server's canonical resource URI (in the AI-DEMO2
 * stack: mcp-invest.ping.demo, the PingOne "Demo MCP Invest" resource).
 *
 * Every vertical is served from this server's own SQLite database (src/db/).
 * The invest tools proxy to the BFF instead when BANKING_API_BASE_URL /
 * DEMO_API_BASE_URL is set (src/tools/investToolHandler.ts).
 *
 * HTTP surfaces (same port):
 *   GET  /.well-known/oauth-protected-resource  — RFC 9728 metadata
 *   GET  /health
 *   POST /mcp                                   — MCP JSON-RPC (for PingGateway,
 *                                                 which has no WS listener)
 *   GET  /invest, /banking, /banking/:id        — REST, X-API-Key backend-app
 *                                                 pattern (no OAuth bearer)
 *   GET  /openapi/banking-rest.json             — OpenAPI doc for the above,
 *                                                 for OpenAPI-to-MCP importers
 *
 * Start: MCP_RESOURCE_SERVER_RESOURCE_URI=mcp-invest.ping.demo node dist/index.js
 */

import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import {
  LEGACY_RESOURCE_URI_ENV,
  RESOURCE_URI_ENV,
  resolveAcceptedAudiences,
  resolveResourceUriEnv,
} from './server/acceptedAudiences';

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  requiredScope: string;
  uriTemplate: string;
  templateName: string;
  listTool: string;
}

const RESOURCE_CATALOG: ResourceDef[] = [
  { uri: 'banking://accounts', name: 'Bank Accounts', description: 'All bank accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'banking:read', uriTemplate: 'banking://accounts/{accountId}', templateName: 'Bank Account', listTool: 'list_banking_accounts' },
  { uri: 'healthcare://records', name: 'Patient Records', description: 'All patient records for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'healthcare://records/{recordId}', templateName: 'Patient Record', listTool: 'view_records' },
  { uri: 'government://permits', name: 'Government Permits', description: 'All government permits for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'government://permits/{permitId}', templateName: 'Government Permit', listTool: 'view_permits' },
  { uri: 'manufacturing://work-orders', name: 'Work Orders', description: 'All work orders for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'manufacturing://work-orders/{orderId}', templateName: 'Work Order', listTool: 'view_work_orders' },
  { uri: 'retail://orders', name: 'Retail Orders', description: 'All retail orders for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'retail://orders/{orderId}', templateName: 'Retail Order', listTool: 'list_orders' },
  { uri: 'sporting-goods://gear-orders', name: 'Gear Orders', description: 'All sporting-goods orders for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'sporting-goods://gear-orders/{orderId}', templateName: 'Gear Order', listTool: 'list_gear' },
  { uri: 'university://courses', name: 'Courses', description: 'All courses for the authenticated student', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'university://courses/{courseId}', templateName: 'Course', listTool: 'view_courses' },
  { uri: 'workforce://expenses', name: 'Expenses', description: 'All expense reports for the authenticated employee', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'workforce://expenses/{expenseId}', templateName: 'Expense', listTool: 'list_expenses' },
  { uri: 'anf://orders', name: 'ANF Orders', description: 'All Abercrombie & Fitch orders for the authenticated user', mimeType: 'application/json', requiredScope: 'read', uriTemplate: 'anf://orders/{orderId}', templateName: 'ANF Order', listTool: 'list_anf_orders' },
  { uri: 'investment://accounts', name: 'Investment Accounts', description: 'All investment accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'invest:read', uriTemplate: 'investment://accounts/{accountId}', templateName: 'Investment Account', listTool: 'get_investment_accounts' },
  { uri: 'airlines://bookings', name: 'Airline Bookings', description: 'All airline bookings for the authenticated passenger', mimeType: 'application/json', requiredScope: 'airlines:read', uriTemplate: 'airlines://bookings/{bookingId}', templateName: 'Airline Booking', listTool: 'get_airline_bookings' },
];
import { createServer, IncomingMessage, ServerResponse } from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { filterByScopes } from './tools/toolTypes';
import { ALL_TOOLS, SUPPORTED_SCOPES, dispatch, findTool } from './tools/registry';
import { decodeAndValidate, extractScopes, TokenError } from './server/tokenValidator';
import { isValidLogLevel, emitLogMessage, LoggingState } from './mcpLogging';
import { buildDiscoverResult, SUPPORTED_PROTOCOL_VERSIONS } from './serverDiscover';
import { extractRequestedProtocolVersion, buildUnsupportedProtocolVersionError } from './modernNegotiation';
import fs from 'fs';
import path from 'path';
import { resolvePassenger, listBookings } from './db/airlinesDb';
import { getHoldings, resolveInvestor } from './db/investDb';
import { listAccounts, getAccount } from './db/bankingDb';
import { emitHop } from './transactionHop';
import { register as metricsRegister, mcpMessageDuration } from './metrics';

// ---------------------------------------------------------------------------
// MCP Prompts capability — real, usable templates referencing this server's
// own tools. No live consumer in the banking demo (the chat UI has no
// prompt picker) — built for a client that connects to this server directly,
// same as any other MCP host would.
// ---------------------------------------------------------------------------

interface PromptArgDef {
  name: string;
  description: string;
  required?: boolean;
}

interface PromptDef {
  name: string;
  description: string;
  argsDef: PromptArgDef[];
  build: (args: Record<string, unknown>) => { description: string; messages: Array<{ role: string; content: { type: 'text'; text: string } }> };
}

const PROMPTS: PromptDef[] = [
  {
    name: 'summarize_airline_booking',
    description: 'Summarize an airline booking and current flight status in plain language for the customer.',
    argsDef: [{ name: 'bookingId', description: 'The booking confirmation number', required: true }],
    build: (args) => {
      const bookingId = typeof args.bookingId === 'string' && args.bookingId ? args.bookingId : '(unspecified booking)';
      return {
        description: 'Summarize an airline booking and current flight status in plain language for the customer.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Look up airline booking ${bookingId} using get_airline_bookings, then check its flight with get_flight_status. Summarize the itinerary and current flight status in plain, customer-friendly language — no raw field names.`,
          },
        }],
      };
    },
  },
];

// Security guard: SKIP_TOKEN_SIGNATURE_VALIDATION downgrades JWT signature
// verification to a warning (tokenValidator.ts) and must never run in production.
// Fail fast at startup so a misconfigured deploy can't silently accept forged
// tokens — matches demo_api_server/server.js and demo_mcp_server.
if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true' && process.env.NODE_ENV === 'production') {
  console.error('[invest][FATAL] SKIP_TOKEN_SIGNATURE_VALIDATION=true is not allowed in production. Remove this env var before deploying.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '8081', 10);
const HOST = process.env.HOST || '0.0.0.0';
// The accepted-audience list may be comma-separated (RFC 8693 rollout). The
// FIRST entry is this server's canonical resource URI (RFC 9728 metadata,
// health, logs); the full list feeds aud validation.
const RESOURCE_URI_ENV_VALUE = resolveResourceUriEnv();
const RESOURCE_URI_LIST = resolveAcceptedAudiences(RESOURCE_URI_ENV_VALUE.value, RESOURCE_URI_ENV_VALUE.source);
const RESOURCE_URI = RESOURCE_URI_LIST[0];
// Reading the shared banking name still works, but say so — that is the
// deployment shape T4 exists to retire (shared k8s configmap fanned into this
// server via envFrom).
if (RESOURCE_URI_ENV_VALUE.source === LEGACY_RESOURCE_URI_ENV) {
  console.warn(
    `[demo-mcp-resource-server] WARNING: falling back to '${LEGACY_RESOURCE_URI_ENV}', which is the ` +
    `BANKING MCP server's audience list elsewhere. Set '${RESOURCE_URI_ENV}' for this server instead.`
  );
}
const ACCEPTED_AUDIENCES = RESOURCE_URI_LIST.join(',');
const RESOURCE_NAME = process.env.MCP_SERVER_RESOURCE_NAME || 'Super Banking MCP Server (mcp-resource-server)';

// Startup env validation
if (!RESOURCE_URI_ENV_VALUE.value) {
  console.warn(
    `[demo-mcp-resource-server] WARNING: ${RESOURCE_URI_ENV} is not set — ` +
    `using default '${RESOURCE_URI}'. Token audience validation may fail. ` +
    `Set ${RESOURCE_URI_ENV} in this server's .env`
  );
}

const PINGONE_ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || '';
const PINGONE_REGION = process.env.PINGONE_REGION || 'com';

// ---------------------------------------------------------------------------
// API-key auth (backend-app pattern) — gateway fetches key from vault and sends
// it in X-API-Key. This coexists with the Bearer/WebSocket path above.
// ---------------------------------------------------------------------------
const API_KEY_ENV = (process.env.MCP_RESOURCE_SERVER_API_KEY || '').trim();
let API_KEY: string;
if (API_KEY_ENV) {
  API_KEY = API_KEY_ENV;
} else {
  API_KEY = crypto.randomBytes(24).toString('hex');
  console.warn('[mcp-resource-server] MCP_RESOURCE_SERVER_API_KEY unset — ephemeral key generated. Set it so the gateway can call the /invest HTTP endpoint.');
}
const API_KEY_DIGEST = crypto.createHash('sha256').update(API_KEY, 'utf8').digest();
function apiKeyMatches(presented: string): boolean {
  const d = crypto.createHash('sha256').update(presented, 'utf8').digest();
  return crypto.timingSafeEqual(d, API_KEY_DIGEST);
}

// The banking vertical's seed data has a single subject ('demo-user'), same as
// /invest's resolveInvestor() — the static-key path has no per-user identity,
// so it always serves that one demo subject.
const DEMO_BANKING_SUBJECT = 'demo-user';

// Served at GET /openapi/banking-rest.json so an external OpenAPI-to-MCP
// importer (e.g. a Privilege AI Gateway "Add OpenAPI MCP" app) can point at
// this server's REST banking surface. Read once at startup, not per request.
const BANKING_OPENAPI_SPEC = fs.readFileSync(
  path.join(__dirname, '..', 'openapi', 'banking-rest.openapi.json'),
  'utf8',
);

// SUPPORTED_SCOPES is derived from the tool catalog (tools/registry.ts), so a
// client reading this RFC 9728 metadata always requests a scope that actually
// unlocks tools — 'invest:read' for the invest namespace, 'airlines:read' for
// the SQLite-backed airlines namespace.

/** Cap on a single HTTP MCP request body — a tool call is a few hundred bytes. */
const MAX_MCP_BODY_BYTES = 256 * 1024;

/**
 * Extract a bearer token from an Authorization header. Shared by both
 * transports so the HTTP path can never diverge from the WebSocket one on
 * something as easy to get subtly wrong as header parsing.
 */
function bearerFrom(header: string | string[] | undefined): string {
  const parts = String(header || '').split(' ');
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : '';
}

// ---------------------------------------------------------------------------
// HTTP: RFC 9728 metadata + health + MCP (JSON-RPC over POST)
// ---------------------------------------------------------------------------

// RFC 9728 §5.1: resource_metadata must be a URL the client can fetch, so it is
// built from the request's own host — RESOURCE_URI is the token audience and
// need not be a URL at all.
function resourceMetadataUrl(req: IncomingMessage): string {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}/.well-known/oauth-protected-resource`;
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';

  if (url === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    const asList = PINGONE_ENV_ID
      ? [`https://auth.pingone.${PINGONE_REGION}/${PINGONE_ENV_ID}/as`]
      : [];
    const metadata: Record<string, unknown> = {
      resource: RESOURCE_URI,
      bearer_methods_supported: ['header'],
      scopes_supported: SUPPORTED_SCOPES,
      resource_name: RESOURCE_NAME,
      resource_documentation: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization',
    };
    if (asList.length) metadata.authorization_servers = asList;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify(metadata, null, 2));
    return;
  }

  if (url === '/metrics' && req.method === 'GET') {
    // Prometheus scrape target — unauthenticated, same posture as
    // PingGateway's own /metrics/prometheus/0.0.4.
    metricsRegister.metrics().then((body) => {
      res.writeHead(200, { 'Content-Type': metricsRegister.contentType });
      res.end(body);
    });
    return;
  }

  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'banking-mcp-resource-server',
      uptime: process.uptime(),
      resourceUri: RESOURCE_URI,
      authMethods: ['bearer_token', 'api_key'],
    }));
    return;
  }

  // HTTP MCP — JSON-RPC over POST.
  //
  // The WebSocket transport below is the original one, but PingGateway/IG has no
  // WebSocket listener, so an IG-fronted deployment could not reach these tools
  // at all (its /mcp/invest route proxied to an endpoint that 404'd). This runs
  // the SAME handleMessage as the WS path, so audience validation and the
  // per-tool scope gate are identical by construction, not by duplication.
  if (url === '/mcp' && req.method === 'POST') {
    const token = bearerFrom(req.headers['authorization']);
    if (!token) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="banking-mcp-resource-server", error="invalid_token", error_description="Bearer token required", resource_metadata="${resourceMetadataUrl(req)}"`,
      });
      res.end(JSON.stringify({ error: 'invalid_token', error_description: 'Bearer token required' }));
      return;
    }

    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_MCP_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      // MCP Streamable HTTP transport: the server MAY assign a session id on
      // initialize. Read once `body` is fully accumulated (not `s`, the
      // outbound body) so it's known before the response is written.
      let sessionIdForInitialize: string | undefined;
      try {
        if (JSON.parse(body).method === 'initialize') sessionIdForInitialize = crypto.randomUUID();
      } catch { /* malformed body — handleMessage below reports the parse error */ }

      let replied = false;
      const send = (s: string): void => {
        if (replied) return;
        replied = true;
        // RFC 6750 §3.1: scope violations on HTTP MUST return 403, not 200.
        // WebSocket callers get the JSON-RPC error body unchanged (no HTTP status after handshake).
        let isInsufficientScope = false;
        let scopeHint = '';
        try {
          const parsed = JSON.parse(s);
          if (parsed?.error?.code === -32005) {
            isInsufficientScope = true;
            const d = parsed.error.data;
            const scopes: string[] = d?.requiredScopes ?? (d?.requiredScope ? [d.requiredScope] : []);
            if (scopes.length) scopeHint = `, scope="${scopes.join(' ')}"`;
          }
        } catch { /* ok — malformed body goes through as 200 */ }
        // MCP spec 2026-07-28 Streamable HTTP §Protocol Version Header:
        // UnsupportedProtocolVersionError MUST ride HTTP 400, not 200.
        let isUnsupportedProtocolVersion = false;
        try {
          const parsed = JSON.parse(s);
          isUnsupportedProtocolVersion = parsed?.error?.code === -32022;
        } catch { /* ok — malformed body goes through as 200 */ }
        // RFC 6750 §3.1: an invalid/expired/malformed token MUST return 401,
        // same as the missing-bearer case above — not 200 with the failure
        // buried in the JSON-RPC body. TokenError (tokenValidator.ts) always
        // surfaces as -32001.
        let isInvalidToken = false;
        try {
          const parsed = JSON.parse(s);
          isInvalidToken = parsed?.error?.code === -32001;
        } catch { /* ok — malformed body goes through as 200 */ }
        const sessionHeader = sessionIdForInitialize ? { 'mcp-session-id': sessionIdForInitialize } : {};
        if (isInsufficientScope) {
          res.writeHead(403, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="banking-mcp-resource-server", error="insufficient_scope"${scopeHint}, resource_metadata="${resourceMetadataUrl(req)}"`,
            ...sessionHeader,
          });
        } else if (isUnsupportedProtocolVersion) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...sessionHeader });
        } else if (isInvalidToken) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="banking-mcp-resource-server", error="invalid_token", resource_metadata="${resourceMetadataUrl(req)}"`,
            ...sessionHeader,
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', ...sessionHeader });
        }
        res.end(s);
      };
      handleMessage(body, token, send)
        .then(() => {
          // A notification (e.g. notifications/initialized) produces no response.
          if (!replied) { res.writeHead(202); res.end(); }
        })
        .catch((err) => {
          console.error('[mcp-resource-server] HTTP MCP handler error:', err);
          if (!replied) {
            replied = true;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(rpcError(null, -32603, 'Internal error'));
          }
        });
    });
    return;
  }

  // HTTP + API-key path: backend-app pattern (gateway drops bearer, sends X-API-Key)
  if (url === '/invest' && req.method === 'GET') {
    const presented = req.headers['x-api-key'] as string | undefined;
    if (!presented) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_missing', message: 'X-API-Key header required' }));
      return;
    }
    if (!apiKeyMatches(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_invalid' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Auth-Mechanism': 'api_key',
    });
    // Same portfolio the MCP invest tools serve (data/invest.db), so an
    // out-of-band edit to the DB shows up on both paths.
    const investor = resolveInvestor();
    res.end(JSON.stringify({
      invest: investor && {
        portfolioId: investor.portfolio_id,
        holder: investor.holder,
        totalValue: investor.total_value,
        cashSweep: investor.cash_sweep,
        ytdReturnPct: investor.ytd_return_pct,
        riskProfile: investor.risk_profile,
        holdings: getHoldings(investor.investor_id).map((h) => ({
          symbol: h.symbol, name: h.name, quantity: h.quantity, marketValue: h.market_value,
        })),
      },
      source: 'banking_mcp_resource_server',
      authMechanism: 'X-API-Key (shared secret)',
      note: 'This portfolio was returned because the gateway presented a valid service API key. No OAuth bearer was involved on this hop — the gateway dropped the user token and attached a shared secret from its vault.',
    }, null, 2));
    return;
  }

  // Same backend-app pattern as /invest, for the banking vertical — lets an
  // OpenAPI-to-MCP importer turn these into tools without any bearer plumbing.
  if (url === '/banking' && req.method === 'GET') {
    const presented = req.headers['x-api-key'] as string | undefined;
    if (!presented) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_missing', message: 'X-API-Key header required' }));
      return;
    }
    if (!apiKeyMatches(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_invalid' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Auth-Mechanism': 'api_key' });
    const accounts = listAccounts(DEMO_BANKING_SUBJECT);
    res.end(JSON.stringify({
      accounts,
      count: accounts.length,
      source: 'banking_mcp_resource_server',
      authMechanism: 'X-API-Key (shared secret)',
      note: 'These accounts were returned because the gateway presented a valid service API key. No OAuth bearer was involved on this hop — the gateway dropped the user token and attached a shared secret from its vault.',
    }, null, 2));
    return;
  }

  if (url?.startsWith('/banking/') && req.method === 'GET') {
    const presented = req.headers['x-api-key'] as string | undefined;
    if (!presented) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_missing', message: 'X-API-Key header required' }));
      return;
    }
    if (!apiKeyMatches(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'api_key_invalid' }));
      return;
    }

    const accountId = url.slice('/banking/'.length);
    const account = getAccount(accountId, DEMO_BANKING_SUBJECT);
    res.writeHead(account ? 200 : 404, { 'Content-Type': 'application/json', 'X-Auth-Mechanism': 'api_key' });
    res.end(JSON.stringify(
      account
        ? { found: true, account, source: 'banking_mcp_resource_server', authMechanism: 'X-API-Key (shared secret)' }
        : { found: false, account_id: accountId },
    ));
    return;
  }

  // Static OpenAPI doc for the /banking REST surface above — unauthenticated,
  // same posture as /metrics, so an external importer can fetch it directly.
  if (url === '/openapi/banking-rest.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    res.end(BANKING_OPENAPI_SPEC);
    return;
  }

  res.writeHead(404);
  res.end();
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function rpcError(id: unknown, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}

function rpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

// ---------------------------------------------------------------------------
// MCP message handler
// ---------------------------------------------------------------------------

/**
 * Metrics-observing wrapper — records mcprs_mcp_message_duration_seconds and
 * delegates to the unchanged implementation below. The label is a throwaway
 * best-effort parse purely for the metric; the real parse (with its own
 * error handling) still happens inside the impl exactly as before.
 */
async function handleMessage(
  rawMsg: string,
  token: string,
  send: (s: string) => void,
  loggingState: LoggingState = {},
): Promise<void> {
  let method = 'unknown';
  try {
    const parsed = JSON.parse(rawMsg);
    if (parsed && typeof parsed.method === 'string') method = parsed.method;
  } catch { /* labeled 'unknown'; the real parse below reports the real error */ }
  const endTimer = mcpMessageDuration.startTimer({ method });
  try {
    await handleMessageImpl(rawMsg, token, send, loggingState);
  } finally {
    endTimer();
  }
}

async function handleMessageImpl(
  rawMsg: string,
  token: string,
  send: (s: string) => void,
  // MCP spec: logging capability. On WS this is one box per connection; on
  // HTTP (stateless, one request per handleMessage call) a fresh empty box
  // is passed each time, so logging/setLevel has no effect beyond that
  // single call — an honest limitation of a one-shot transport, not a bug.
  loggingState: LoggingState = {},
): Promise<void> {
  let msg: any;
  try { msg = JSON.parse(rawMsg); } catch { send(rpcError(null, -32700, 'Parse error')); return; }

  const { method, id } = msg;

  if (method === 'initialize') {
    send(rpcResult(id, {
      protocolVersion: '2025-11-25',
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
        logging: {},
        prompts: { listChanged: false },
        completions: {},
      },
      serverInfo: { name: 'banking-mcp-resource-server', version: '1.0.0' },
    }));
    return;
  }

  if (method === 'notifications/initialized') return;

  // MCP spec 2026-07-28: per-request version negotiation. A Modern request
  // declares its version in params._meta instead of an initialize
  // handshake. This server doesn't implement Modern behavior yet — reject
  // cleanly rather than silently running Legacy semantics a Modern caller
  // never agreed to. server/discover is exempt — its whole purpose is
  // answering regardless of what version the caller claims.
  if (method !== 'server/discover') {
    const requestedVersion = extractRequestedProtocolVersion(msg.params);
    if (requestedVersion !== undefined && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)) {
      send(JSON.stringify(buildUnsupportedProtocolVersionError(id, requestedVersion, SUPPORTED_PROTOCOL_VERSIONS)));
      return;
    }
  }

  // MCP spec 2026-07-28: server/discover — servers MUST implement it. Same
  // identity/capabilities as the initialize handler above.
  if (method === 'server/discover') {
    send(rpcResult(id, buildDiscoverResult(
      {
        tools: {},
        resources: { subscribe: false, listChanged: false },
        logging: {},
        prompts: { listChanged: false },
        completions: {},
      },
      { name: 'banking-mcp-resource-server', version: '1.0.0' },
    )));
    return;
  }

  if (method === 'prompts/list') {
    send(rpcResult(id, { prompts: PROMPTS.map(({ name, description, argsDef }) => ({ name, description, arguments: argsDef })) }));
    return;
  }

  if (method === 'prompts/get') {
    const name = msg.params?.name;
    const promptArgs: Record<string, unknown> = msg.params?.arguments || {};
    const prompt = PROMPTS.find((p) => p.name === name);
    if (!prompt) {
      send(rpcError(id, -32602, `Unknown prompt: ${name}`));
      return;
    }
    send(rpcResult(id, prompt.build(promptArgs)));
    return;
  }

  // MCP Completion capability — real autocompletion, scoped to the
  // authenticated caller's own bookings (never a global lookup across
  // passengers). Only bookingId on summarize_airline_booking is wired;
  // anything else gets an empty completion, not an error — the spec treats
  // an unrecognized ref/argument as "nothing to suggest," not a failure.
  if (method === 'completion/complete') {
    const ref = msg.params?.ref;
    const argument = msg.params?.argument;
    let values: string[] = [];
    if (ref?.type === 'ref/prompt' && ref?.name === 'summarize_airline_booking' && argument?.name === 'bookingId') {
      let decoded;
      try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch { decoded = undefined; }
      if (decoded) {
        const match = resolvePassenger(decoded.sub);
        const prefix = String(argument.value ?? '').toUpperCase();
        if (match) {
          values = listBookings(match.passenger.passenger_ref)
            .map((b) => b.confirmation_number)
            .filter((cn) => cn.toUpperCase().startsWith(prefix))
            .slice(0, 100);
        }
      }
    }
    send(rpcResult(id, { completion: { values, total: values.length, hasMore: false } }));
    return;
  }

  if (method === 'logging/setLevel') {
    const level = msg.params?.level;
    if (!isValidLogLevel(level)) {
      send(rpcError(id, -32602, 'Invalid params: level must be one of the RFC 5424 severities'));
      return;
    }
    loggingState.level = level;
    send(rpcResult(id, {}));
    return;
  }

  if (method === 'tools/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const tools = filterByScopes(ALL_TOOLS, scopes).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiredScopes: t.requiredScopes,
      readOnly: t.readOnly,
      ...(t.intentHints ? { intentHints: t.intentHints } : {}),
    }));
    send(rpcResult(id, { tools }));
    return;
  }

  if (method === 'tools/call') {
    const toolName: string = msg.params?.name || '';
    const args: Record<string, unknown> = msg.params?.arguments || {};

    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }

    // Per-tool scope check
    const tool = findTool(toolName);
    if (!tool) {
      send(rpcResult(id, { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }));
      return;
    }

    const scopes = extractScopes(decoded);
    const hasScopes = tool.requiredScopes.every(
      (s) => scopes.includes(s) || scopes.includes('*') || scopes.includes('*'),
    );
    if (!hasScopes) {
      send(rpcError(id, -32005, `Insufficient scope for tool '${toolName}'`, {
        requiredScopes: tool.requiredScopes,
        availableScopes: scopes,
      }));
      return;
    }

    // Transaction-trace hop — forwarded by the gateway in msg.params.correlationId
    // (same field it reads via extractCorrelationId). No-ops without one (e.g. a
    // caller that bypasses the gateway), matching emitHop's own fail-open contract.
    const correlationId = typeof msg.params?.correlationId === 'string' ? msg.params.correlationId : undefined;
    const _startedAt = Date.now();
    try {
      const result = await dispatch(toolName, args, token, decoded.sub);
      if (correlationId) {
        emitHop({ phase: 'mcp.tool', op: toolName, correlationId, durationMs: Date.now() - _startedAt, status: 'ok' });
      }
      send(rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (correlationId) {
        emitHop({ phase: 'mcp.tool', op: toolName, correlationId, durationMs: Date.now() - _startedAt, status: 'error' });
      }
      emitLogMessage(send, loggingState, 'error', { tool: toolName, message: errMsg }, 'resource-server.dispatch');
      send(rpcResult(id, { content: [{ type: 'text', text: errMsg }], isError: true }));
    }
    return;
  }

  if (method === 'resources/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resources = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resources }));
    return;
  }

  if (method === 'resources/templates/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resourceTemplates = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uriTemplate: r.uriTemplate,
      name: r.templateName,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resourceTemplates }));
    return;
  }

  if (method === 'resources/read') {
    const uri: string = msg.params?.uri || '';
    let decoded: Awaited<ReturnType<typeof decodeAndValidate>>;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const resource = RESOURCE_CATALOG.find((r) => r.uri === uri);
    if (!resource) {
      send(rpcError(id, -32002, `Unknown resource URI: ${uri}`));
      return;
    }
    const scopes = extractScopes(decoded);
    const hasScope = scopes.includes(resource.requiredScope) || scopes.includes('*');
    if (!hasScope) {
      send(rpcError(id, -32005, `Insufficient scope for resource '${uri}'`, {
        requiredScope: resource.requiredScope,
        availableScopes: scopes,
      }));
      return;
    }
    try {
      const data = await dispatch(resource.listTool, {}, token, decoded.sub);
      send(rpcResult(id, {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      send(rpcError(id, -32603, `Resource read failed: ${errMsg}`));
    }
    return;
  }

  send(rpcError(id, -32601, `Method not found: ${method}`));
}

// ---------------------------------------------------------------------------
// Start WebSocket + HTTP
// ---------------------------------------------------------------------------

const httpServer = createServer(handleHttp);
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  const token = bearerFrom(req.headers['authorization']);

  if (!token) {
    ws.close(4001, 'Bearer token required');
    return;
  }

  // MCP spec: logging capability. One state box per WS connection.
  const loggingState: LoggingState = {};

  ws.on('message', (raw) => {
    handleMessage(raw.toString(), token, (s) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }, loggingState).catch((err) => {
      console.error('[mcp-resource-server] Handler error:', err);
      if (ws.readyState === WebSocket.OPEN) ws.send(rpcError(null, -32603, 'Internal error'));
    });
  });

  ws.on('error', (err) => console.error('[mcp-resource-server] WS error:', err.message));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[mcp-resource-server] Running on ${HOST}:${PORT}`);
  console.log(`[mcp-resource-server] Resource URI (aud): ${RESOURCE_URI}`);
  console.log(`[mcp-resource-server] RFC 9728: http://localhost:${PORT}/.well-known/oauth-protected-resource`);
  console.log(`[mcp-resource-server] Tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}`);
});

process.on('SIGINT', () => { httpServer.close(); process.exit(0); });
process.on('SIGTERM', () => { httpServer.close(); process.exit(0); });

// Exported so the HTTP MCP transport can be exercised against a real socket
// (PORT=0 for an ephemeral port) instead of a hand-rolled request/response fake.
export { httpServer };
