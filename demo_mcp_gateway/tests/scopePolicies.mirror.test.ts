'use strict';

/**
 * Pins scopePolicies.ts to tx-weather-scope.groovy.
 *
 * These two files are one policy written twice, in two languages, by hand.
 * Nothing linked them, so when `any-except-blocked` and the blocked-city list
 * were added to the Groovy, the TypeScript mirror kept the old vocabulary —
 * and because an unrecognized allowedState falls back to the NARROWEST state
 * ('texas'), the gateway quietly enforced Texas while the UI said "Any except
 * blocked cities". Nothing failed. No test went red. A blocked Texas city was
 * simply never denied. (Fixed in #2684; this guard is so it cannot recur.)
 *
 * The mirror is data + vocabulary, not logic — this asserts the parts that can
 * drift silently:
 *
 *   - the allowedState values each file recognizes
 *   - which states exist, and each one's bounding box, abbreviations, city list
 *
 * It deliberately does NOT try to compare behaviour; two implementations can
 * still diverge in how they decide. What it guarantees is that a mode or a city
 * added on one side cannot go unnoticed on the other. If this test fails, the
 * fix is to port the change — not to loosen the assertion.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const GROOVY = fs.readFileSync(
  path.join(REPO, 'ping-gateway/scripts/groovy/tx-weather-scope.groovy'),
  'utf8',
);
const TS = fs.readFileSync(path.join(REPO, 'demo_mcp_gateway/src/scopePolicies.ts'), 'utf8');

const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * A mode has to survive TWO places, and both files distinguish them by
 * receiver:
 *
 *   accepted — the flag parser's allowlist, on the freshly-read value
 *              (`parsed.allowedState` / the local `allowedState`)
 *   handled  — the policy body's branches, on the parsed flags object
 *              (`flags.allowedState`)
 *
 * The shipped bug lived entirely in `accepted`: the TS branch for
 * `any-except-blocked` was never written, so collecting literals from the whole
 * file found the mode anyway and a naive comparison stayed green. Splitting by
 * receiver is what makes this guard able to fail.
 */
function accepted(src: string): string[] {
  // Skips `flags.allowedState` (that is `handled`) and `typeof allowedState`
  // (a type guard on the TS side, not a mode).
  return uniq(
    [...src.matchAll(/(?<!flags\.)(?<!typeof )allowedState\s*===?\s*'([^']+)'/g)].map((m) => m[1]),
  );
}

function handled(src: string): string[] {
  return uniq([...src.matchAll(/flags\.allowedState\s*===?\s*'([^']+)'/g)].map((m) => m[1]));
}

/** The body of the STATES map, from its opening bracket to the matching close. */
function statesBlock(src: string, open: string, close: string): string {
  const start = src.indexOf(open);
  if (start < 0) throw new Error(`STATES block not found (looked for ${JSON.stringify(open)})`);
  const from = start + open.length;
  const end = src.indexOf(close, from);
  if (end < 0) throw new Error('STATES block never closed');
  return src.slice(from, end);
}

/** Per-state slice, keyed by the `<name>:` labels found in the block itself. */
function stateSlices(block: string): Record<string, string> {
  const names = [...block.matchAll(/^\s{2,4}(\w+):\s*[[{]/gm)];
  const out: Record<string, string> = {};
  names.forEach((m, i) => {
    const from = m.index as number;
    const to = i + 1 < names.length ? (names[i + 1].index as number) : block.length;
    out[m[1]] = block.slice(from, to);
  });
  return out;
}

function bbox(slice: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ['latMin', 'latMax', 'lonMin', 'lonMax']) {
    const m = slice.match(new RegExp(`${key}:\\s*(-?[\\d.]+)`));
    if (!m) throw new Error(`${key} missing`);
    out[key] = Number(m[1]);
  }
  return out;
}

/** Quoted entries of a named list — `abbrevs: [...]` / `abbrevs: new Set([...])`. */
function list(slice: string, key: string): string[] {
  const at = slice.indexOf(`${key}:`);
  if (at < 0) throw new Error(`${key} missing`);
  const open = slice.indexOf('[', at);
  const close = slice.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error(`${key} list not bracketed`);
  return [...slice.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

const groovyStates = stateSlices(statesBlock(GROOVY, 'def STATES = [', '\n]'));
const tsStates = stateSlices(statesBlock(TS, 'const STATES: Record<string, StateDef> = {', '\n};'));

describe('scopePolicies.ts mirrors tx-weather-scope.groovy', () => {
  test('the parsers found something to compare (guards a silently-empty pass)', () => {
    expect(Object.keys(groovyStates).length).toBeGreaterThan(0);
    expect(accepted(GROOVY).length).toBeGreaterThan(0);
    expect(handled(GROOVY).length).toBeGreaterThan(0);
  });

  test('both accept the same allowedState vocabulary', () => {
    // The drift that shipped: the TS parser accepted only 'any', so the real
    // value fell through to the fail-narrow 'texas' default.
    expect(accepted(TS)).toEqual(accepted(GROOVY));
  });

  test('both branch on the same allowedState vocabulary', () => {
    expect(handled(TS)).toEqual(handled(GROOVY));
  });

  // The invariant that catches this class of bug from ONE side, without needing
  // the other file to be right: a mode the parser accepts but the body never
  // branches on falls through to the state allowlist, and a mode the body
  // branches on but the parser rejects is dead code. Either way the gateway
  // enforces something other than what the UI is showing, silently.
  test.each([
    ['tx-weather-scope.groovy', GROOVY],
    ['scopePolicies.ts', TS],
  ])('%s accepts exactly the modes it branches on', (_name, src) => {
    expect(accepted(src)).toEqual(handled(src));
  });

  test('both define the same states', () => {
    expect(Object.keys(tsStates).sort()).toEqual(Object.keys(groovyStates).sort());
  });

  test.each(Object.keys(groovyStates))('%s has an identical bounding box', (name) => {
    expect(bbox(tsStates[name])).toEqual(bbox(groovyStates[name]));
  });

  test.each(Object.keys(groovyStates))('%s has identical abbreviations', (name) => {
    expect(list(tsStates[name], 'abbrevs')).toEqual(list(groovyStates[name], 'abbrevs'));
  });

  test.each(Object.keys(groovyStates))('%s has an identical city allowlist', (name) => {
    expect(list(tsStates[name], 'cities')).toEqual(list(groovyStates[name], 'cities'));
  });
});
