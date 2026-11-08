import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Shared-component accessibility fixes found by the Wave 2 skeptics (PR fix/ping-ui-shared-a11y).
 *
 * 1. Lesson nav focus ring: the old outline read --th-status-info-border, which is #bfdbfe in light
 *    (about 1.25:1 on the page ground) and #051727 in dark (about 1.1:1 on #0b1220). A focus indicator
 *    needs 3:1 against the surface in both themes (WCAG 2.2 SC 1.4.11 / 2.4.13).
 * 2. Diagram controls on a converted page: the shared DiagramControls buttons are filled (Simulate and
 *    Next flat Ping Red, Pause brown, Resume green), which put a second or third primary on a view that
 *    already has its own (Ping UI Standard P9: exactly one primary per view). Under .pu-page they are
 *    bordered secondaries; an unconverted page keeps the base look.
 * The rules are measured from the stylesheets (tokens resolved per theme), not grepped for a literal.
 */
const SRC = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const rules = (css) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(strip(css)))) out.push({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2] });
  return out;
};
const decls = (body) =>
  Object.fromEntries(
    body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
  );

const indexRules = rules(read('index.css'));
const tokensFor = (rootSel) =>
  indexRules
    .filter((r) => r.sel === rootSel)
    .reduce((acc, r) => ({ ...acc, ...decls(r.body) }), {});
const THEMES = { light: tokensFor(':root'), dark: { ...tokensFor(':root'), ...tokensFor(':root[data-theme="dark"]') } };

const hex = (v) => {
  const h = v.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const resolve = (theme, value) => {
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const t = THEMES[theme][m[1]];
  return resolve(theme, t ?? m[2] ?? '');
};

describe('lesson nav focus ring', () => {
  const css = rules(read('components/lesson/lesson.css'));
  const focus = css.find((r) => r.sel === '.lesson-nav-item:focus-visible');
  const outline = focus ? decls(focus.body).outline : '';

  it('is a solid outline of at least 2px', () => {
    expect(outline).toMatch(/^([2-9]|\d{2,})px solid /);
  });

  for (const theme of ['light', 'dark']) {
    for (const ground of ['--th-bg-page', '--th-bg-card', '--th-bg-inset']) {
      it(`clears 3:1 on ${ground} in ${theme}`, () => {
        const colour = resolve(theme, outline.replace(/^\S+ solid /, ''));
        expect(colour, outline).toMatch(/^#[0-9a-f]{3,6}$/i);
        const r = ratio(colour, resolve(theme, `var(${ground})`));
        expect(r, `${colour} on ${ground} (${theme}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('diagram controls on a converted page (.pu-page)', () => {
  const css = rules(read('styles/ping-ui.css'));
  const scoped = (state) =>
    css
      .filter((r) => r.sel.split(',').some((s) => s.trim().startsWith('.pu-page ') && s.includes('.dc-ctrl-btn') && (state ? s.includes(state) : !s.includes(':'))))
      .map((r) => decls(r.body));
  const merged = (list) => list.reduce((a, d) => ({ ...a, ...d }), {});

  it('makes every step button a bordered secondary, never a filled colour', () => {
    const base = merged(scoped());
    expect(base.border).toMatch(/^1px solid var\(--control-border\)/);
    expect(base['background-image']).toBe('none');
    expect(base.background ?? base['background-color']).toMatch(/var\(--th-bg-card\)/);
    expect(base.color).toBe('var(--th-text)');
  });

  it('keeps the disabled look on tokens (the base rule paints a light fill with !important)', () => {
    const body = css
      .filter((r) => r.sel.split(',').some((s) => s.includes('.pu-page') && s.includes('.dc-ctrl-btn') && s.includes(':disabled')))
      .map((r) => r.body)
      .join(';');
    expect(body).toMatch(/background:\s*var\(--th-bg-inset\)\s*!important/);
    expect(body).toMatch(/color:\s*var\(--th-text-muted\)\s*!important/);
  });

  it('shows a visible focus ring on the same tokens as .pu-btn', () => {
    const f = css.filter((r) => r.sel.includes('.pu-page') && r.sel.includes('.dc-ctrl-btn') && r.sel.includes(':focus-visible'));
    expect(f.length).toBeGreaterThan(0);
    expect(f.map((r) => r.body).join(';')).toMatch(/outline:\s*3px solid var\(--th-status-info-text\)/);
  });

  it('leaves the base DiagramControls look alone for unconverted pages', () => {
    const base = rules(read('components/diagram/DiagramControls.css'));
    const sim = base.find((r) => r.sel === '.dc-ctrl-btn--simulate');
    expect(sim && decls(sim.body).background).toBe('#d20e0f');
  });
});
