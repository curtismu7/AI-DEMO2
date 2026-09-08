#!/usr/bin/env node
/**
 * Adds this demo's known Privilege-gateway MCP doors to LM Studio's own
 * mcp.json (a local file LM Studio's "Program" tab reads directly — there is
 * no API to write it, confirmed against LM Studio's own docs).
 *
 *   node scripts/lmstudio-mcp-sync.js          (dry run — prints what would change)
 *   node scripts/lmstudio-mcp-sync.js --apply  (npm run lmstudio:sync-mcp -- --apply)
 *
 * Deliberately does NOT write any bearer token into the file. Each door
 * answers 401 with a full OAuth discovery challenge (authorization_uri/
 * token_uri) — LM Studio is expected to run its own OAuth flow the first time
 * it connects, the same "no client id configured on the client" model
 * privilege/CURRENT-CONFIGURATION.md documents for this gateway. Embedding a
 * live Privilege bearer in a plaintext local file would be the exact
 * stored-secret pattern the in-app Inspector's built-in profiles
 * (mcpProfileStore.js) were deliberately designed to avoid.
 *
 * opensearch22 is intentionally excluded: that door 404s on /mcp once actually
 * authenticated, because the gateway pins an app to its registered entry path
 * (/sse here) — see demo_mcp_pingone/README.md "Entry path". An OpenSearch entry
 * already exists in
 * most users' mcp.json via a different route (the local mcp-facade proxy) —
 * adding a second, known-broken entry for it would only add confusion.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GATEWAY_BASE = 'https://mcpgw.ai-demo.ping-devops.com';

// Candidates this script knows how to add. Each is skipped if an entry with
// that exact url already exists anywhere in mcpServers (under any key name).
const KNOWN_DOORS = [
  { key: 'MCP Privilege-Banking', url: `${GATEWAY_BASE}/openapi2/mcp` },
  { key: 'MCP Privilege-Brave', url: `${GATEWAY_BASE}/mcp-brave-search/mcp` },
  { key: 'MCP Privilege-Grafana', url: `${GATEWAY_BASE}/mcp-grafana/mcp` },
];

function targetPath() {
  return process.env.LMSTUDIO_MCP_JSON_PATH || path.join(os.homedir(), '.lmstudio', 'mcp.json');
}

function loadConfig(file) {
  if (!fs.existsSync(file)) return { mcpServers: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') parsed.mcpServers = {};
  return parsed;
}

function planAdditions(config) {
  const existingUrls = new Set(Object.values(config.mcpServers).map((s) => s.url));
  const toAdd = [];
  const alreadyPresent = [];
  for (const door of KNOWN_DOORS) {
    if (existingUrls.has(door.url)) {
      alreadyPresent.push(door);
    } else {
      toAdd.push(door);
    }
  }
  return { toAdd, alreadyPresent };
}

function main() {
  const apply = process.argv.includes('--apply');
  const file = targetPath();
  const config = loadConfig(file);
  const { toAdd, alreadyPresent } = planAdditions(config);

  console.log(`LM Studio mcp.json: ${file}`);
  for (const door of alreadyPresent) {
    console.log(`  already present — ${door.url}`);
  }
  if (toAdd.length === 0) {
    console.log('Nothing to add.');
    return;
  }
  for (const door of toAdd) {
    console.log(`  ${apply ? 'adding' : 'would add'} "${door.key}" -> ${door.url}`);
  }

  if (!apply) {
    console.log('\nDry run only — re-run with --apply to write these changes.');
    return;
  }

  if (fs.existsSync(file)) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    console.log(`Backed up existing file to ${backup}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  for (const door of toAdd) {
    config.mcpServers[door.key] = { url: door.url };
  }
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${toAdd.length} new entr${toAdd.length === 1 ? 'y' : 'ies'}.`);
}

if (require.main === module) {
  main();
}

module.exports = { KNOWN_DOORS, loadConfig, planAdditions };
