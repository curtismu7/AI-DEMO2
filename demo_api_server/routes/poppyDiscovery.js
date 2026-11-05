'use strict';

/**
 * Personal Agent Protocol (Poppy, Draft 0.3) discovery — spec §3.
 *
 *   GET /.well-known/poppy.json                   (§3.1)
 *   GET /.well-known/oauth-protected-resource     (§3.2) — only on the Poppy host
 *
 * Public, no authentication. The Poppy host (POPPY_DOMAIN) is separate from the main app
 * host because §3.2 needs `resource` to be exactly https://{domain}, while the main host's
 * /.well-known/oauth-protected-resource already serves the banking and MCP resources.
 */

const express = require('express');
const configStore = require('../services/configStore');

const router = express.Router();

// scope_hints are required for every advertised scope (§4.7). Unknown values read as irreversible.
// Every scope the Company\'s authorization server advertises (PingFederate authServerSettings, read 2026-10-30). Descriptions are
// PingFederate\'s own text. Hints are conservative: a scope reads as read-only only when its name says so; everything else is
// irreversible (unknown reads as irreversible). personal_data is true for all of them until each one is reviewed. The PingFederate
// scope set is shared by the whole demo platform, so most of these are not Poppy offerings: narrowing the advertised set is open.
const POPPY_SCOPES = {
  "audit:read": { description: "Tool scope (search_audit_activities)", changes: "none", personal_data: true },
  "mcp:invoke": { description: "Invoke MCP tools through the gateway", changes: "irreversible", personal_data: true },
  "permits:read": { description: "Tool scope (show_permit)", changes: "none", personal_data: true },
  "workorders:read": { description: "Tool scope (show_work_order)", changes: "none", personal_data: true },
  "users:read": { description: "Tool scope (admin_list_all_users)", changes: "none", personal_data: true },
  "accounts:read": { description: "Read account information and balances", changes: "none", personal_data: true },
  "admin:write": { description: "Tool scope (admin_delete_user)", changes: "irreversible", personal_data: true },
  "records:read": { description: "A2A delegated tool scope (records:read)", changes: "none", personal_data: true },
  "tp:read": { description: "Read at the demo third-party authorization server", changes: "none", personal_data: true },
  "dcr:register": { description: "Register an OAuth client (DCR initial access token)", changes: "irreversible", personal_data: true },
  "agent:invoke:records": { description: "A2A agent invoke scope (records)", changes: "irreversible", personal_data: true },
  "admin:read": { description: "Demo scope admin:read", changes: "none", personal_data: true },
  "muse:mcp": { description: "Muse MCP resource (local)", changes: "irreversible", personal_data: true },
  "write": { description: "Demo scope write", changes: "irreversible", personal_data: true },
  "mortgage:read": { description: "Tool scope (show_mortgage)", changes: "none", personal_data: true },
  "expense:read": { description: "Tool scope (show_expense_report)", changes: "none", personal_data: true },
  "read": { description: "Demo scope read", changes: "none", personal_data: true },
  "agent:invoke:identity": { description: "A2A agent invoke scope (identity)", changes: "irreversible", personal_data: true },
  "openid": { description: "OpenID Connect authentication", changes: "none", personal_data: true },
  "profile": { description: "Basic user profile claims", changes: "none", personal_data: true },
  "largepurchase:read": { description: "Tool scope (show_large_purchase)", changes: "none", personal_data: true },
  "code:search": { description: "Tool scope (code_search)", changes: "irreversible", personal_data: true },
  "gear:read": { description: "Tool scope (show_gear_order)", changes: "none", personal_data: true },
  "users:manage": { description: "Tool scope (admin_delete_user)", changes: "irreversible", personal_data: true },
  "agent:invoke:tax": { description: "A2A agent invoke scope (tax)", changes: "irreversible", personal_data: true },
  "identity:read": { description: "A2A delegated tool scope (identity:read)", changes: "none", personal_data: true },
  "ai:agent:read": { description: "Invoke the AI agent", changes: "none", personal_data: true },
  "transfer": { description: "Demo scope transfer", changes: "irreversible", personal_data: true },
  "agent:invoke:supplier": { description: "A2A agent invoke scope (supplier)", changes: "irreversible", personal_data: true },
  "sensitive:read": { description: "Demo scope sensitive:read", changes: "none", personal_data: true },
  "agent:invoke:passenger": { description: "A2A agent invoke scope (passenger)", changes: "irreversible", personal_data: true },
  "supplier:read": { description: "A2A delegated tool scope (supplier:read)", changes: "none", personal_data: true },
  "holdings:read": { description: "A2A delegated tool scope (holdings:read)", changes: "none", personal_data: true },
  "agent:invoke:finaid": { description: "A2A agent invoke scope (finaid)", changes: "irreversible", personal_data: true },
  "agent:invoke:holdings": { description: "A2A agent invoke scope (holdings)", changes: "irreversible", personal_data: true },
  "payroll:read": { description: "A2A delegated tool scope (payroll:read)", changes: "none", personal_data: true },
  "agent:invoke:membership": { description: "A2A agent invoke scope (membership)", changes: "irreversible", personal_data: true },
  "agent:invoke": { description: "Invoke the agent gateway", changes: "irreversible", personal_data: true },
  "offline_access": { description: "Issue refresh tokens for server-held sessions", changes: "none", personal_data: true },
  "gateway:mcp:invoke": { description: "A2A delegated tool scope (gateway:mcp:invoke)", changes: "irreversible", personal_data: true },
  "airlines:read": { description: "Read airline reservations, flight status, and seat maps", changes: "none", personal_data: true },
  "email": { description: "User email claim", changes: "none", personal_data: true },
  "transactions:write": { description: "Authorize a banking transaction (RAR banking_transaction)", changes: "irreversible", personal_data: true },
  "purchase:read": { description: "A2A delegated tool scope (purchase:read)", changes: "none", personal_data: true },
  "agent:invoke:payroll": { description: "A2A agent invoke scope (payroll)", changes: "irreversible", personal_data: true },
  "membership:read": { description: "A2A delegated tool scope (membership:read)", changes: "none", personal_data: true },
  "agent:invoke:investment": { description: "A2A agent invoke scope (investment)", changes: "irreversible", personal_data: true },
  "finaid:read": { description: "A2A delegated tool scope (finaid:read)", changes: "none", personal_data: true },
  "transcript:read": { description: "Tool scope (show_enrollment)", changes: "none", personal_data: true },
  "tax:read": { description: "A2A delegated tool scope (tax:read)", changes: "none", personal_data: true },
  "invest:read": { description: "A2A delegated tool scope (invest:read)", changes: "none", personal_data: true },
  "airlines:write": { description: "Tool scope (pay_airline_fee)", changes: "irreversible", personal_data: true },
  "admin:delete": { description: "Tool scope (admin_delete_user)", changes: "irreversible", personal_data: true },
  "pnr:read": { description: "A2A delegated tool scope (pnr:read)", changes: "none", personal_data: true },
  "agent:invoke:purchase": { description: "A2A agent invoke scope (purchase)", changes: "irreversible", personal_data: true },
};

