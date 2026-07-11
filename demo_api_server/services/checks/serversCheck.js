'use strict';
const axios = require('axios');
const https = require('https');
const { SERVER_INVENTORY } = require('../../data/serverInventory');
const { register } = require('./registry');

// Dev HTTPS agent — allows self-signed mkcert certs on loopback. Production keeps
// TLS verification ON (undefined → axios uses its default secure agent); matches
// the health.js /inventory pattern. Never disable verification in production.
const agent = process.env.NODE_ENV === 'production'
  ? undefined
  : new https.Agent({ rejectUnauthorized: false });

async function probe(entry) {
  const path = entry.healthPath || '/health';
  let lastError = 'no_candidates';
  for (const base of entry.candidates || []) {
    const url = `${base.replace(/\/$/, '')}${path}`;
    const start = Date.now();
    try {
      await axios.get(url, {
        timeout: 2500,
        httpsAgent: agent,
        ...(entry.acceptAnyStatus ? { validateStatus: () => true } : {}),
      });
      return { up: true, latencyMs: Date.now() - start };
    } catch (e) { lastError = e.code || e.message; }
  }
  return { up: false, error: lastError };
}

async function run() {
  const services = await Promise.all(
    SERVER_INVENTORY.map(async (e) => {
      const meta = { key: e.key, name: e.name };
      if (e.probe === 'self') return { ...meta, up: true };
      if (e.probe !== true) return { ...meta, up: null };
      return { ...meta, ...(await probe(e)) };
    })
  );
  const down = services.filter((s) => s.up === false);
  const upCount = services.filter((s) => s.up === true).length;
  const probed = services.filter((s) => s.up !== null).length;
  return {
    status: down.length ? 'fail' : 'pass',
    detail: down.length ? `Down: ${down.map((s) => s.name).join(', ')}` : `${upCount}/${probed} up`,
    meta: { services },
  };
}

const descriptor = { id: 'servers.all_up', name: 'All servers running', category: 'Servers', run };
register(descriptor);
module.exports = { ...descriptor, run };
