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
const MAX_LITERAL_RADIUS = 651;
const MAX_LITERAL_FONT_SIZE = 2316;

function cssFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith('.css') && !SKIP.some((s) => p.includes(s))) out.push(p);
  }
  return out;
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
