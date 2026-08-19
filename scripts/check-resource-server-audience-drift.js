#!/usr/bin/env node
/**
 * check-resource-server-audience-drift.js — no-drift gate for EVERY audience
 * env var that scope-topology.json declares a binding for.
 *
 * Background (TECH_DEBT 2026-08-16 T4, generalised 2026-08-18): audience lists
 * live in env vars set on several surfaces (compose, k8s configmaps, Helm,
 * .env.example, the env writer), while scope-topology.json owns the canonical
 * URI. The invest server's `MCP_SERVER_RESOURCE_URI` collision (the shared
 * configmap handed it the BANKING list via envFrom, and every gateway
 * exchange-#3 token died on `Audience mismatch`) was one instance of a general
 * failure mode: checked-in config reads correct, only the running env is
 * wrong, and nothing fires until a tool call fails at runtime in one vertical.
 *
 * The binding is now DECLARED IN THE TOPOLOGY — each resource may carry:
 *
 *   "audienceEnv": {
 *     "var": "MCP_RESOURCE_SERVER_RESOURCE_URI",
 *     "surfaces": [ { "file": "docker-compose.yml", "kind": "yaml" }, ... ],
 *     "sourcePin": { "file": "...", "mustInclude": "..." }   // optional
 *   }
 *
 * and this checker iterates the table: every declared surface must set the
 * var, and EVERY occurrence's first list entry must equal the resource's
 * canonical `uri`. A new resource is covered the day its binding is declared,
 * not the day it breaks a demo.
 *
 *   node scripts/check-resource-server-audience-drift.js
 *   npm run topology:verify        (step 9)
 *
 * Self-test: node --test scripts/check-resource-server-audience-drift.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// RS_AUDIENCE_DRIFT_ROOT lets the self-test point at a fixture tree; default is
// the real repo root (this file lives in scripts/).
const ROOT = process.env.RS_AUDIENCE_DRIFT_ROOT || path.join(__dirname, '..');

const fails = [];
const fail = (msg) => fails.push(msg);

/** Extract every value assigned to `key` in `text` for the surface kind. */
function extractValues(text, key, kind) {
  const patterns = {
    // KEY: "a,b"  /  KEY: a,b   (compose + configmaps; comments don't match)
    yaml: new RegExp(`^\\s*${key}\\s*:\\s*["']?([^"'#\\n]+?)["']?\\s*(?:#.*)?$`, 'gm'),
    // KEY=a,b
    env: new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'gm'),
    // KEY: 'a,b' + ',c'  — take the first quoted literal, which holds the
    // topology-derived head of the list.
    js: new RegExp(`${key}\\s*:\\s*['"\`]?([^'"\`\\n]+)`, 'gm'),
  };
  return [...text.matchAll(patterns[kind])].map((m) => m[1].trim());
}

const topologyPath = path.join(ROOT, 'scope-topology.json');
const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));

const bindings = Object.entries(topology.resources || {})
  .filter(([, r]) => r && r.audienceEnv)
  .map(([name, r]) => ({ name, uri: r.uri, ...r.audienceEnv }));

if (bindings.length === 0) {
  console.error('❌ scope-topology.json declares NO audienceEnv bindings — the audience gate would be vacuous. ' +
    'At minimum the invest resource server binding must exist (see TECH_DEBT 2026-08-16 T4).');
  process.exit(1);
}

for (const b of bindings) {
  if (!b.uri) {
    fail(`resources["${b.name}"] declares audienceEnv but has no uri — cannot derive the canonical audience.`);
    continue;
  }
  for (const surface of b.surfaces || []) {
    const abs = path.join(ROOT, surface.file);
    if (!fs.existsSync(abs)) {
      fail(`${surface.file}: missing — expected it to set ${b.var} (resource "${b.name}").`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const values = extractValues(text, b.var, surface.kind);
    if (values.length === 0) {
      fail(`${surface.file}: does not set ${b.var} (resource "${b.name}").`);
      continue;
    }
    for (const raw of values) {
      // The env writer may build the value from an identifier that is itself
      // topology-derived — no literal to compare (no dot = not a URI).
      if (surface.kind === 'js' && !raw.includes('.')) continue;
      const first = raw.split(',')[0].trim();
      if (first !== b.uri) {
        fail(
          `${surface.file}: ${b.var} starts with "${first}" but scope-topology.json ` +
            `resources["${b.name}"].uri is "${b.uri}". The first entry is the resource's ` +
            'canonical URI (RFC 9728 metadata, health, logs).',
        );
      }
    }
  }
  if (b.sourcePin) {
    const abs = path.join(ROOT, b.sourcePin.file);
    if (fs.existsSync(abs)) {
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.includes(b.sourcePin.mustInclude)) {
        fail(`${b.sourcePin.file}: must contain \`${b.sourcePin.mustInclude}\` (resource "${b.name}") — ` +
          'losing it reintroduces the shared-configmap audience collision.');
      }
    }
  }
}

if (fails.length) {
  console.error('❌ audience drift FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error(
    '\nEach audience env var above is bound to its resource in scope-topology.json\n' +
      '(resources[...].audienceEnv). The topology URI is canonical; fix the surface,\n' +
      'or — if the resource genuinely moved — the topology, never just one of them.\n',
  );
  process.exit(1);
}

console.log(
  `✅ audience env vars in sync with scope-topology.json ` +
    `(${bindings.map((b) => `${b.var}=${b.uri}`).join(', ')})`,
);
