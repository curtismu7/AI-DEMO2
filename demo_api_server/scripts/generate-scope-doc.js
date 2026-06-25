'use strict';

/**
 * generate-scope-doc.js — renders scope-topology.json to docs/scope-topology.md.
 * Never hand-edit docs/scope-topology.md; run `npm run scopes:doc`.
 * --stdout prints without writing (used by the sync regression test).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scope-topology.json'), 'utf8'));

function render() {
  const lines = [];
  lines.push('# Scope Topology (generated — do not edit by hand)');
  lines.push('');
  lines.push('> Source of truth: `scope-topology.json`. Regenerate with `npm run scopes:doc`.');
  lines.push('');
  lines.push('## Scopes');
  lines.push('');
  lines.push('| Scope | Risk | Resource | Description |');
  lines.push('|---|---|---|---|');
  for (const [name, s] of Object.entries(m.scopes)) {
    lines.push(`| \`${name}\` | ${s.riskLevel} | ${s.resource} | ${s.description} |`);
  }
  lines.push('');
  lines.push('## Resources');
  lines.push('');
  for (const [name, r] of Object.entries(m.resources)) {
    lines.push(`### ${name}`);
    lines.push('');
    if (r.uri) { lines.push(`Audience: \`${r.uri}\``); lines.push(''); }
    lines.push(`Native scopes: ${(r.scopes || []).map(s => `\`${s}\``).join(', ') || '—'}`);
    lines.push('');
    if (r.mirroredScopes && r.mirroredScopes.length) {
      lines.push(`Mirrored scopes (RFC 8693 exchange-hop, ARCHITECTURE-TRUTHS T-10): ${r.mirroredScopes.map(s => `\`${s}\``).join(', ')}`);
      lines.push('');
    }
  }
  if (m.servers && Object.keys(m.servers).length) {
    lines.push('## Servers');
    lines.push('');
    lines.push('| Service | Resource | Validates aud | Gates on tool scopes | Notes |');
    lines.push('|---|---|---|---|---|');
    for (const [name, sv] of Object.entries(m.servers)) {
      lines.push(`| \`${name}\` | ${sv.resource} | \`${sv.validatesAudience || '—'}\` | ${sv.gatesOnToolScopes ? 'yes' : 'no'} | ${sv.description || ''} |`);
    }
    lines.push('');
  }
  lines.push('## App Grants');
  lines.push('');
  for (const [name, a] of Object.entries(m.apps)) {
    lines.push(`### ${name}`);
    lines.push('');
    if (a.type) lines.push(`Type: \`${a.type}\`${a.grantTypes ? `  ·  Grants: ${a.grantTypes.map(g => `\`${g}\``).join(', ')}` : ''}`);
    if (a.type) lines.push('');
    if (a.isResourceServer) { lines.push(`Is resource server: \`${a.isResourceServer}\``); lines.push(''); }
    lines.push(`Granted scopes: ${(a.grantedScopes || []).map(s => `\`${s}\``).join(', ') || '— (none; resource-server or worker app)'}`);
    lines.push('');
  }
  lines.push('## Tool → Scope Dependencies');
  lines.push('');
  lines.push('| Tool | Surface | Required Scopes | Challenge |');
  lines.push('|---|---|---|---|');
  for (const [name, t] of Object.entries(m.tools)) {
    lines.push(`| \`${name}\` | ${t.surface} | ${t.requiredScopes.map(s => `\`${s}\``).join(' ')} | ${t.challengeType || '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const out = render();
if (process.argv.includes('--stdout')) {
  process.stdout.write(out);
} else {
  fs.writeFileSync(path.join(ROOT, 'docs/scope-topology.md'), out);
  console.log('Wrote docs/scope-topology.md');
}
