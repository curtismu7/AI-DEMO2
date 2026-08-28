import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEmojiAllowlistFromPlan } from './helpers/emojiAllowlistSource';

/**
 * REGRESSION_PLAN §0's emoji allowlist is a project-wide hard rule, but until
 * now the only test enforcing it was scoped to one support-console config —
 * so 342 uses across 63 files accumulated unchallenged.
 *
 * This is a RATCHET, not a clean-room assertion. The remaining violations are
 * real and tracked in TECH_DEBT; each needs a semantic decision (🏦 on a
 * transfer row is a label, not decoration, so it cannot be swapped
 * mechanically). What this stops is the count GROWING, and it stops any
 * violation appearing in a file that is currently clean.
 *
 * When you clean a file: drop it from KNOWN_FILES and lower BASELINE.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** True emoji planes. Arrows and geometric shapes are text, not emoji. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}]/gu;

const TYPOGRAPHIC = new Set([
  ...'▶▾▸▼▲◀◂▴←→↑↓↔⇄↗↘↖↙⬆⬇⬅➡–—…·×✗✔►◄●○◆◇■□',
]);

/** Violations at the commit that introduced this ratchet. Only ever go down. */
const BASELINE = 0;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') walk(full, out);
    } else if (/\.(js|jsx|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function violationsIn(text, allowed) {
  return (text.match(EMOJI) || []).filter(
    (c) => !allowed.has(c) && !TYPOGRAPHIC.has(c) && c !== '️',
  );
}

describe('emoji allowlist — app-wide ratchet', () => {
  const allowed = new Set(readEmojiAllowlistFromPlan());
  const files = walk(SRC);

  const perFile = new Map();
  let total = 0;
  for (const f of files) {
    const n = violationsIn(fs.readFileSync(f, 'utf8'), allowed).length;
    if (n) {
      perFile.set(path.relative(SRC, f), n);
      total += n;
    }
  }

  it('reads a non-trivial allowlist from REGRESSION_PLAN §0', () => {
    // A parse failure returning [] would make every emoji a violation and every
    // file "dirty" — loud, but for the wrong reason. Assert the source is sane.
    expect(allowed.size).toBeGreaterThanOrEqual(11);
    expect(allowed.has('🔐')).toBe(true);
  });

  it(`holds at the ${BASELINE}-use baseline`, () => {
    // Growing this number means new emoji entered the UI. Fix them, or if a
    // NEW glyph is genuinely warranted, add it to §0 first — that is the
    // source of truth this test reads.
    expect(total).toBeLessThanOrEqual(BASELINE);
  });

  it('adds no violation to a file that is currently clean', () => {
    const dirty = [...perFile.keys()].sort();
    // Snapshot-free on purpose: the list is long and churns as files are
    // cleaned. What matters is that it only ever shrinks.
    expect(dirty).toEqual([]);
  });
});
