#!/usr/bin/env node
/**
 * gen-gateway-enforcement-map.js — derives a Mermaid diagram of WHERE each of
 * the 5 P1AZ-unexpressable rules (snapshots/gen-authorize-snapshot.js:30-47)
 * is actually enforced today, by grepping the real source files rather than
 * hand-maintaining a diagram that drifts from the code.
 *
 * Re-run this after landing any task from
 * docs/superpowers/plans/2026-08-12-gateway-local-enforcement.md (or any other
 * change to the files below) and both outputs below update to match reality:
 *
 *   - docs/gateway-enforcement-map.md                                  (repo doc)
 *   - demo_api_ui/src/components/education/gatewayEnforcementDiagram.generated.js
 *     (single source the Learning Hub panel renders — do not hand-edit)
 *
 * Usage:  node scripts/gen-gateway-enforcement-map.js          (writes in place)
 *         node scripts/gen-gateway-enforcement-map.js --check  (fail if out of date)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const readFile = (p) => {
  try { return fs.readFileSync(path.join(REPO, p), 'utf8'); } catch { return ''; }
};
const has = (content, needle) => content.includes(needle);

// ── P1AZ column — sourced from the actual "DELIBERATELY NOT MODELED" comment
// block in the snapshot generator, not hardcoded prose. If that block's
// reasoning changes, this regenerates with it. ──────────────────────────────
const snapshotGen = readFile('snapshots/gen-authorize-snapshot.js');
const notModeledBlock = (() => {
  const start = snapshotGen.indexOf('DELIBERATELY NOT MODELED');
  const end = snapshotGen.indexOf('Usage:', start);
  return start >= 0 ? snapshotGen.slice(start, end >= 0 ? end : undefined) : '';
})();
const p1azReasonFor = (marker, fallback) => {
  const idx = notModeledBlock.indexOf(marker);
  if (idx < 0) return fallback;
  const line = notModeledBlock.slice(idx, notModeledBlock.indexOf('\n *   -', idx + 1) || idx + 400);
  const cleaned = line.replace(/\s*\*\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 220) return cleaned;
  const cut = cleaned.slice(0, 220);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}…`;
};

// ── Node gateway (demo_mcp_gateway) checks ──────────────────────────────────
const gatewayTokenPolicy = readFile('demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts');
const rarEnforce = readFile('demo_mcp_gateway/src/rarEnforce.ts');
const tokenValidator = readFile('demo_mcp_gateway/src/tokenValidator.ts');
const toolScopes = readFile('demo_mcp_gateway/src/auth/toolScopes.ts');
const tierEnforceNode = readFile('demo_mcp_gateway/src/tierEnforce.ts');

// ── IG gateway (ping-gateway groovy) checks ─────────────────────────────────
const p1azDecisionGroovy = readFile('ping-gateway/scripts/groovy/p1az-decision.groovy');

const ROWS = [
  {
    id: 'temporal',
    label: 'Temporal exp/iat/nbf',
    scenario: 'A token minted hours ago, past the demo\'s replay window, gets replayed against a tool call — exp alone doesn\'t catch this, only iat max-age does.',
    p1az: p1azReasonFor('Temporal exp/iat/nbf', 'Timestamp attr is ISO 8601 string vs epoch-second token claims'),
    node: {
      done: has(tokenValidator, 'token_too_old') && has(tokenValidator, 'invalid_iat'),
      note: 'iat max-age check in tokenValidator.ts',
    },
    groovy: {
      done: has(p1azDecisionGroovy, 'token_too_old') || has(p1azDecisionGroovy, "'invalid_iat'"),
      note: 'local iat/nbf deny in p1az-decision.groovy (default olb route has no local temporal recheck otherwise)',
    },
  },
  {
    id: 'scope',
    label: 'Per-tool scope membership',
    scenario: 'A token carries the coarse gateway:mcp:invoke scope but never earned transfer — and tries to call create_transfer anyway.',
    p1az: p1azReasonFor('Per-tool scope membership', 'TokenScopes is a space-separated set; DSL has no set/contains operator'),
    node: {
      done: has(toolScopes, 'evaluateScopeDecisionUnconditionally'),
      note: 'unconditional Rule-3-parity backstop (A2A-safe) in toolScopes.ts',
    },
    groovy: {
      done: has(p1azDecisionGroovy, 'scope-topology.json'),
      note: 'local scope backstop reading scope-topology.json in p1az-decision.groovy',
    },
  },
  {
    id: 'rar',
    label: 'RAR payee allow-list',
    scenario: 'A transfer\'s granted intent named one payee — the actual call sends the funds somewhere else.',
    p1az: p1azReasonFor('RAR payee allow-list', 'permitted payees are an array; same missing set-membership operator'),
    node: {
      done: has(rarEnforce, 'is not the granted payee'),
      note: 'rarEnforce.ts — unconditional, gated on REQUIRE_RAR_INTENT',
    },
    groovy: {
      done: has(p1azDecisionGroovy, 'rar_payee_not_permitted'),
      // Forwarding the RAR attrs to the PDP IS the enforcement on this path — the
      // groovy filter deliberately does not DENY locally (p1az-decision.groovy:716-718).
      byDesign: has(p1azDecisionGroovy, 'parameters.RarMaxAmount'),
      note: 'forwards RarAuthorizationDetails/RarMaxAmount/RarPermittedPayees so the cloud RarMaxAmount rule decides (p1az-decision.groovy:716-718); the local payee DENY stays opt-in behind PG_LOCAL_RAR_PAYEE_ENFORCE',
    },
  },
  {
    id: 'd05',
    label: 'D-05 multi-aud anti-bypass',
    scenario: 'An agent presents a token whose aud already targets the banking resource server directly — skipping the gateway hop entirely.',
    p1az: p1azReasonFor('D-05 multi-aud', 'TokenAudTargetsUpstream compares a SINGLE aud string'),
    node: {
      done: has(gatewayTokenPolicy, 'bypass_attempt'),
      note: 'GatewayTokenPolicy.ts — unconditional, every inbound token',
    },
    groovy: {
      done: has(p1azDecisionGroovy, "'bypass_attempt'"),
      note: 'local deny using the forwarded TokenAudActual, mirroring GatewayTokenPolicy.ts',
    },
  },
  {
    id: 'tier',
    label: 'tiers.groupToTier mapping',
    scenario: 'A Standard-tier caller invokes a PrivateBanking-only tool, or tries to move more than their tier\'s ceiling.',
    p1az: p1azReasonFor('tiers.groupToTier', 'mapping a PingOne group ARRAY to a tier needs set membership'),
    node: {
      done: fs.existsSync(path.join(REPO, 'demo_mcp_gateway/src/tierEnforce.ts')) && has(tierEnforceNode, 'evaluateTierDecision'),
      note: 'tierEnforce.ts, reads X-User-Tier/X-Tier-Max-Amount-Usd/X-Tier-Restricted-Tools headers from the BFF',
    },
    groovy: {
      done: has(p1azDecisionGroovy, 'tier_tool_not_allowed'),
      note: 'reads the same 3 headers the Node gateway does',
    },
  },
];

// Shared status vocabulary. Keep in lockstep with the STATUS_LABEL maps in
// demo_api_ui/src/components/GatewayEnforcementMapPage.jsx and
// demo_api_ui/src/components/education/GatewayPolicySplitPanel.js.
const STATUS_LABEL = {
  done: '✅ enforced',
  bydesign: '✅ P1AZ owns the decision',
  flagged: '✅ built · opt-in flag',
  pending: 'planned — P1AZ covers it today',
};
const STATUS_ICON = { done: '✅', bydesign: '✅', flagged: '✅', pending: '⚠️' };

/** 'bydesign' = this gateway hands the check to the cloud PDP on purpose (it
 * forwards the attributes and P1AZ decides) — covered, not a gap. */
