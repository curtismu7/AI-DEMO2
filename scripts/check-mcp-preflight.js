#!/usr/bin/env node
'use strict';

/*
 * Is every MCP door actually answering, right now?
 *
 *   npm run demo:preflight -- --target se
 *   NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
 *
 * The local stack serves mkcert certificates and Node ships its own CA bundle
 * rather than reading the macOS system trust store, so `fetch` rejects mkcert
 * with "unable to verify the first certificate" even though a browser and curl
 * both accept it. NODE_EXTRA_CA_CERTS adds that one root and nothing else.
 * Never reach for NODE_TLS_REJECT_UNAUTHORIZED=0 here: it disables verification
 * for every request the process makes, turning a real TLS failure into a silent
 * pass — the exact class of false green this preflight exists to prevent.
 *
 * Run this before a demo. It probes each door's RFC 9728 metadata endpoint,
 * which is unauthenticated, so a red row is infrastructure — DNS, TLS, a dead
 * pod, a rollout in flight — not a policy question.
 *
 * What it deliberately does NOT prove: that a real caller can invoke a tool.
 * The Privilege gateway 401s before routing (see lib/preflightRows.js), so
 * authorization can only be checked with a token. The page's own preflight
 * panel does that half, using the operator's live session.
 */

const { classifyProbe, renderTable, exitCodeFor } = require('./lib/preflightRows');

const TARGETS = {
  local: {
    // The BFF, not the UI. Both /mcp-facade and /api/privilege-mcp are mounted
    // on the BFF, which serves :3001; nothing proxies /mcp-facade on :4000.
    facadeBase: 'https://localhost:3001',
    gatewayBase: 'https://mcpgw.ai-demo.ping-devops.com',
    // Needs NODE_EXTRA_CA_CERTS — see the header. Without it every local row
    // comes back `unreachable` on a certificate error while the doors are fine.
    needsMkcertRoot: true,
  },
  se: {
    facadeBase: 'https://ai-demo.ping-devops.com',
    gatewayBase: 'https://mcpgw.ai-demo.ping-devops.com',
    needsMkcertRoot: false,
  },
};

// Façade doors worth checking before a demo. Dark doors (agentless, agent,
// agent-cmuir) are omitted on purpose — they point at torn-down infrastructure
// by design and would be permanently red.
const FACADE_DOORS = ['agent-gateway', 'opensearch', 'brave', 'banking', 'privilege-gateway'];

// Agentic Apps registered on the AI Gateway. Hardcoded here on purpose for now:
// Plan B (W8) replaces this with the console inventory, and this list is what
// that change is measured against.
const GATEWAY_APPS = ['opensearch22', 'opensearch', 'brave'];

const TIMEOUT_MS = 15000;

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return { status: res.status };
  } catch (err) {
    // Pass the error through as it comes — classifyProbe reads `.message` off
    // an Error, and a fetch failure buries the real reason in `cause`.
    if (err.name === 'AbortError') return { error: `timeout after ${TIMEOUT_MS}ms` };
    return { error: err.cause?.message ? `${err.message}: ${err.cause.message}` : err };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the façade's gateway-session state from /state (not auth-gated) and turn
 * it into a row. A dead session is the single most likely reason the Privilege
 * façade door fails in LM Studio, and it is invisible from the outside.
 */
async function gatewaySessionRow(facadeBase) {
  const label = 'Façade gateway session';
  const url = `${facadeBase}/api/privilege-mcp/state`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { label, url, state: 'down', note: `/state returned ${res.status}` };
    }
    const body = await res.json();
    const s = body.gatewaySession;
    if (!s) {
      return { label, url, state: 'down', note: '/state has no gatewaySession — is Plan A Task 1 deployed?' };
    }
    if (s.ready) {
      return { label, url, state: 'ok', note: s.reason === 'refreshable' ? 'lapsed but refreshable' : 'armed' };
    }
    return {
      label,
      url,
      state: 'down',
      note: `${s.reason} — sign in once at /privilege-mcp-client to re-arm`,
    };
  } catch (err) {
    // Same passthrough as probe(): an Error with no `message` must not become
    // the literal note "undefined".
    const text = err?.message || err?.cause?.message || String(err);
    return { label, url, state: 'unreachable', note: text.slice(0, 160) };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  // Strict: a typo'd flag must not fall through to the default target and
  // silently probe the wrong environment while looking like it worked.
  const idx = argv.indexOf('--target');
  const consumed = idx >= 0 ? [idx, idx + 1] : [];
  const stray = argv.filter((_, i) => !consumed.includes(i));
  if (stray.length) {
    console.error(`Unrecognised argument(s): ${stray.join(' ')}\nUsage: --target ${Object.keys(TARGETS).join('|')}`);
    process.exit(2);
  }
  const targetName = idx >= 0 ? argv[idx + 1] : 'se';
  const target = TARGETS[targetName];
  if (!target) {
    console.error(`Unknown target "${targetName || '(missing)'}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }

  // Say it up front rather than letting the operator debug a wall of
  // certificate errors that look like dead doors.
  if (target.needsMkcertRoot && !process.env.NODE_EXTRA_CA_CERTS) {
    console.error(
      'The local target serves mkcert certificates, which Node does not trust by default.\n'
        + 'Re-run as:\n'
        + '  NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local\n',
    );
    process.exit(2);
  }

  const checks = [
    ...FACADE_DOORS.map((door) => ({
      label: `Façade — ${door}`,
      url: `${target.facadeBase}/mcp-facade/${door}/.well-known/oauth-protected-resource`,
    })),
    ...GATEWAY_APPS.map((app) => ({
      label: `Privilege — ${app}`,
      url: `${target.gatewayBase}/${app}/mcp`,
    })),
    {
      label: 'Broker AS metadata',
      url: `${target.facadeBase}/.well-known/oauth-authorization-server`,
    },
  ];

  const rows = [];
  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probe(check.url);
    rows.push({ ...check, ...classifyProbe(result) });
  }

  // The gateway session is the thing most likely to be quietly dead before a
  // demo: it lives in BFF memory and does not survive a restart. /state is not
  // auth-gated, so the CLI can read it without a session of its own.
  rows.push(await gatewaySessionRow(target.facadeBase));

  console.log(`\nMCP preflight — target ${targetName}\n`);
  console.log(renderTable(rows));

  const code = exitCodeFor(rows);
  console.log(
    code === 0
      ? '\nAll doors answering. "reachable; wants a token" is a pass — this probe is unauthenticated.\n'
      : '\n⚠️  One or more doors are down. On SE, check for a rollout in flight before treating it as a defect.\n',
  );
  process.exit(code);
}

// A throw anywhere above would otherwise exit 0 on an unhandled rejection in
// some Node configurations — the exact false green this script exists to catch.
main().catch((err) => {
  console.error(`preflight failed: ${err.stack || err.message}`);
  process.exit(2);
});
