#!/usr/bin/env node
'use strict';

/**
 * Per-vertical chip audit — the two defect classes no existing gate covers.
 *
 * `tests/useCases.primaryTool.test.js` already proves each chip routes to its own
 * stored primaryTool. It cannot see either of these:
 *
 *   A. PARAMS. The gate compares the resolved TOOL and never looks at the params,
 *      so a heuristic that reuses the dollar figure as a record id routes
 *      "correctly" and demos a record that does not exist. Found in healthcare
 *      (`recordId: "300"`, since fixed) and still live in sporting-goods
 *      (`rentalId: "2500"` against real ids 3001-3006).
 *
 *   B. A2A CONTRACT. chipEntries() skips anything matching A2A_UNROUTABLE,
 *      because "delegate this to a specialist" is resolved by the LangGraph
 *      dispatch overlay rather than parseHeuristic. Correct for routing — but it
 *      also means the stored primaryTool on those entries is never validated, so
 *      8 of 9 verticals silently kept banking's `get_portfolio_summary` instead
 *      of their own specialist tool.
 *
 * Offline: reads the catalog, the heuristic parser and the per-vertical seeds.
 * No running stack, no credentials.
 *
 *   node demo_api_server/scripts/audit-vertical-chips.js            # all verticals
 *   node demo_api_server/scripts/audit-vertical-chips.js workforce  # one vertical
 *
 * Exit code 1 when anything is flagged, so it can become a gate once the
 * findings it reports are fixed.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const a2aSpecialists = require('../config/a2aSpecialists.js');

const SPECIALISTS = a2aSpecialists.A2A_SPECIALISTS || a2aSpecialists.default || a2aSpecialists;
const A2A_CHIP = /\b(delegate|hand\s*(off|over))\b.*\bspecialist\b/i;

/** Ids that legitimately echo a request value rather than naming a stored record. */
const VALUE_SHAPED_PARAMS = new Set(['amount', 'city_name', 'product', 'fromId', 'toId']);

/**
 * Ids from a vertical's seed, kept per top-level collection. Grouping matters for
 * the hint: sporting-goods has both `orders` (2001-) and `rentals` (3001-), and
 * pointing a `rentalId` finding at the order ids sends the reader to the wrong
 * collection.
 */
function seedIdsByCollection(vertical) {
  const seedPath = path.join(REPO, 'demo_api_server', 'config', 'verticals', vertical, 'seed.json');
  if (!fs.existsSync(seedPath)) return null;
  const collect = (node, into) => {
    if (Array.isArray(node)) {
      node.forEach((n) => {
        collect(n, into);
      });
      return;
    }
    if (node && typeof node === 'object') {
      if (node.id != null) into.add(String(node.id));
      Object.values(node).forEach((n) => {
        collect(n, into);
      });
    }
  };
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const byCollection = new Map();
  for (const [name, value] of Object.entries(seed)) {
    const ids = new Set();
    collect(value, ids);
    if (ids.size) byCollection.set(name, ids);
  }
  return byCollection;
}

/** All ids in the seed, regardless of collection. */
function allIds(byCollection) {
  const out = new Set();
  for (const ids of byCollection.values()) for (const id of ids) out.add(id);
  return out;
}

/**
 * Best-guess collection for a param key: `rentalId` -> `rentals`, `recordId` ->
 * `records`. Falls back to null so the hint is simply omitted rather than wrong.
 */
function collectionForParam(key, byCollection) {
  const stem = key.replace(/Id$/i, '').toLowerCase();
  if (!stem) return null;
  for (const name of byCollection.keys()) {
    const n = name.toLowerCase();
    if (n === stem || n === `${stem}s` || n.startsWith(stem)) return name;
  }
  return null;
}

function chipsFor(vertical) {
  const seen = new Set();
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text || seen.has(t.text)) continue;
    seen.add(t.text);
    out.push({ id: u.id, text: t.text, primaryTool: uc.primaryTool || null });
  }
  return out;
}

function audit(verticals) {
  const findings = [];

  for (const vertical of verticals) {
    const ctx = resolveVerticalCtx(vertical);
    const byCollection = seedIdsByCollection(vertical);
    const ids = byCollection ? allIds(byCollection) : null;

    for (const chip of chipsFor(vertical)) {
      // B. A2A chips never reach parseHeuristic — validate the stored contract
      //    against the vertical's declared specialist instead.
      if (A2A_CHIP.test(chip.text)) {
        const expected = SPECIALISTS[vertical] && SPECIALISTS[vertical].tools
          ? SPECIALISTS[vertical].tools[0]
          : null;
        if (expected && chip.primaryTool && chip.primaryTool !== expected) {
          findings.push({
            kind: 'a2a-contract',
            vertical,
            uc: chip.id,
            text: chip.text,
            detail: `primaryTool "${chip.primaryTool}" but this vertical's specialist tool is "${expected}"`,
          });
        }
        continue;
      }

      // A. Params: an id-shaped param whose value is the request amount, or that
      //    names no record in the seed, demos something that does not exist.
      const parsed = parseHeuristic(chip.text, vertical, ctx, {});
      const params = (parsed && (parsed.banking?.params ?? parsed.params)) || {};
      for (const [key, value] of Object.entries(params)) {
        if (VALUE_SHAPED_PARAMS.has(key)) continue;
        const asString = String(value);
        if (params.amount != null && asString === String(params.amount)) {
          const collection = byCollection && collectionForParam(key, byCollection);
          const sample = collection
            ? ` — real ${collection} ids are ${[...byCollection.get(collection)].slice(0, 3).join(', ')}`
            : '';
          findings.push({
            kind: 'params-echo-amount',
            vertical,
            uc: chip.id,
            text: chip.text,
            detail: `${key}="${asString}" is just the dollar amount${sample}`,
          });
        } else if (ids && ids.size && /id$/i.test(key) && !ids.has(asString)) {
          findings.push({
            kind: 'params-unknown-id',
            vertical,
            uc: chip.id,
            text: chip.text,
            detail: `${key}="${asString}" matches no id in ${vertical}/seed.json`,
          });
        }
      }
    }
  }

  return findings;
}

const requested = process.argv.slice(2);
const targets = requested.length ? requested : VERTICALS;
for (const v of targets) {
  if (!VERTICALS.includes(v)) {
    console.error(`unknown vertical "${v}" — expected one of: ${VERTICALS.join(', ')}`);
    process.exit(2);
  }
}

const findings = audit(targets);

if (!findings.length) {
  console.log(`clean — ${targets.length} vertical(s) audited, no chip demos a value that does not exist`);
  process.exit(0);
}

const byKind = findings.reduce((acc, f) => {
  acc[f.kind] = acc[f.kind] || [];
  acc[f.kind].push(f);
  return acc;
}, {});

for (const [kind, rows] of Object.entries(byKind)) {
  console.log(`\n=== ${kind} (${rows.length}) ===`);
  for (const r of rows) {
    console.log(`  ${r.vertical.padEnd(16)}${r.uc.padEnd(7)}${JSON.stringify(r.text).padEnd(40)}${r.detail}`);
  }
}
console.log(`\n${findings.length} finding(s) across ${targets.length} vertical(s)`);
process.exit(1);