function status(cell) {
  if (cell.byDesign) return 'bydesign';
  if (cell.flagged) return cell.done ? 'flagged' : 'pending';
  return cell.done ? 'done' : 'pending';
}

/** The weaker of the two gateways' coverage for a rule. Rank:
 * pending > flagged > bydesign > done. */
function worstTier(row) {
  const n = status(row.node);
  const g = status(row.groovy);
  if (n === 'pending' || g === 'pending') return 'pending';
  if (n === 'flagged' || g === 'flagged') return 'flagged';
  if (n === 'bydesign' || g === 'bydesign') return 'bydesign';
  return 'done';
}

function verdictTextFor(row, tier) {
  if (tier === 'done') return 'Enforced at both gateways';
  if (tier === 'pending') return 'P1AZ owns this today · gateway backstop planned';
  if (tier === 'bydesign') return 'Node enforces locally · IG delegates to P1AZ by design';
  const nodeOk = status(row.node) === 'done';
  const groovyOk = status(row.groovy) === 'done';
  if (nodeOk && !groovyOk) return 'Enforced at the Node gateway · IG behind an opt-in flag';
  if (groovyOk && !nodeOk) return 'Enforced at the IG gateway · Node behind an opt-in flag';
  return 'Enforced — one gateway behind an opt-in flag';
}

function buildJourneyMermaid() {
  const lines = ['flowchart LR'];
  lines.push('  REQ["Tool call arrives"] --> P1AZ["P1AZ decides business policy"]');
  for (const row of ROWS) {
    lines.push(`  P1AZ -.->|delegates to PEP| b_${row.id}["${row.label}"]`);
  }
  for (const row of ROWS) {
    lines.push(`  b_${row.id} --> GW["Gateway enforces at the PEP"]`);
  }
  lines.push('  GW --> DEC["Final decision"]');
  lines.push('  classDef done fill:#0a2418,color:#6ee7b7,stroke:#059669,stroke-width:1px');
  lines.push('  classDef bydesign fill:#062b2b,color:#5eead4,stroke:#0d9488,stroke-width:1px');
  lines.push('  classDef flagged fill:#2a1a00,color:#fbbf24,stroke:#d97706,stroke-width:1px,stroke-dasharray:2 2');
  lines.push('  classDef pending fill:#2d0a0a,color:#fca5a5,stroke:#dc2626,stroke-width:1px,stroke-dasharray:4 4');
  for (const s of ['done', 'bydesign', 'flagged', 'pending']) {
    const ids = ROWS.filter((r) => worstTier(r) === s).map((r) => `b_${r.id}`);
    if (ids.length) lines.push(`  class ${ids.join(',')} ${s}`);
  }
  return lines.join('\n');
}

