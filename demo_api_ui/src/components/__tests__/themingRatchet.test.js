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
// picked up its first --th-* token in the same commit; 182 after the THEMING.md
// §4 Priority 0 pass cleared the OS-keyed @media (prefers-color-scheme: dark)
// blocks, which took seven files onto --th-* or [data-theme="dark"] with them;
// 181 after PrivilegeMcpClientPage.css took its first --th-* tokens with the
// AI Gateway tool-discovery spinner.
const MAX_UNTHEMED = 181;

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

/**
 * The 10px floor (REGRESSION_PLAN §0 H2, THEMING.md §8.1).
 *
 * `--font-size-3xs` is 10px and is the bottom of the scale, so "never below
 * 10px" is enforceable as "no font-size literal resolves under 10px". 98 such
 * declarations were swept to the floor; this pin is 0 and must stay there.
 *
 * Unlike MAX_UNTHEMED this is not a ratchet that walks down — it is a hard
 * zero. A new sub-10px value is always a bug, never a not-yet-migrated file.
 */
const SUB_10_PX = /font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g;
const SUB_10_REM = /font-size:\s*(0\.[0-9]+)rem/g;

function belowFloor() {
  const hits = [];
  for (const f of cssFiles(SRC)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(SUB_10_PX)) {
      if (parseFloat(m[1]) < 10) hits.push(`${path.relative(SRC, f)} — ${m[0]}`);
    }
    // rem is root-relative and the root is 16px, so 0.625rem is the 10px line.
    for (const m of src.matchAll(SUB_10_REM)) {
      if (parseFloat(m[1]) < 0.625) hits.push(`${path.relative(SRC, f)} — ${m[0]}`);
    }
  }
  return hits;
}

describe('font-size floor', () => {
  it('no stylesheet sets a font-size below 10px', () => {
    const hits = belowFloor();
    expect(
      hits,
      `Font sizes below the 10px floor (REGRESSION_PLAN §0 H2). Use ` +
        `var(--font-size-3xs) or larger:\n  ${hits.slice(0, 8).join('\n  ')}`,
    ).toEqual([]);
  });
});

/**
 * Radius and elevation ratchets (THEMING.md §9.3).
 *
 * --radius-* and --shadow-* were introduced with these pins, deliberately, in
 * the same PR. The lesson from --z-*: #2585 created that family and adoption
 * stalled at 3%, because creating a token family is the easy half. A pin makes
 * the count a one-way door — it can only fall, and it falls as pages get
 * touched under the standing rule.
 *
 * These are NOT a target of zero. Plenty of radii are genuinely local (50% for
 * a circle, 1px hairlines) and plenty of shadows are deliberate one-offs. The
 * point is that the number never goes UP.
 */
const MAX_RADIUS_LITERALS = 2562;
const MAX_SHADOW_LITERALS = 482;

function countLiteral(re) {
  let n = 0;
  for (const f of cssFiles(SRC)) {
    n += (fs.readFileSync(f, 'utf8').match(re) || []).length;
  }
  return n;
}

describe('design-token ratchets', () => {
  it(`border-radius literals stay at or below ${MAX_RADIUS_LITERALS}`, () => {
    const n = countLiteral(/border-radius:\s*[0-9]/g);
    expect(
      n,
      `border-radius literals rose to ${n} (pin ${MAX_RADIUS_LITERALS}). Use ` +
        `var(--radius-sm|md|lg|xl|pill) — see THEMING.md §9.3. If you migrated ` +
        `some, lower the pin in the same commit.`,
    ).toBeLessThanOrEqual(MAX_RADIUS_LITERALS);
  });

  it(`box-shadow literals stay at or below ${MAX_SHADOW_LITERALS}`, () => {
    const n = countLiteral(/box-shadow:\s*[0-9-]/g);
    expect(
      n,
      `box-shadow literals rose to ${n} (pin ${MAX_SHADOW_LITERALS}). Use ` +
        `var(--shadow-sm|md|lg) — see THEMING.md §9.3.`,
    ).toBeLessThanOrEqual(MAX_SHADOW_LITERALS);
  });
});

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

/**
 * Ground-without-ink (THEMING.md §1.5, REGRESSION_PLAN §0 H1).
 *
 * A rule that sets a --th-* BACKGROUND and no `color` inherits <body>, which
 * computes to rgb(51,51,51) in BOTH themes — the app-level ink never flips. So
 * the ground goes dark, the text stays near-black, and the surface reads as
 * unstyled rather than mis-tinted.
 *
 * §1.5 has said "migrate a rule's surface and its ink together" since #2608, and
 * it kept happening anyway — four times in one day: #2626 fixed three components,
 * then the P1AZ console and the Agent Gateway Inspector shipped with it again.
 * The rule was written down and nothing enforced it. This is the enforcement.
 *
 * It hides well, which is why review misses it: every CLASSED child sets its own
 * colour and reads perfectly, so the panel looks right while you test. Only
 * unclassed text inside the container goes dark-on-dark.
 *
 * A ratchet, not a zero. Plenty of the current matches are harmless — a container
 * whose every child sets a colour, a scrollbar track with no text — and a
 * per-line rule would cry wolf, which modalDarkSchemeContrast.test.js already
 * learned the hard way. The point is only that the number never goes UP: a NEW
 * themed surface must bring its ink.
 *
 * Literal grounds are deliberately not counted. They do not flip, so inherited
 * near-black stays correct against them.
 */
const MAX_GROUND_WITHOUT_INK = 482;

const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;
const HAS_COLOR = /(?:^|\n)\s*color\s*:/;
const THEMED_BG = /(?:^|\n)\s*background(?:-color)?\s*:\s*([^;]*--th-[^;]*);/;

function groundWithoutInk() {
  const hits = [];
  for (const f of cssFiles(SRC)) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(CSS_RULE)) {
      const sel = m[1].trim();
      const body = m[2];
      if (!sel || sel.startsWith('@')) continue;
      if (!THEMED_BG.test(body)) continue;
      if (HAS_COLOR.test(body)) continue;
      hits.push(`${path.relative(SRC, f)} ${sel.split('\n')[0]}`);
    }
  }
  return hits;
}

describe('ground-without-ink ratchet', () => {
  it(`no more than ${MAX_GROUND_WITHOUT_INK} rules take a themed ground without ink`, () => {
    const hits = groundWithoutInk();
    const hint = hits.slice(0, 5).join('; ');
    expect(
      hits.length,
      `Rules with a --th-* background and no color rose to ${hits.length} ` +
        `(pin ${MAX_GROUND_WITHOUT_INK}). <body> ink is rgb(51,51,51) in BOTH ` +
        `themes, so such a rule renders near-black text once the ground flips. ` +
        `Give it a --th-* color on the next line — THEMING.md §1.5. e.g. ${hint}`,
    ).toBeLessThanOrEqual(MAX_GROUND_WITHOUT_INK);
  });

  it('the pin is not stale — lower MAX_GROUND_WITHOUT_INK when it drops', () => {
    const count = groundWithoutInk().length;
    expect(
      count,
      `Only ${count} ground-without-ink rules remain. Lower ` +
        `MAX_GROUND_WITHOUT_INK to ${count} in this commit so the floor cannot ` +
        `drift back up.`,
    ).toBeGreaterThanOrEqual(MAX_GROUND_WITHOUT_INK);
  });
});
