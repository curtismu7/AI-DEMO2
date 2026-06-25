#!/usr/bin/env node
/**
 * gen-service-topology.js — generate/validate service addressing from the
 * single source of truth: service-topology.json (repo root).
 *
 * Usage:
 *   node scripts/gen-service-topology.js generate   # rewrite the generated
 *       block in k8s/02-configmap.yaml from the topology
 *   node scripts/gen-service-topology.js check      # fail (exit 1) if the
 *       configmap or docker-compose drift from the topology
 *   node scripts/gen-service-topology.js public-patch <origin>   # emit a
 *       kubectl merge-patch JSON overriding every public-derived configmap
 *       key with the given browser-facing origin (used by k8s/aws/deploy.sh)
 *
 * What it owns: inter-service backend URLs/ports + the passthrough flag.
 * Public frontend URLs, TLS paths, and feature flags stay hand-managed.
 *
 * Validation scope:
 *   - k8s/02-configmap.yaml : exact match of the generated block (catches hand-edits).
 *   - docker-compose.yml    : every managed URL key must point at the correct
 *                             service port; the passthrough flag must match.
 *   - demo_api_server/.env.example : every key in the topology `dotenv` map must
 *                             hit its target service's port (host/scheme differ
 *                             locally — 127.0.0.1 / mkcert — so only port is checked).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOPOLOGY_PATH = path.join(ROOT, 'service-topology.json');
const CONFIGMAP_PATH = path.join(ROOT, 'k8s', '02-configmap.yaml');
const COMPOSE_PATH = path.join(ROOT, 'docker-compose.yml');
const ENV_EXAMPLE_PATH = path.join(ROOT, 'demo_api_server', '.env.example');

const BEGIN = '# >>> BEGIN generated from service-topology.json';
const END = '# <<< END generated';

const topo = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, 'utf8'));
const services = topo.services;
const flags = topo.flags;
const configmapMap = topo.configmap;
const publicEntry = topo.public;

// OAuth resource audiences live in the OTHER source of truth (scope-topology.json).
// Reuse its accessor so the role→resource-name mapping isn't duplicated here.
const scopeTopology = require('../demo_api_server/services/scopeTopology');

// Derivation kinds that produce "<scheme>://<host>:<port>" — 'url' uses the
// service's own scheme; ws/http/https force that scheme.
const URL_KINDS = ['url', 'ws', 'http', 'https'];

/** Split a derivation string "kind:arg" into its parts. */
function parseDeriv(deriv) {
  const idx = deriv.indexOf(':');
  return { kind: deriv.slice(0, idx), arg: deriv.slice(idx + 1) };
}

/** Resolve a derivation string (see service-topology.json grammar) to a value. */
function resolve(deriv) {
  // 'public' / 'public:/path' — browser-facing base URL (no colon for the bare form).
  if (deriv === 'public' || deriv.startsWith('public:')) {
    if (!publicEntry) throw new Error('"public" derivation used but service-topology.json has no "public" block');
    const suffix = deriv === 'public' ? '' : deriv.slice('public:'.length);
    return `${publicEntry.scheme}://${publicEntry.host}:${publicEntry.port}${suffix}`;
  }
  const { kind, arg } = parseDeriv(deriv);
  const svc = (name) => {
    const s = services[name];
    if (!s) throw new Error(`Unknown service "${name}" in derivation "${deriv}"`);
    return s;
  };
  if (URL_KINDS.includes(kind)) {
    const s = svc(arg);
    return `${kind === 'url' ? s.scheme : kind}://${s.host}:${s.port}`;
  }
  switch (kind) {
    case 'port': {
      const [name, extra] = arg.split('.');
      const s = svc(name);
      const port = extra ? s.extraPorts?.[extra] : s.port;
      if (port == null) throw new Error(`No port "${arg}" for service in "${deriv}"`);
      return String(port);
    }
    case 'flag':
      if (!(arg in flags)) throw new Error(`Unknown flag "${arg}" in derivation "${deriv}"`);
      return String(flags[arg]);
    case 'aud': {
      // OAuth resource audience from scope-topology.json (enduser|agentGateway|mcpServer|mcpGateway).
      const a = scopeTopology.audiences()[arg];
      if (!a) throw new Error(`Unknown audience role "${arg}" in derivation "${deriv}"`);
      return a;
    }
    case 'literal': return arg;
    default: throw new Error(`Unknown derivation kind "${kind}" in "${deriv}"`);
  }
}

/** Ordered [key, value] pairs for the generated configmap block. */
function generatedEntries() {
  return Object.entries(configmapMap)
    .filter(([k]) => k !== '_comment')
    .map(([k, deriv]) => [k, resolve(deriv)]);
}

/** Expected port for a managed key, or null if it is not a URL-bearing key. */
function expectedPortFor(deriv) {
  const { kind, arg } = parseDeriv(deriv);
  return URL_KINDS.includes(kind) ? (services[arg]?.port ?? null) : null;
}

/** Drift messages for every assignment of `key` in `text` whose port != expected. */
function portIssues(label, text, key, expectedPort) {
  return findAssignments(text, key).flatMap((val) => {
    const got = (val.match(/:(\d+)/) || [])[1];
    return got && got !== String(expectedPort)
      ? [`${label}: ${key}="${val}" points at port ${got}, expected ${expectedPort}`]
      : [];
  });
}

function buildBlock() {
  const lines = generatedEntries().map(([k, v]) => `  ${k}: "${v}"`);
  return [
    `  ${BEGIN}`,
    `  # Regenerate: node scripts/gen-service-topology.js generate  —  do NOT hand-edit.`,
    ...lines,
    `  ${END}`,
  ].join('\n');
}

