import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Design-token ratchet: new CSS must use the radius and font-size tokens, not literals.
 *   border-radius: var(--radius-sm|md|lg|xl|pill)      font-size: var(--font-size-*)
 * Exact-match literals (4/6/8/12/999px radius, 10-36px sizes) were swapped for tokens when this
 * was added. What is left is a long tail with no matching token (3px, 5px, 10px, 0.82rem …).
 * Lower the pins when you convert some; never raise them. Vendor mocks and the clinical vertical
 * are excluded, as in the contrast check.
 */
const SRC = path.resolve(__dirname, '..');
const SKIP = ['aiFootprintMocks', 'agent-clinical', 'ChatgptLoginPage', 'FootprintMockGallery', 'ConsentMockPhoneFlow', 'PrivilegeMcpClientPage'];
const MAX_LITERAL_RADIUS = 628;
const MAX_LITERAL_FONT_SIZE = 2250;

function cssFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith('.css') && !SKIP.some((s) => p.includes(s))) out.push(p);
  }
  return out;
}

// The classes of literal the two pins above do not see. Each is its own pin, measured on this commit,
// lowered when you convert some, never raised. They sit apart from the two above on purpose: a PR that
// lowers MAX_LITERAL_RADIUS or MAX_LITERAL_FONT_SIZE does not touch these lines.
//   radius   : border-radius with 2+ values (4px 4px 0 0) and the per-corner / logical-corner longhands
//   font-size: a font-size that is a clamp()/min()/max()/calc() or uses pt/%/vw rather than one px/rem/em length
//   font     : the `font:` shorthand with a literal size (font: 600 12px/1.4 sans-serif)
const MAX_LITERAL_RADIUS_COMPOUND = 123;
const MAX_LITERAL_FONT_SIZE_COMPOUND = 29;
const MAX_LITERAL_FONT_SHORTHAND = 22;

const LENGTH = /(?<![\w.-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/;
const SINGLE_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)$/;

function countCompound() {
  let radius = 0;
  let fontSize = 0;
  let shorthand = 0;
  for (const f of cssFiles(SRC)) {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/(?<![-\w])border-radius:\s*([^;}]+)/g)) {
      const v = m[1].replace(/!important/, '').trim();
      if (/\s/.test(v.replace(/\([^)]*\)/g, 'x')) && LENGTH.test(v)) radius += 1;
    }
    radius += (css.match(/(?<![-\w])border-(?:top|bottom)-(?:left|right)-radius:\s*[^;}]*(?:\d|\.\d)(?:px|rem|em)\b/g) || []).length;
    radius += (css.match(/(?<![-\w])border-(?:start|end)-(?:start|end)-radius:\s*[^;}]*(?:\d|\.\d)(?:px|rem|em)\b/g) || []).length;
    for (const m of css.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)) {
      const v = m[1].replace(/!important/, '').trim();
      if (SINGLE_LENGTH.test(v) || /^var\(/.test(v)) continue;
      if (/\d(?:px|rem|em|pt|vw|vh|vmin|vmax|%)/.test(v)) fontSize += 1;
    }
    for (const m of css.matchAll(/(?<![-\w])font:\s*([^;}]+)/g)) {
      if (/(?:^|\s)(?:\d+\.?\d*|\.\d+)(?:px|rem|em|pt)(?=[\s/,]|$)/.test(m[1])) shorthand += 1;
    }
  }
  return { radius, fontSize, shorthand };
}

function count() {
  let radius = 0;
  let fontSize = 0;
  for (const f of cssFiles(SRC)) {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    radius += (css.match(/(?<![-\w])border-radius:\s*[0-9.]+(?:px|rem|em)\s*(?:!important\s*)?[;}]/g) || []).length;
    fontSize += (css.match(/(?<![-\w])font-size:\s*[0-9.]+(?:px|rem|em)\s*(?:!important\s*)?[;}]/g) || []).length;
  }
  return { radius, fontSize };
}

describe('design token ratchet', () => {
  const { radius, fontSize } = count();

  it('adds no new literal border-radius values', () => {
    expect(radius, `literal border-radius rose to ${radius} (pin ${MAX_LITERAL_RADIUS}); use var(--radius-sm|md|lg|xl|pill)`).toBeLessThanOrEqual(MAX_LITERAL_RADIUS);
  });

  it('adds no new literal font-size values', () => {
    expect(fontSize, `literal font-size rose to ${fontSize} (pin ${MAX_LITERAL_FONT_SIZE}); use var(--font-size-*)`).toBeLessThanOrEqual(MAX_LITERAL_FONT_SIZE);
  });

  it('keeps the pins honest: lower them when the count drops', () => {
    expect(radius, `only ${radius} literal radii remain; lower MAX_LITERAL_RADIUS to ${radius}`).toBeGreaterThanOrEqual(MAX_LITERAL_RADIUS);
    expect(fontSize, `only ${fontSize} literal font sizes remain; lower MAX_LITERAL_FONT_SIZE to ${fontSize}`).toBeGreaterThanOrEqual(MAX_LITERAL_FONT_SIZE);
  });
});

describe('design token ratchet: the literal classes the two pins above miss', () => {
  const { radius, fontSize, shorthand } = countCompound();

  it('adds no new multi-value or per-corner literal border-radius', () => {
    expect(radius, `compound literal radii rose to ${radius} (pin ${MAX_LITERAL_RADIUS_COMPOUND}); use var(--radius-*) per corner`).toBeLessThanOrEqual(MAX_LITERAL_RADIUS_COMPOUND);
  });

  it('adds no new clamp()/calc()/min()/max()/pt/%/vw literal font-size', () => {
    expect(fontSize, `compound literal font sizes rose to ${fontSize} (pin ${MAX_LITERAL_FONT_SIZE_COMPOUND}); build it from var(--font-size-*)`).toBeLessThanOrEqual(MAX_LITERAL_FONT_SIZE_COMPOUND);
  });

  it('adds no new font: shorthand with a literal size', () => {
    expect(shorthand, `literal font: shorthand sizes rose to ${shorthand} (pin ${MAX_LITERAL_FONT_SHORTHAND}); use font-size: var(--font-size-*)`).toBeLessThanOrEqual(MAX_LITERAL_FONT_SHORTHAND);
  });

  it('keeps these pins honest: lower them when the count drops', () => {
    expect(radius, `only ${radius} compound literal radii remain; lower MAX_LITERAL_RADIUS_COMPOUND to ${radius}`).toBeGreaterThanOrEqual(MAX_LITERAL_RADIUS_COMPOUND);
    expect(fontSize, `only ${fontSize} compound literal font sizes remain; lower MAX_LITERAL_FONT_SIZE_COMPOUND to ${fontSize}`).toBeGreaterThanOrEqual(MAX_LITERAL_FONT_SIZE_COMPOUND);
    expect(shorthand, `only ${shorthand} literal font: shorthands remain; lower MAX_LITERAL_FONT_SHORTHAND to ${shorthand}`).toBeGreaterThanOrEqual(MAX_LITERAL_FONT_SHORTHAND);
  });
});
