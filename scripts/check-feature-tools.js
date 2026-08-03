#!/usr/bin/env node
/*
 * check-feature-tools.js — cross-service drift guard for vertical feature pages.
 *
 * For every vertical whose manifest declares a `featurePage`, the feature tool
 * (`featurePage.mcpTool`, e.g. "show_permit") must be wired into the API-key
 * path across FOUR services, or the 5th chip silently breaks (routes to the
 * wrong backend / "unknown tool" / 404). The scope side is covered by the boot
 * verticalConsistencyGuard + gen-scope-topology; this covers the plumbing side
 * the BFF guard can't see (separate TS/JS services).
 *
 * Checks each feature tool name appears in:
 *   - demo_mcp_gateway/src/router.ts           (APIKEY_TOOLS + APIKEY_BACKEND_ROUTES)
 *   - demo_mcp_gateway/src/apiKeyDispatch.ts   (TOOL_DISPLAY_NAMES)
 *   - oauth-mcp/src/tools/BankingToolRegistry.ts  (TOOLS registry)
 *   - demo_api_resource_server/server.js          (VERTICALS backend record, via the route-segment)
 *
 * Text-based (greps the source) so it needs no build. check-only — it reports
 * drift and exits 1; it never rewrites another service's source.
 *
 * Usage: node scripts/check-feature-tools.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// For each file, `requires(tool)` returns the list of substrings that must ALL
// be present for that tool — so a PARTIAL omission (e.g. in APIKEY_TOOLS but not
// APIKEY_BACKEND_ROUTES) is caught, not just a total one.
const TARGETS = [
  {
    file: 'demo_mcp_gateway/src/router.ts',
    label: 'gateway APIKEY_TOOLS + APIKEY_BACKEND_ROUTES',
    requires: (t) => [`'${t}'`, `${t}:`], // Set membership AND route-map key
  },
  {
    file: 'demo_mcp_gateway/src/apiKeyDispatch.ts',
    label: 'gateway TOOL_DISPLAY_NAMES',
    requires: (t) => [`${t}:`],
  },
  {
    file: 'oauth-mcp/src/tools/BankingToolRegistry.ts',
    label: 'MCP server TOOLS registry',
    requires: (t) => [`${t}:`],
  },
];

function featureToolsFromManifests() {
  // eslint-disable-next-line global-require
  const { verticalManifest } = require('../demo_api_server/services/verticalManifest');
  verticalManifest.init();
  const out = [];
  for (const summary of verticalManifest.list()) {
    let m;
    try { m = verticalManifest.resolver.resolve(summary.id); } catch (_e) { continue; }
    const tool = m && m.featurePage && m.featurePage.mcpTool;
    if (tool) out.push({ vertical: summary.id, tool });
  }
  return out;
}

function readFileSafe(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_e) { return null; }
}

function main() {
  const entries = featureToolsFromManifests();
  const sources = TARGETS.map((t) => ({ ...t, text: readFileSafe(t.file) }));
  const backendText = readFileSafe('demo_api_resource_server/server.js');
  // A backend record can live in server.js's inline VERTICALS map OR in the
  // generated file (records migrated to config/verticals/<id>/feature-data.json).
  let generatedRoutes = [];
  try {
    const gen = JSON.parse(readFileSafe('demo_api_resource_server/feature-records.generated.json') || '{}');
    generatedRoutes = Object.keys(gen).filter((k) => k !== '_generated');
  } catch (_e) { /* no generated file */ }

  const issues = [];
  for (const { vertical, tool } of entries) {
    for (const s of sources) {
      if (s.text == null) { issues.push(`${s.file} not found (cannot verify "${tool}")`); continue; }
      const missing = s.requires(tool).filter((needle) => !s.text.includes(needle));
      if (missing.length) {
        issues.push(`vertical "${vertical}": feature tool "${tool}" missing ${missing.map((x) => `\`${x}\``).join(' + ')} in ${s.label} (${s.file})`);
      }
    }
    // backend: the route-segment is what the gateway sends; we can only confirm
    // the gateway declares a backend route for the tool (router.ts), which the
    // gateway check above covers. The backend record itself is keyed by route
    // segment, not tool name, so we surface a soft reminder when the gateway
    // route map references a segment with no matching backend record.
    const router = sources.find((s) => s.file.endsWith('router.ts'));
    if (router && router.text) {
      const m = router.text.match(new RegExp(`${tool}:\\s*'([a-z0-9_-]+)'`));
      if (m) {
        const seg = m[1];
        const inInline = backendText && new RegExp(`\\b${seg}:\\s*{`).test(backendText);
        const inGenerated = generatedRoutes.includes(seg);
        if (!inInline && !inGenerated) {
          issues.push(`vertical "${vertical}": gateway routes "${tool}" -> backend segment "${seg}" but there is no matching record in demo_api_resource_server/server.js (inline) nor feature-records.generated.json (run: node scripts/gen-feature-data.js generate)`);
        }
      }
    }
  }

  if (issues.length === 0) {
    console.log(`[OK] all ${entries.length} feature tool(s) are wired across the gateway, MCP registry, and backend.`);
    return;
  }
  console.error(`[FAIL] ${issues.length} feature-tool wiring gap(s):\n  - ${issues.join('\n  - ')}\n  See the add-vertical skill, Step 6 (feature-page backend).`);
  process.exit(1);
}

main();
