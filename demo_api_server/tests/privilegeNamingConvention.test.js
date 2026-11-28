'use strict';

// Keeps privilege/NAMING-CONVENTION.md a real standard: the doc, the tag-map families in
// privilege/scripts/apply-tag-schema.mjs and the rename tables in privilege/scripts/cleanup-rename-apps.mjs
// must agree, and CLAUDE.md must keep pointing at the rulebook. Static only: no tenant access.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DOC = read('privilege/NAMING-CONVENTION.md');
const TAG_SCRIPT = read('privilege/scripts/apply-tag-schema.mjs');
const RENAME_SCRIPT = read('privilege/scripts/cleanup-rename-apps.mjs');

// The text from `marker` to its matching closing bracket.
function block(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  let depth = 0;
  for (let i = src.indexOf('[', start); i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(src.indexOf('[', start), i + 1);
  }
  throw new Error(`unterminated block: ${marker}`);
}

const FAMILIES = new Function(`return ${block(TAG_SCRIPT, 'const FAMILIES = [')}`)();
const familyNames = [...new Set(FAMILIES.map((f) => f.name))];
const hasFamily = (name) => FAMILIES.some((f) => new RegExp(f.regex).test(name));

// [old, new, ...] rows of the APPS / KEYS tables
const rows = (marker) => [...block(RENAME_SCRIPT, marker).matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'/g)].map((m) => ({ from: m[1], to: m[2] }));
const APPS = rows('const APPS = [');
const KEYS = rows('const KEYS = [');

// The system words are the backticked values in the `system` row of the §1 table.
const systemRow = DOC.split('\n').find((l) => /^\|\s*`system`\s*\|/.test(l));
const SYSTEMS = systemRow ? [...systemRow.matchAll(/`([a-z0-9]+)`/g)].map((m) => m[1]).filter((w) => w !== 'system') : [];
const VARIANT = '[a-z0-9]+(?:-[a-z0-9]+)*';

describe('privilege/NAMING-CONVENTION.md is a live standard', () => {
  it('names the system words the grammar accepts', () => {
    expect(SYSTEMS.length).toBeGreaterThanOrEqual(8);
    expect(SYSTEMS).toEqual(expect.arrayContaining(['banking', 'agg', 'obo', 'pftoken']));
  });

  it('has an app and key table to check', () => {
    expect(APPS.length).toBeGreaterThan(0);
    expect(KEYS.length).toBeGreaterThan(0);
  });

  it.each(APPS.map((r) => [r.to]))('app name %s is lab-|demo-<system>-<variant>', (name) => {
    expect(name).toMatch(new RegExp(`^(lab|demo)-(${SYSTEMS.join('|')})-${VARIANT}$`));
  });

  it.each(KEYS.map((r) => [r.to]))('key name %s is lab-<system>[-<role>]-key', (name) => {
    expect(name).toMatch(new RegExp(`^lab-(${SYSTEMS.join('|')})(?:-${VARIANT})?-key$`));
  });

  it.each([...APPS, ...KEYS].map((r) => [r.to]))('%s fits a tag-map family (the static form of "orphan 0")', (name) => {
    expect(hasFamily(name)).toBe(true);
  });

  it('documents every tag-map family the script defines, and only those', () => {
    const documented = new Set([...DOC.matchAll(/`(tag-map-[a-z0-9-]+)`/g)].map((m) => m[1]));
    expect(familyNames.filter((n) => !documented.has(n))).toEqual([]);
    expect([...documented].filter((n) => !familyNames.includes(n))).toEqual([]);
  });

  it('keeps a dated change log', () => {
    expect(DOC).toMatch(/## 9\. Change log/);
    expect(DOC).toMatch(/\|\s*20\d\d-\d\d-\d\d\s*\|/);
  });

  it('is binding and linked: the doc says so and CLAUDE.md points at it', () => {
    expect(DOC).toMatch(/## 0\. This is a standard \(binding/);
    expect(read('CLAUDE.md')).toContain('privilege/NAMING-CONVENTION.md');
    expect(read('privilege/DOCUMENTATION-INDEX.md')).toContain('NAMING-CONVENTION.md');
  });
});
