#!/usr/bin/env node
/**
 * check-resource-server-audience-drift.js — no-drift gate for the invest MCP
 * resource server's accepted-audience env var.
 *
 * Background (TECH_DEBT 2026-08-16, T4): `MCP_SERVER_RESOURCE_URI` means "the
 * BANKING MCP server's accepted-audience list" everywhere in this repo, but
 * demo_mcp_resource_server used to read that same name for its OWN list. The two
 * meanings collided in the one place it hurts: k8s/02-configmap.yaml is a shared
 * `ai-demo-config` map that k8s/63-mcp-resource-server-deployment.yaml pulls in
 * wholesale via `envFrom`, so the invest server inherited the banking value and
 * rejected every gateway exchange-#3 token with
 * `Audience mismatch: got [mcp-invest.ping.demo]`.
 *
 * The server now reads `MCP_RESOURCE_SERVER_RESOURCE_URI`. This gate keeps every
 * surface that sets it agreeing with scope-topology.json, so the collision
 * cannot come back by hand-edit:
 *   - the canonical URI is DERIVED from
 *     scope-topology.json resources["Super Banking MCP Invest"].uri
 *   - every surface below must set the var, first entry == that URI
 *   - no surface may hand this server the banking list under the old name
 *
 *   node scripts/check-resource-server-audience-drift.js
 *   npm run topology:verify        (step 9/9)
 *
 * Self-test: node --test scripts/check-resource-server-audience-drift.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// RS_AUDIENCE_DRIFT_ROOT lets the self-test point at a fixture tree; default is
// the real repo root (this file lives in scripts/).
const ROOT = process.env.RS_AUDIENCE_DRIFT_ROOT || path.join(__dirname, '..');

const OWN_VAR = 'MCP_RESOURCE_SERVER_RESOURCE_URI';
const BANKING_VAR = 'MCP_SERVER_RESOURCE_URI';
const TOPOLOGY_RESOURCE = 'Super Banking MCP Invest';

/**
 * Surfaces that must carry this server's audience list.
 *
 * `kind` picks the value parser: `yaml` for `KEY: "value"` (compose + the two
 * configmaps), `env` for `KEY=value` (.env.example), `js` for a quoted object
 * value in the env writer.
 */
const SURFACES = [
  { file: 'docker-compose.yml', kind: 'yaml' },
  { file: 'k8s/02-configmap.yaml', kind: 'yaml' },
  { file: 'privilege/ai-demo-whole-stack/ai-demo-stack/templates/02-configmap.yaml', kind: 'yaml' },
  { file: 'demo_mcp_resource_server/.env.example', kind: 'env' },
  { file: 'demo_api_server/scripts/refresh-service-envs.js', kind: 'js' },
];

const fails = [];
const fail = (msg) => fails.push(msg);

function readTopologyUri() {
  const p = path.join(ROOT, 'scope-topology.json');
  const topology = JSON.parse(fs.readFileSync(p, 'utf8'));
  const uri = topology.resources?.[TOPOLOGY_RESOURCE]?.uri;
  if (!uri) {
    console.error(
      `❌ scope-topology.json has no resources["${TOPOLOGY_RESOURCE}"].uri — ` +
        'cannot derive the invest audience. Fix the topology, not this check.',
    );
    process.exit(1);
  }
  return uri;
}

/** Extract the raw value assigned to `key` in `text`, or null. */
function extractValue(text, key, kind) {
  const patterns = {
    // KEY: "a,b"  /  KEY: a,b
    yaml: new RegExp(`^\\s*${key}\\s*:\\s*["']?([^"'#\\n]+?)["']?\\s*(?:#.*)?$`, 'm'),
    // KEY=a,b
    env: new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'),
    // KEY: 'a,b' + ',c'  — take the first quoted literal, which holds the
    // topology-derived head of the list.
    js: new RegExp(`${key}\\s*:\\s*['"\`]?([^'"\`\\n]+)`, 'm'),
  };
  const m = text.match(patterns[kind]);
  return m ? m[1].trim() : null;
}

const investUri = readTopologyUri();

for (const surface of SURFACES) {
  const abs = path.join(ROOT, surface.file);
  if (!fs.existsSync(abs)) {
    fail(`${surface.file}: missing — expected it to set ${OWN_VAR}.`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');

  const raw = extractValue(text, OWN_VAR, surface.kind);
  if (!raw) {
    fail(
      `${surface.file}: does not set ${OWN_VAR}. Without it this surface leaves the ` +
        `invest server on the ${BANKING_VAR} fallback, which is the banking list.`,
    );
    continue;
  }

  // The env writer builds the value from a variable (investAudList), which is
  // already derived from the topology — there is no literal to compare.
  const isDerived = surface.kind === 'js' && !raw.includes('.');
  if (isDerived) continue;

  const first = raw.split(',')[0].trim();
  if (first !== investUri) {
    fail(
      `${surface.file}: ${OWN_VAR} starts with "${first}" but scope-topology.json ` +
        `resources["${TOPOLOGY_RESOURCE}"].uri is "${investUri}". The first entry is this ` +
        "server's canonical resource URI (RFC 9728 metadata, health, logs).",
    );
  }
}

// The service itself must not go back to preferring the shared banking name.
const serverSrc = path.join(ROOT, 'demo_mcp_resource_server/src/server/acceptedAudiences.ts');
if (fs.existsSync(serverSrc)) {
  const text = fs.readFileSync(serverSrc, 'utf8');
  if (!text.includes(`RESOURCE_URI_ENV = '${OWN_VAR}'`)) {
    fail(
      `demo_mcp_resource_server/src/server/acceptedAudiences.ts: RESOURCE_URI_ENV must be ` +
        `'${OWN_VAR}'. Preferring '${BANKING_VAR}' reintroduces the shared-configmap collision.`,
    );
  }
}

if (fails.length) {
  console.error('❌ resource-server audience drift FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error(
    `\n${OWN_VAR} is this server's OWN accepted-audience list. ${BANKING_VAR} is the\n` +
      'banking MCP server\'s, and the invest deployment inherits it via envFrom — that\n' +
      'is the collision this gate exists to prevent.\n',
  );
  process.exit(1);
}

console.log(
  `✅ resource-server audience in sync with scope-topology.json ` +
    `(${investUri}, ${SURFACES.length} surfaces)`,
);
