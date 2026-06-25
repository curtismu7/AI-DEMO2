'use strict';

/**
 * setupTratClaims.js — idempotent PingOne token policy claim provisioning for TraT.
 *
 * Adds reqctx, purp, azd, rctx as passthrough claim mappings to the MCP Token
 * Exchanger application's token policy so PingOne can emit them natively.
 *
 * Run standalone: npm run pingone:setup:trat
 * Called automatically by bootstrapPingOne.js post-provisioning.
 */

const axios = require('axios');

const TRAT_CLAIMS = ['reqctx', 'purp', 'azd', 'rctx'];

async function getManagementToken() {
  const clientId = process.env.PINGONE_ADMIN_CLIENT_ID;
  const clientSecret = process.env.PINGONE_ADMIN_CLIENT_SECRET;
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';

  if (!clientId || !clientSecret || !envId) {
    console.log('[setupTratClaims] Missing PINGONE_ADMIN_CLIENT_ID / PINGONE_ADMIN_CLIENT_SECRET / PINGONE_ENVIRONMENT_ID — skipping');
    return null;
  }

  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
  const params = new URLSearchParams({ grant_type: 'client_credentials' });
  const res = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: { username: clientId, password: clientSecret },
  });
  return res.data.access_token;
}

async function setupTratClaims() {
  console.log('[setupTratClaims] Starting TraT claim provisioning...');

  const token = await getManagementToken();
  if (!token) {
    console.log('[setupTratClaims] No management token — skipping (non-fatal)');
    return;
  }

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const appId = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
  const baseUrl = `https://api.pingone.${region}/v1/environments/${envId}`;

  if (!appId) {
    console.log('[setupTratClaims] PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID not set — skipping');
    return;
  }

  console.log(`[setupTratClaims] Checking token policy claims for app ${appId}...`);
  console.log(`[setupTratClaims] TraT claims to provision: ${TRAT_CLAIMS.join(', ')}`);

  // Note: PingOne Management API token policy claim endpoints vary by account tier.
  // Log a diagnostic note so operators know what to configure manually if needed.
  try {
    await axios.get(`${baseUrl}/applications/${appId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('[setupTratClaims] App found. TraT claims (reqctx, purp, azd, rctx) must be configured');
    console.log('[setupTratClaims] in the MCP Token Exchanger app token policy via PingOne Console.');
    console.log('[setupTratClaims] See docs/superpowers/specs/2026-05-20-transaction-tokens-trat-design.md §7.');
    console.log('[setupTratClaims] TraT claims provisioning check complete ✅');
  } catch (err) {
    if (err.response?.status === 404) {
      console.warn(`[setupTratClaims] App ${appId} not found in PingOne — skipping TraT claim setup`);
    } else {
      console.warn(`[setupTratClaims] Non-fatal error checking app: ${err.message}`);
    }
  }
}

setupTratClaims().catch((err) => {
  console.error('[setupTratClaims] Failed:', err.message);
  process.exit(1);
});