function cmdGenerate() {
  const text = fs.readFileSync(CONFIGMAP_PATH, 'utf8');
  const beginRe = new RegExp(`^[ \\t]*${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm');
  const endRe = new RegExp(`^[ \\t]*${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm');
  const bMatch = text.match(beginRe);
  const eMatch = text.match(endRe);
  if (!bMatch || !eMatch) {
    console.error(`[ERROR] Generated-block markers not found in ${path.relative(ROOT, CONFIGMAP_PATH)}.`);
    console.error(`        Add a region delimited by:\n          ${BEGIN}\n          ${END}`);
    process.exit(1);
  }
  const start = bMatch.index;
  const end = eMatch.index + eMatch[0].length;
  const next = text.slice(0, start) + buildBlock() + text.slice(end);
  if (next === text) {
    console.log('[OK] configmap already up to date.');
  } else {
    fs.writeFileSync(CONFIGMAP_PATH, next);
    console.log(`[OK] Regenerated ${path.relative(ROOT, CONFIGMAP_PATH)} from service-topology.json.`);
  }
}

/** Collect every "KEY: value" / "KEY=value" assignment for the given key. */
function findAssignments(text, key) {
  const re = new RegExp(`^[ \\t]*${key}\\s*[:=]\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'gm');
  return [...text.matchAll(re)].map((m) => m[1].trim());
}

const dotenvMap = topo.dotenv || {};

function cmdCheck() {
  const issues = [];

  // 1. configmap: generated block must equal what we'd produce now.
  const cmText = fs.readFileSync(CONFIGMAP_PATH, 'utf8');
  for (const [k, v] of generatedEntries()) {
    const found = findAssignments(cmText, k);
    if (found.length === 0) {
      issues.push(`configmap: managed key ${k} is missing (expected "${v}")`);
    } else if (!found.includes(v)) {
      issues.push(`configmap: ${k}="${found.join(', ')}" but topology says "${v}"`);
    }
  }
  if (!cmText.includes(BEGIN) || !cmText.includes(END)) {
    issues.push('configmap: generated-block markers missing — run `generate`');
  }

  // 1b. No hand-added keys inside the generated block — `generate` silently
  //     drops them (this bit CODEGRAPH_DB_PATH, HITL_SERVICE_URL, CHAT_WS_HOST).
  const bIdx = cmText.indexOf(BEGIN);
  const eIdx = cmText.indexOf(END);
  if (bIdx !== -1 && eIdx !== -1) {
    const managed = new Set(generatedEntries().map(([k]) => k));
    for (const line of cmText.slice(bIdx, eIdx).split('\n')) {
      const m = line.match(/^[ \t]*([A-Z][A-Z0-9_]*)\s*:/);
      if (m && !managed.has(m[1])) {
        issues.push(
          `configmap: ${m[1]} is hand-added inside the generated block — \`generate\` will drop it; add it to service-topology.json or move it below the END marker`
        );
      }
    }
  }

  // 2. docker-compose: managed URL keys must hit the right port; flag must match.
  if (fs.existsSync(COMPOSE_PATH)) {
    const dc = fs.readFileSync(COMPOSE_PATH, 'utf8');
    for (const [k, deriv] of Object.entries(configmapMap)) {
      if (k === '_comment') continue;
      const port = expectedPortFor(deriv);
      if (port != null) {
        issues.push(...portIssues('docker-compose', dc, k, port));
      } else if (deriv.startsWith('flag:')) {
        const want = resolve(deriv);
        for (const val of findAssignments(dc, k)) {
          if (val !== want) issues.push(`docker-compose: ${k}="${val}" but topology flag is "${want}"`);
        }
      }
    }
  }

  // 3. .env.example: every local URL key must hit the PORT of its target
  //    service (host/scheme legitimately differ locally — 127.0.0.1 / mkcert).
  //    The target is per-key because some keys route differently locally (e.g.
  //    MCP_SERVER_URL goes through the gateway, not the MCP server).
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    const env = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    for (const [k, svcName] of Object.entries(dotenvMap)) {
      if (k === '_comment') continue;
      const port = services[svcName]?.port;
      if (port == null) {
        issues.push(`service-topology.json: dotenv key ${k} -> unknown service "${svcName}"`);
      } else {
        issues.push(...portIssues('.env.example', env, k, port));
      }
    }
  }

  if (issues.length) {
    for (const i of issues) console.error(`[DRIFT] ${i}`);
    console.error(`\n[FAIL] ${issues.length} drift issue(s). Run \`node scripts/gen-service-topology.js generate\` and fix docker-compose to match service-topology.json.`);
    process.exit(1);
  }
  console.log('[OK] No drift. configmap + docker-compose + .env.example match service-topology.json.');
}

/**
 * Merge-patch JSON overriding every public-derived configmap key with the
 * given origin (built from the origin string directly, so portless origins
 * like https://demo.example.com work — resolve() always emits a port).
 */
function cmdPublicPatch(origin) {
  if (!/^https?:\/\//.test(origin || '')) {
    console.error('Usage: node scripts/gen-service-topology.js public-patch <https://origin>');
    process.exit(1);
  }
  const base = origin.replace(/\/+$/, '');
  const data = Object.fromEntries(
    Object.entries(configmapMap)
      .filter(([k, d]) => k !== '_comment' && (d === 'public' || String(d).startsWith('public:')))
      .map(([k, d]) => [k, base + (d === 'public' ? '' : String(d).slice('public:'.length))])
  );
  console.log(JSON.stringify({ data }));
}

const mode = process.argv[2];
if (mode === 'generate') cmdGenerate();
else if (mode === 'check') cmdCheck();
else if (mode === 'public-patch') cmdPublicPatch(process.argv[3]);
else {
  console.error('Usage: node scripts/gen-service-topology.js {generate|check|public-patch <origin>}');
  process.exit(1);
}
