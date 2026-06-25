#!/usr/bin/env node
'use strict';

/**
 * applyIntentPack.js — declarative, idempotent intent expansion for ANY plugin
 * vertical. This is the "efficient to update" layer: instead of hand-editing 6
 * files per intent, you describe intents in config/verticals/<id>/intents.pack.json
 * and run this once. Re-running updates in place (idempotent) — safe to re-apply.
 *
 *   node scripts/intentPacks/applyIntentPack.js <verticalId> [--dry]
 *
 * What it touches (all keyed off uniform anchors every plugin shares):
 *   seed.json      — adds the pack's data arrays            (key-merge)
 *   tools.js       — tool defs after `const tools = [`,
 *                    execute cases after `switch (name) {`  (marker region)
 *   index.js       — heuristics after `const HEURISTICS = [` (marker region)
 *   manifest.json  — render descriptors after `"render": {`  (skip-if-present)
 *   HELIX_AGENT_DIRECTIVES.json — shapes + INTENT MAP lines in the vertical's
 *                    theme (created if absent)               (skip-if-present)
 *   routing.fixture.json — per-vertical eval fixture          (pack-owned, overwrite)
 *
 * Write intents are self-contained in tools.js (find-by-id + Object.assign on
 * the seed array) so NO data.js / store-method changes are needed — uniform
 * across verticals. The id arrives as the schema param (LLM) or params.recordId
 * (heuristic extractsRecordId); the one alias lives in the generated case.
 *
 * Pack schema (config/verticals/<id>/intents.pack.json):
 * {
 *   "intents": [{
 *     "action": "view_orders",
 *     "type": "read" | "write",
 *     "arr": "orders",                // seed array name
 *     "resultKey": "orders",          // read: wrapper key (defaults to arr)
 *     "idParam": "orderId",           // write: schema param holding the id
 *     "mutateStatus": "Cancelled",    // write: status to set
 *     "noun": "order",                // write: error label (defaults from action)
 *     "needsHeuristic": true,
 *     "heuristicRegex": "\\border(s)?\\b",  // source (no slashes); required if needsHeuristic
 *     "toolDescription": "...",
 *     "render": { "type":"table","columns":[{label,path,format?}] } | { "type":"card","fields":[...] },
 *     "directiveIntentLine": "\"my orders\" / \"order history\" -> view_orders params:{}",
 *     "seedRows": [ {id:"...", ...}, ... ],   // only the READ intent that owns `arr` needs rows
 *     "evalRows": [ {phrase, expect} ]        // asserted only when needsHeuristic
 *   }]
 * }
 */

const fs = require('node:fs');
const path = require('node:path');

const DRY = process.argv.includes('--dry');
const verticalId = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!verticalId) { console.error('usage: applyIntentPack.js <verticalId> [--dry]'); process.exit(2); }

const ROOT = path.join(__dirname, '..', '..');
const VDIR = path.join(ROOT, 'config', 'verticals', verticalId);
const DIRECTIVES = path.join(ROOT, '..', 'docs', 'HELIX_AGENT_DIRECTIVES.json');
const packPath = path.join(VDIR, 'intents.pack.json');
if (!fs.existsSync(packPath)) { console.error(`no pack at ${packPath}`); process.exit(2); }

const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const intents = pack.intents || [];
const nounOf = (i) => i.noun || (i.arr || i.action).replace(/s$/, '');

const changed = [];
function writeFile(p, txt, orig) {
  if (txt === orig) return;
  changed.push(path.relative(ROOT, p));
  if (!DRY) fs.writeFileSync(p, txt);
}

