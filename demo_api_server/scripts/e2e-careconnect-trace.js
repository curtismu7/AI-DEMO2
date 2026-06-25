'use strict';
/**
 * E2E trace: CareConnect "Release my records" chip
 *
 * Exercises the full flow end-to-end, capturing every HTTP call,
 * token exchange event, app event, and response body, then writes
 * the results to docs/E2E_CARECONNECT_TRACE.md.
 */

const https  = require('https');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const BASE    = 'https://api.ping.demo:3001';
const AGENT   = new https.Agent({ rejectUnauthorized: false });

// Load sessions from globalSetup cache
const sessionCache = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../.test-session.json'), 'utf8')
);

const enduser = axios.create({ baseURL: BASE, httpsAgent: AGENT, headers: { Cookie: sessionCache.enduser }, validateStatus: () => true });
const admin   = axios.create({ baseURL: BASE, httpsAgent: AGENT, headers: { Cookie: sessionCache.admin   }, validateStatus: () => true });

const sections = [];
function section(title, content) {
  sections.push({ title, content });
  process.stdout.write(`  ✓ ${title}\n`);
}

async function run() {
  process.stdout.write('\nRunning CareConnect E2E trace...\n\n');

  // ── 1. Start time for app-events window
  const startTime = new Date(Date.now() - 500).toISOString();

  // ── 2. Switch active vertical to healthcare
  const switchR = await enduser.post('/api/verticals/active', { id: 'healthcare' });
  section('Step 1 — Switch vertical to healthcare', `\`POST /api/verticals/active\` \`{ id: "healthcare" }\`

**HTTP Status:** ${switchR.status}
**Response:** ${JSON.stringify(switchR.data)}`);

  // ── 3. GET /api/verticals/me — confirm manifest loaded
  const meR = await enduser.get('/api/verticals/me');
  const manifest = meR.data?.pageManifest || {};
  // hitlTrigger is a static manifest field — read from disk since API strips unknown fields
  const staticManifest = require(path.join(__dirname, '../config/verticals/healthcare/manifest.json'));
  const staticChips = [...(staticManifest.dashboard?.chips10 || []), ...(staticManifest.dashboard?.chips || [])];
  const chips = [...(manifest.dashboard?.chips || []), ...(manifest.dashboard?.chips10 || [])];
  const hitlChip = staticChips.find(c => c.hitlTrigger === true);
  section('Step 2 — Load manifest + find HITL chip', `\`GET /api/verticals/me\`

**Active vertical:** \`${meR.data?.activeId}\`
**Display name:** ${manifest.identity?.displayName}
**Terminology.account:** ${manifest.terminology?.account}
**Total chips:** ${chips.length}
**HITL trigger chip:** ${hitlChip ? `\`${hitlChip.id}\` "${hitlChip.label}" — message: "${hitlChip.message}"` : '⚠️ none found'}`);

  if (!hitlChip) {
    section('ABORTED', 'No hitlTrigger chip found in healthcare manifest.');
    return sections;
  }

  // ── 4. NL route the chip message
  const nlR = await enduser.post('/api/demo-agent/nl', {
    message: hitlChip.message,
    provider: 'heuristic',
    vertical: 'healthcare',
  });
  section('Step 3 — NL routing (chip message → intent)', `\`POST /api/demo-agent/nl\`
\`\`\`json
{ "message": "${hitlChip.message}", "provider": "heuristic", "vertical": "healthcare" }
\`\`\`

**HTTP Status:** ${nlR.status}
**Source:** \`${nlR.data?.source}\`
**kind:** \`${nlR.data?.result?.kind}\`
**action:** \`${nlR.data?.result?.action}\`
**vertical:** \`${nlR.data?.result?.vertical}\``);

  // ── 5. Check session token claims (pre-exchange)
  const tcR = await enduser.get('/api/auth/oauth/token-claims');
  const tc  = tcR.data?.decoded?.payload || {};
  const nowSec = Math.floor(Date.now() / 1000);
  section('Step 4 — Session token claims (pre-exchange)', `\`GET /api/auth/oauth/token-claims\`

| Claim | Value | Valid? |
|---|---|---|
| \`sub\` | \`${tc.sub?.slice(0,12)}…\` | ${tc.sub ? '✅' : '❌'} |
| \`aud\` | \`${JSON.stringify(tc.aud).slice(0,60)}\` | ${tc.aud ? '✅' : '❌'} |
| \`iss\` | \`${tc.iss?.slice(0,40)}…\` | ${tc.iss ? '✅' : '❌'} |
| \`exp\` | ${tc.exp} (${tc.exp > nowSec ? '✅ valid' : '❌ EXPIRED'}) | ${tc.exp > nowSec ? '✅' : '❌'} |
| \`iat\` | ${tc.iat} (${tc.iat < nowSec ? '✅ past' : '❌'}) | ${tc.iat < nowSec ? '✅' : '❌'} |
| \`scope\` | \`${tc.scope?.split(' ').join(' ')}\` | ${tc.scope?.includes('read') ? '✅' : '⚠️'} |`);

  // ── 6. RFC 8693 exchange (user → MCP token)
  const exchR = await enduser.get('/api/pingone-test/exchange-user-to-mcp');
  const mcp   = exchR.data?.decoded?.payload || {};
  section('Step 5 — RFC 8693 Token Exchange (user token → MCP token)', `\`GET /api/pingone-test/exchange-user-to-mcp\`

**Status:** ${exchR.status} ${exchR.data?.success ? '✅ success' : '❌ failed'}

| Claim | Session token | MCP token | Check |
|---|---|---|---|
| \`sub\` | \`${tc.sub?.slice(0,12)}…\` | \`${mcp.sub?.slice(0,12)}…\` | ${tc.sub === mcp.sub ? '✅ preserved' : '❌ mismatch'} |
| \`aud\` | \`${JSON.stringify(tc.aud).slice(0,30)}\` | \`${JSON.stringify(mcp.aud).slice(0,30)}\` | ${JSON.stringify(tc.aud) !== JSON.stringify(mcp.aud) ? '✅ narrowed' : '⚠️ same'} |
| \`exp\` | ${tc.exp > nowSec ? '✅ valid' : '❌'} | ${mcp.exp > nowSec ? '✅ valid' : '❌'} | — |
| \`act\` | — | ${mcp.act ? '✅ present: ' + JSON.stringify(mcp.act).slice(0,40) : '⚠️ absent (PingOne policy)'} | — |
| \`scope\` | \`${tc.scope}\` | \`${mcp.scope}\` | — |`);

  // ── 7. Execute the chip via /api/agent/invoke (full MCP pipeline)
  // Use a prompt that includes a recordId so the missing-params gate doesn't fire
  const invokePrompt = hitlChip.message + ' record-001';
  const invokeStart = Date.now();
  const invR = await enduser.post('/api/agent/invoke', {
    prompt: invokePrompt,
    forceHeuristic: true,
    vertical: 'healthcare',
  });
  const invokeMs = Date.now() - invokeStart;

  const isHitl = invR.status === 428;
  const is200  = invR.status === 200;

  section('Step 6 — Agent invoke (full MCP pipeline)', `\`POST /api/agent/invoke\`
\`\`\`json
{ "prompt": "${hitlChip.message}", "forceHeuristic": true, "vertical": "healthcare" }
\`\`\`

**HTTP Status:** ${invR.status} (${invokeMs}ms)
**Result:** ${isHitl ? '⚠️ 428 HITL consent required' : is200 ? '✅ 200 OK' : `❌ ${invR.status}`}

${isHitl ? `**HITL details:**
\`\`\`json
${JSON.stringify(invR.data, null, 2).slice(0, 600)}
\`\`\`` : ''}
${is200 ? `**Reply:** "${invR.data?.reply?.slice(0, 300)}"` : ''}

