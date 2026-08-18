#!/usr/bin/env node
// Regenerate seed/<vertical>.seed.json from the BFF's seed store, so the two
// halves of a migrated vertical cannot describe different worlds at the file
// level (TECH_DEBT 2026-08-17 "Every migrated vertical now has two seed
// stores"). The BFF seed is the source; each resource-server seed is a pure
// extraction of the migrated entity. Which file derives from which lives in
// seed/parity-cases.json — shared with tests/seedParity.test.ts, which fails
// on any drift and points here.
//
// Note: a vertical's SQLite schema may project a SUBSET of the record's fields
// (abercrombie serves 5 of them); the seed stays the full record so the served
// shape is decided in one place — the db module — not by seed truncation.
//
// Usage: node scripts/gen-seeds-from-bff.mjs   (also: npm run seeds:gen)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(pkgRoot, 'seed');
const bffVerticals = path.join(pkgRoot, '..', 'demo_api_server', 'config', 'verticals');

const { cases } = JSON.parse(fs.readFileSync(path.join(seedDir, 'parity-cases.json'), 'utf8'));

let changed = 0;
for (const { label, resourceSeed, bffDir, entity } of cases) {
  const bffFile = path.join(bffVerticals, bffDir, 'seed.json');
  const records = JSON.parse(fs.readFileSync(bffFile, 'utf8'))[entity];
  if (!Array.isArray(records)) {
    console.error(`[gen-seeds] ${label}: expected array at "${entity}" in ${bffFile}`);
    process.exit(1);
  }
  const outFile = path.join(seedDir, resourceSeed);
  const next = `${JSON.stringify({ [entity]: records }, null, 2)}\n`;
  const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
  if (prev !== next) {
    fs.writeFileSync(outFile, next);
    console.log(`[gen-seeds] wrote ${resourceSeed} (${records.length} ${entity})`);
    changed += 1;
  }
}
console.log(changed === 0 ? '[gen-seeds] all seeds already match the BFF source' : `[gen-seeds] ${changed} file(s) regenerated`);