function poppyDomain() {
  return String(process.env.POPPY_DOMAIN || '').trim().toLowerCase();
}

function issuer() {
  return String(configStore.getEffective('pf_issuer') || '').trim();
}

function buildPoppyJson() {
  const domain = poppyDomain();
  const doc = {
    protocol_version: '0.3',
    organization: { name: process.env.POPPY_ORG_NAME || 'Super Banking', domain },
    auth: {
      issuer: issuer(),
      scopes: Object.fromEntries(Object.entries(POPPY_SCOPES).map(([k, v]) => [k, v.description])),
      scope_hints: Object.fromEntries(
        Object.entries(POPPY_SCOPES).map(([k, v]) => [k, { changes: v.changes, personal_data: v.personal_data }]),
      ),
    },
  };
  doc.apis = [{ type: 'openapi', url: `https://${domain}/poppy/api/openapi.json`, description: 'Account details for the signed-in user' }];
  if (process.env.POPPY_MCP_URL) {
    doc.apis.push({ type: 'mcp', url: process.env.POPPY_MCP_URL, description: 'Banking MCP server' });
  }
  return doc;
}

function buildProtectedResource() {
  return {
    resource: `https://${poppyDomain()}`,
    authorization_servers: [issuer()],
    scopes_supported: Object.keys(POPPY_SCOPES),
    bearer_methods_supported: ['header'],
  };
}

/** True when this request is addressed to the Poppy host. */
function isPoppyHost(req) {
  const domain = poppyDomain();
  return Boolean(domain) && String(req.hostname || '').toLowerCase() === domain.split(':')[0];
}

router.get('/poppy.json', (req, res) => {
  if (!poppyDomain() || !isPoppyHost(req)) return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'public, max-age=300');
  return res.json(buildPoppyJson());
});

/** Mounted before the generic protected-resource router; falls through on any other host. */
function protectedResourceOnPoppyHost(req, res, next) {
  if (req.path !== '/' || !isPoppyHost(req)) return next();
  res.set('Cache-Control', 'public, max-age=300');
  return res.json(buildProtectedResource());
}

module.exports = { isPoppyHost, router, protectedResourceOnPoppyHost, buildPoppyJson, buildProtectedResource, POPPY_SCOPES };
