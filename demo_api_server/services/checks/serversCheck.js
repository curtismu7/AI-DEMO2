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
      const meta = { key: e.key, name: e.name, optional: !!e.optional };
      if (e.probe === 'self') return { ...meta, up: true };
      if (e.probe !== true) return { ...meta, up: null };
      return { ...meta, ...(await probe(e)) };
    })
  );
  const down = services.filter((s) => s.up === false);
  // Optional services are gated behind a Compose profile (agents/demo-auth/rag)
  // that's off by default in lean-core — their absence is expected, not a
  // readiness blocker. Only a required service being down fails the check.
  const requiredDown = down.filter((s) => !s.optional);
  const optionalDown = down.filter((s) => s.optional);
  // Headline counts REQUIRED services only. Counting the optional ones in the
  // denominator rendered "18/21 up" while this check's own status was warn and
  // its detail named the three as expected-absent — three failures to anyone
  // glancing at it. Optional services are reported beside the count, not inside it.
  const probedServices = services.filter((s) => s.up !== null);
  const requiredProbed = probedServices.filter((s) => !s.optional);
  const requiredUp = requiredProbed.filter((s) => s.up === true).length;
  const optionalUp = probedServices.filter((s) => s.optional && s.up === true).length;
  const optionalProbed = probedServices.length - requiredProbed.length;
  const status = requiredDown.length ? 'fail' : optionalDown.length ? 'warn' : 'pass';
  const headline = `${requiredUp}/${requiredProbed.length} required up`
    + (optionalProbed ? ` (optional ${optionalUp}/${optionalProbed})` : '');
  const parts = [headline];
  if (requiredDown.length) parts.push(`Down: ${requiredDown.map((s) => s.name).join(', ')}`);
  if (optionalDown.length) parts.push(`Not started (optional): ${optionalDown.map((s) => s.name).join(', ')}`);
  return {
    status,
    detail: parts.join(' — '),
    meta: {
      services,
      counts: {
        requiredUp,
        requiredProbed: requiredProbed.length,
        optionalUp,
        optionalProbed,
      },
    },
  };
}

const descriptor = {
  id: 'servers.all_up', name: 'All servers running', category: 'Servers',
  severity: 'blocking', run,
};
register(descriptor);
module.exports = { ...descriptor, run };