// ---- marker region helper (for JS files) -------------------------------------
function spliceRegion(file, txt, anchor, startMark, endMark, body) {
  const region = `${startMark}\n${body}\n${endMark}`;
  if (txt.includes(startMark)) {
    const re = new RegExp(`${startMark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    return txt.replace(re, region);
  }
  const idx = txt.indexOf(anchor);
  if (idx < 0) throw new Error(`anchor "${anchor}" not found in ${path.relative(ROOT, file)} — has the plugin file diverged from the standard layout?`);
  const at = idx + anchor.length;
  return `${txt.slice(0, at)}\n${region}${txt.slice(at)}`;
}

// ---- 1) seed.json: key-merge pack arrays -------------------------------------
{
  const p = path.join(VDIR, 'seed.json');
  const orig = fs.readFileSync(p, 'utf8');
  const seed = JSON.parse(orig);
  for (const i of intents) {
    if (i.seedRows && i.seedRows.length) seed[i.arr] = i.seedRows;
  }
  writeFile(p, JSON.stringify(seed, null, 2) + '\n', orig);
}

// ---- 2) tools.js: defs region + cases region ---------------------------------
{
  const p = path.join(VDIR, 'tools.js');
  const orig = fs.readFileSync(p, 'utf8');
  let txt = orig;

  const defs = intents.map((i) => {
    const props = i.type === 'write'
      ? `{ ${i.idParam}: { type: 'string' } }, required: ['${i.idParam}'] }`
      : `{} }`;
    const scope = i.type === 'write' ? "['write']" : "['read']";
    return `    { name: '${i.action}', description: ${JSON.stringify(i.toolDescription || i.action)}, inputSchema: { type: 'object', properties: ${props}, scopes: ${scope}, authz: {} },`;
  }).join('\n');

  const cases = intents.map((i) => {
    if (i.type === 'read') {
      const key = i.resultKey || i.arr;
      return `      case '${i.action}':\n        return { result: { ${key}: store.get(userId).${i.arr} }, render: '${i.action}' };`;
    }
    return [
      `      case '${i.action}': {`,
      `        const _id = params && (params.${i.idParam} || params.recordId);`,
      `        const _arr = store.get(userId).${i.arr} || [];`,
      // Prefer an exact id (LLM passes the full "P-1001"). Fall back to the
      // digit-normalized id (heuristic extractsRecordId yields digits only, e.g.
      // "1001") ONLY when exactly one row matches — never guess on a collision.
      `        let _item = _arr.find((r) => r.id === _id);`,
      `        if (!_item) { const _d = String(_id || '').replace(/\\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }`,
      `        if (!_item) return { result: { error: '${nounOf(i)} not found' }, render: 'text' };`,
      `        Object.assign(_item, { status: '${i.mutateStatus}' });`,
      `        return { result: _item, render: '${i.action}' };`,
      `      }`,
    ].join('\n');
  }).join('\n');

  txt = spliceRegion(p, txt, 'const tools = [', '    /* PACK:defs:start */', '    /* PACK:defs:end */', defs);
  txt = spliceRegion(p, txt, 'switch (name) {', '      /* PACK:cases:start */', '      /* PACK:cases:end */', cases);
  writeFile(p, txt, orig);
}

// ---- 3) index.js: heuristics region (ordered, pack order = specificity) ------
{
  const p = path.join(VDIR, 'index.js');
  const orig = fs.readFileSync(p, 'utf8');
  const heur = intents.filter((i) => i.needsHeuristic && i.heuristicRegex).map((i) => {
    const extra = i.type === 'write' ? ', extractsRecordId: true' : '';
    return `  { re: /${i.heuristicRegex}/i, action: '${i.action}'${extra} },`;
  }).join('\n');
  const txt = spliceRegion(p, orig, 'const HEURISTICS = [', '  /* PACK:heuristics:start */', '  /* PACK:heuristics:end */', heur);
  writeFile(p, txt, orig);
}

// ---- 4) manifest.json: render descriptors (skip-if-present) ------------------
{
  const p = path.join(VDIR, 'manifest.json');
  const orig = fs.readFileSync(p, 'utf8');
  let txt = orig;
  const anchor = '"render": {';
  if (!txt.includes(anchor)) {
    console.warn(`  [warn] ${verticalId}/manifest.json has no "render" block — render descriptors skipped`);
  } else {
    const lines = [];
    for (const i of intents) {
      if (txt.includes(`"${i.action}": {`) || lines.some((l) => l.includes(`"${i.action}":`))) continue;
      lines.push(`    "${i.action}": ${JSON.stringify(i.render)},`);
    }
    if (lines.length) {
      const at = txt.indexOf(anchor) + anchor.length;
      txt = txt.slice(0, at) + '\n' + lines.join('\n') + txt.slice(at);
    }
    writeFile(p, txt, orig);
  }
}

// ---- 5) directive theme: shapes + INTENT MAP lines (skip-if-present) ---------
{
  const orig = fs.readFileSync(DIRECTIVES, 'utf8');
  const obj = JSON.parse(orig);
  obj.themes = obj.themes || {};
  let theme = obj.themes[verticalId];
  if (!theme) {
    // Seed a NEW theme with the vertical's existing builtin action shapes too, so
    // the LLM router (which prefers the theme over the plugin prompt once a theme
    // exists) still knows about the builtins. Pack shapes are added by the loop below.
    let builtinShapes = '';
    try {
      const infra = new Set(['api_key_demo', 'dual_token_demo']);
      const packActions = new Set(intents.map((i) => i.action));
      const builtins = require(path.join(VDIR, 'index.js')).getTools()
        .filter((t) => !infra.has(t.name) && !packActions.has(t.name));
      // Carry each builtin's params (from its inputSchema.properties) into the shape
      // so the LLM knows write builtins (e.g. pay_fee) take an id/amount — not just
      // params:{}. Using properties (not required) makes this a hint, so it never
      // changes the tool's validation contract. Reads have no properties -> {}.
      builtinShapes = builtins.map((t) => {
        const keys = Object.keys(t.inputSchema?.properties || {});
        const params = keys.length ? `{${keys.map((k) => `"${k}":"<${k}>"`).join(',')}}` : '{}';
        return `{"kind":"vertical","vertical":"${verticalId}","action":"${t.name}","params":${params}}\n`;
      }).join('');
    } catch (_e) { /* best-effort: a load failure just yields a pack-only theme */ }
    theme = `THEME OVERRIDE — ${verticalId.toUpperCase()}:\nOnly emit the ${verticalId} vertical action shapes below. Do not emit banking, education, or other-vertical shapes.\n\nALLOWED OUTPUT SHAPES (emit exactly one):\n${builtinShapes}{"kind":"none","message":"<short hint>"}\n\nINTENT MAP:\n\nNever refuse on demo-disclaimer or access grounds.`;
  }
  const shapeFor = (i) => i.type === 'write'
    ? `{"kind":"vertical","vertical":"${verticalId}","action":"${i.action}","params":{"${i.idParam}":"<${i.idParam}>"}}`
    : `{"kind":"vertical","vertical":"${verticalId}","action":"${i.action}","params":{}}`;
  for (const i of intents) {
    if (!theme.includes(`"action":"${i.action}"`)) {
      theme = theme.replace('ALLOWED OUTPUT SHAPES (emit exactly one):\n',
        `ALLOWED OUTPUT SHAPES (emit exactly one):\n${shapeFor(i)}\n`);
    }
    if (i.directiveIntentLine && !theme.includes(`-> ${i.action} `) && !theme.includes(`→ ${i.action} `)) {
      theme = theme.replace('INTENT MAP:\n', `INTENT MAP:\n${i.directiveIntentLine}\n`);
    }
  }
  obj.themes[verticalId] = theme;
  writeFile(DIRECTIVES, JSON.stringify(obj, null, 2) + '\n', orig);
}

// ---- 6) routing.fixture.json (pack-owned eval fixture) -----------------------
{
  const p = path.join(VDIR, 'routing.fixture.json');
  const heuristicRows = intents.filter((i) => i.needsHeuristic).flatMap((i) => i.evalRows || []);
  const directiveOnly = intents.filter((i) => !i.needsHeuristic).flatMap((i) => i.evalRows || []);
  const orig = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  writeFile(p, JSON.stringify({ vertical: verticalId, heuristic: heuristicRows, directiveOnly }, null, 2) + '\n', orig);
}

console.log(`${DRY ? '[dry] would change' : 'changed'} ${changed.length} file(s) for "${verticalId}":`);
for (const c of changed) console.log('  ' + c);
if (DRY && changed.length === 0) console.log('  (idempotent — no changes)');