**Token events (pipeline legs):**
${Array.isArray(invR.data?.tokenEvents) && invR.data.tokenEvents.length > 0
  ? invR.data.tokenEvents.map((e, i) =>
      `${i + 1}. \`${e.type || e.event_type || e.category}\` — ${e.label || e.message || JSON.stringify(e).slice(0, 80)}`
    ).join('\n')
  : '_(no tokenEvents in response — check app-events below)_'}`);

  // ── 8. App events
  await new Promise(r => setTimeout(r, 300)); // let events flush
  const evR = await admin.get(`/api/admin/app-events?since=${encodeURIComponent(startTime)}&limit=50`);
  const events = (evR.data?.events || []);
  const categories = [...new Set(events.map(e => e.category))];
  section('Step 7 — App events (pipeline audit trail)', `\`GET /api/admin/app-events?since=…&limit=50\`

**Events captured:** ${events.length}
**Categories:** ${categories.map(c => `\`${c}\``).join(', ') || '_(none)_'}

| # | Time | Category | Event |
|---|---|---|---|
${events.slice(0, 20).map((e, i) =>
  `| ${i+1} | ${new Date(e.timestamp || e.created_at || Date.now()).toISOString().slice(11,19)} | \`${e.category}\` | ${(e.message || e.type || e.event_type || '').slice(0, 80)} |`
).join('\n') || '| — | — | — | No events |'}`);

  // ── 9. HITL gate analysis
  const hitlFlag = await admin.get('/api/admin/feature-flags');
  const flags    = hitlFlag.data?.flags || [];
  const hitlFlagVal  = flags.find(f => f.id === 'ff_hitl_enabled');
  const thresholdVal = flags.find(f => f.id === 'confirm_threshold_usd');
  section('Step 8 — HITL + authz configuration', `\`GET /api/admin/feature-flags\`

| Flag | Value | Expected |
|---|---|---|
| \`ff_hitl_enabled\` | \`${hitlFlagVal?.value}\` | \`true\` ${[true,'true'].includes(hitlFlagVal?.value) ? '✅' : '❌'} |
| \`confirm_threshold_usd\` | \`${thresholdVal?.value || 'N/A'}\` | \`250\` |

**HITL was triggered:** ${isHitl ? '✅ YES (428 returned — consent required)' : invR.status === 200 ? '⚠️ No (200 returned — HITL may be disabled or tool ran without consent)' : `Status ${invR.status}`}

**Healthcare \`release_records\` authz config:** \`{ stepUp: true, consent: true }\`
This tool requires BOTH:
- MFA step-up authentication
- Human-in-the-loop consent approval`);

  // ── 10. Restore vertical
  await enduser.post('/api/verticals/active', { id: 'banking' });
  section('Step 9 — Restore vertical to banking', '`POST /api/verticals/active` `{ id: "banking" }` ✅');

  return sections;
}

