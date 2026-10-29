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
const POPPY_SCOPES = {
  'accounts:read': { description: 'Read account balances and details', changes: 'none', personal_data: true },
  'transactions:read': { description: 'Read transaction history', changes: 'none', personal_data: true },
  'transactions:write': { description: 'Move money between accounts', changes: 'irreversible', personal_data: true },
  'mortgage:read': { description: 'Read mortgage details', changes: 'none', personal_data: true },
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
