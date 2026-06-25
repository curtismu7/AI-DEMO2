#!/usr/bin/env node
'use strict';

/**
 * routingEval.js — generalized routing eval for ANY vertical. Reads the
 * pack-owned fixture config/verticals/<id>/routing.fixture.json (written by
 * applyIntentPack.js) and scores phrase -> expected action against
 * parseNaturalLanguage.
 *
 *   node scripts/intentPacks/routingEval.js <verticalId> [--provider=auto] [--all]
 *
 * Default asserts the HEURISTIC layer (no API keys, CI-safe). --provider=auto
 * routes through the configured LLM and (with --all) also asserts the
 * directive-only rows. Exit 0 only at 100%.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

const args = process.argv.slice(2);
const verticalId = args.find((a) => !a.startsWith('-'));
const providerArg = (args.find((a) => a.startsWith('--provider=')) || '').split('=')[1];
const provider = providerArg || 'heuristic';
const includeDirective = args.includes('--all');
if (!verticalId) { console.error('usage: routingEval.js <verticalId> [--provider=auto] [--all]'); process.exit(2); }

const fixturePath = path.join(__dirname, '..', '..', 'config', 'verticals', verticalId, 'routing.fixture.json');
if (!fs.existsSync(fixturePath)) { console.error(`no fixture at ${fixturePath}`); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const FIXTURE = [...(fx.heuristic || [])];
if (includeDirective && provider !== 'heuristic') FIXTURE.push(...(fx.directiveOnly || []));

function actionOf(result) {
  if (!result) return 'none';
  if (result.kind === 'vertical') return result.action || 'none';
  if (result.kind === 'banking') return result.banking?.action || 'none';
  return result.kind || 'none';
}

async function main() {
  const ctx = { vertical: verticalId, role: 'customer' };
  const rows = await Promise.all(FIXTURE.map(async ({ phrase, expect }) => {
    const { result } = await parseNaturalLanguage(phrase, ctx, provider, {});
    const got = actionOf(result);
    return { ok: got === expect, phrase, expect, got };
  }));
  const pass = rows.filter((r) => r.ok).length;

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nRouting eval — vertical=${verticalId} provider=${provider}${includeDirective ? ' (+directive-only)' : ''}\n`);
  for (const r of rows) {
    if (!r.ok) console.log(`  FAIL ${pad(r.expect, 22)}got ${pad(r.got, 22)}"${r.phrase}"`);
  }
  const pct = FIXTURE.length ? ((pass / FIXTURE.length) * 100).toFixed(1) : '100.0';
  console.log(`\n  ${verticalId}: ${pass}/${FIXTURE.length} (${pct}%)\n`);
  process.exit(pass === FIXTURE.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