function buildStakes() {
  return ROWS.map((r) => {
    const tier = worstTier(r);
    return { id: r.id, label: r.label, scenario: r.scenario, verdictTier: tier, verdictText: verdictTextFor(r, tier) };
  });
}

function buildMarkdownTable() {
  const cell = (c) => `${STATUS_LABEL[status(c)]} — ${c.note}`;
  const rows = ROWS.map((r) => `| ${r.label} | ${r.p1az} | ${cell(r.node)} | ${cell(r.groovy)} |`).join('\n');
  return `| Check | Why the gateway owns it | Node gateway | IG gateway (groovy) |\n|---|---|---|---|\n${rows}`;
}

const journeyMermaid = buildJourneyMermaid();
const stakes = buildStakes();
const markdownTable = buildMarkdownTable();
const covered = (c) => ['done', 'bydesign', 'flagged'].includes(status(c));
const liveCount = ROWS.reduce((n, r) => n + (covered(r.node) ? 1 : 0) + (covered(r.groovy) ? 1 : 0), 0);

const stakesMarkdown = stakes.map((s) => (
  `**${s.label}**\n> ${s.scenario}\n\n${STATUS_ICON[s.verdictTier]} ${s.verdictText}`
)).join('\n\n');

const docOut = `# Gateway Local Enforcement Map

GENERATED by \`node scripts/gen-gateway-enforcement-map.js\` from the actual source
files listed below — do not hand-edit. Re-run after changing any of them; this
file and \`demo_api_ui/src/components/education/gatewayEnforcementDiagram.generated.js\`
regenerate together from the same scan.

Scanned files: \`snapshots/gen-authorize-snapshot.js\`,
\`demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts\`, \`demo_mcp_gateway/src/rarEnforce.ts\`,
\`demo_mcp_gateway/src/tokenValidator.ts\`, \`demo_mcp_gateway/src/auth/toolScopes.ts\`,
\`demo_mcp_gateway/src/tierEnforce.ts\`, \`ping-gateway/scripts/groovy/p1az-decision.groovy\`.

Current state: **${liveCount}/10** checks live (5 checks × 2 gateways).
See \`docs/superpowers/plans/2026-08-12-gateway-local-enforcement.md\` for the
implementation plan behind them.

**Reading the diagram:** P1AZ (the cloud PDP) decides business policy — amount,
tier, group, step-up, HITL. These 5 checks run at the PEP instead, where the raw
token claims and call parameters actually live. Each branches to the gateway that
enforces it, then reconverges on one decision.

\`\`\`mermaid
${journeyMermaid}
\`\`\`

## What each check stops

${stakesMarkdown}

## Detail

${markdownTable}
`;

const uiOut = `// GENERATED by scripts/gen-gateway-enforcement-map.js — do not hand-edit.
// Re-run that script after any change to the files it scans (see the script's
// header comment) and this file regenerates in lockstep with docs/gateway-enforcement-map.md.

export const GATEWAY_ENFORCEMENT_JOURNEY_MERMAID = \`${journeyMermaid}\`;

export const GATEWAY_ENFORCEMENT_STAKES = ${JSON.stringify(stakes, null, 2)};

export const GATEWAY_ENFORCEMENT_ROWS = ${JSON.stringify(
  ROWS.map((r) => ({
    id: r.id,
    label: r.label,
    p1az: r.p1az,
    node: { status: status(r.node), note: r.node.note },
    groovy: { status: status(r.groovy), note: r.groovy.note },
  })),
  null,
  2,
)};
`;

const docPath = path.join(REPO, 'docs/gateway-enforcement-map.md');
const uiPath = path.join(REPO, 'demo_api_ui/src/components/education/gatewayEnforcementDiagram.generated.js');

if (process.argv.includes('--check')) {
  const currentDoc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
  const currentUi = fs.existsSync(uiPath) ? fs.readFileSync(uiPath, 'utf8') : '';
  const drift = currentDoc !== docOut || currentUi !== uiOut;
  if (drift) {
    console.error('gateway-enforcement-map is OUT OF DATE — run: node scripts/gen-gateway-enforcement-map.js');
    process.exit(1);
  }
  console.log('gateway-enforcement-map is up to date.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(docPath), { recursive: true });
fs.mkdirSync(path.dirname(uiPath), { recursive: true });
fs.writeFileSync(docPath, docOut);
fs.writeFileSync(uiPath, uiOut);
console.log(`Wrote ${path.relative(REPO, docPath)}`);
console.log(`Wrote ${path.relative(REPO, uiPath)}`);
console.log(`${liveCount}/10 checks currently live.`);