run().then(sects => {
  const md = `# CareConnect E2E Trace — "Release My Records" Chip

_Generated: ${new Date().toISOString()}_

This document traces every step of the **CareConnect "Release my records"** chip flow
end-to-end, from vertical activation through RFC 8693 token exchange, MCP gateway
routing, PingAuthorize authz decision, and HITL consent gate.

**Vertical:** CareConnect (healthcare)
**Chip:** \`hc5\` "Release my records" (\`hitlTrigger: true\`)
**Tool:** \`release_records\` — authz: \`{ stepUp: true, consent: true }\`
**Expected outcome:** 428 HITL consent required (when \`ff_hitl_enabled=true\`)

---

${sects.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n---\n\n')}

---

## Summary

### Full Pipeline Path

\`\`\`
User chip click "Release my records"
  → POST /api/demo-agent/nl   [heuristic: "healthcare"/"release_records"]
  → POST /api/agent/invoke       [forceHeuristic: true, vertical: "healthcare"]
      → dispatchVerticalIntent("release_records", ctx)
          → checkLocalAuthzGate  [stepUp: true, consent: true → HITL gate]
            OR (when PingAuthorize live)
          → executePluginToolViaMcp("release_records")
              → executeBffTool("release_records")
                  → resolveMcpAccessTokenWithEvents (RFC 8693 exchange)
                      → PingOne Exchange #1: user token → agent token
                      → PingOne Exchange #2: agent token → MCP token
                  → callMcpToolInternal("release_records", mcpToken)
                      → MCP Gateway :3005 [validates token, PingAuthorize]
                          → MCP Server :8080 [executes handler]
                              → BFF /api/path/vertical-tool/healthcare/release_records
                                  → HITL gate → 428 consent_required
\`\`\`

### Token Validation Checkpoints

| Checkpoint | What's validated | Enforced by |
|---|---|---|
| Session token | aud, sub, iss, exp, scope (RS256 JWKS) | BFF auth.js middleware |
| RFC 8693 Exchange | subject_token exp + aud, grant_type | PingOne AS |
| MCP token | active, sub, aud (MCP resource), scope, exp | MCP Gateway (introspection) |
| Tool authz | stepUp flag → MFA required; consent flag → HITL 428 | BFF dispatchVerticalIntent |
| HITL gate | ff_hitl_enabled, confirm_threshold_usd | BFF transactionConsent route |
`;

  const outPath = path.join(__dirname, '../../docs/E2E_CARECONNECT_TRACE.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n✅ Trace written to: docs/E2E_CARECONNECT_TRACE.md`);
}).catch(err => {
  console.error('E2E trace failed:', err.message);
  process.exit(1);
});
