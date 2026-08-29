/**
 * A ratchet, not a linter — see THEMING.md §6.
 *
 * 190 of 274 stylesheets reference neither a --th-* token nor a
 * [data-theme="dark"] block, so they are light-only. That number is meant to
 * fall opportunistically as pages get touched; nothing stops it RISING, and a
 * new light-only stylesheet is invisible in review.
 *
 * This pins the count. New files must be born theme-aware; old ones only
 * improve. When you migrate a file the count drops and this test tells you to
 * lower the pin in the same commit, so the floor never drifts back up.
 *
 * Deliberately a count and not a per-line rule. modalDarkSchemeContrast.test.js
 * records why in its own header: a broad "no light colour in CSS" check produced
 * five false positives, "and a guard that cries wolf gets switched off." A count
 * cannot be wrong about an individual line.
 */
import fs from 'node:fs';
import path from 'node:path';

// Lower this when you migrate a stylesheet. Never raise it.
// 190 at the time this guard was written; 189 after ExchangeModeToggle.css
// picked up its first --th-* token in the same commit.
const MAX_UNTHEMED = 189;

const SRC = path.join(__dirname, '..', '..');

function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(abs));
    else if (entry.name.endsWith('.css')) out.push(abs);
  }
  return out;
}

function unthemed() {
  return cssFiles(SRC).filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return !src.includes('var(--th-') && !src.includes('data-theme="dark"');
  });
}

describe('theming ratchet', () => {
  it(`no more than ${MAX_UNTHEMED} stylesheets are light-only`, () => {
    const files = unthemed();
    // Name a few so a failure is actionable rather than just a number.
    const hint = files
      .slice(0, 5)
      .map((f) => path.relative(SRC, f))
      .join(', ');
    expect(
      files.length,
      `Light-only stylesheets rose to ${files.length} (pin is ${MAX_UNTHEMED}). ` +
        `A new stylesheet needs --th-* tokens — see THEMING.md §1.2. e.g. ${hint}`,
    ).toBeLessThanOrEqual(MAX_UNTHEMED);
  });

  it('the pin is not stale — lower MAX_UNTHEMED when it drops', () => {
    const count = unthemed().length;
    expect(
      count,
      `Only ${count} light-only stylesheets remain. Lower MAX_UNTHEMED to ${count} ` +
        `in this commit so the floor cannot drift back up.`,
    ).toBeGreaterThanOrEqual(MAX_UNTHEMED);
  });
});
