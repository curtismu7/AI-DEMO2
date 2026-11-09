import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Keyboard focus rings (WCAG 2.4.7 / 1.4.11): every ring below must clear 3:1 against the real grounds it can sit on,
 * in both themes. Ground and ring colours are READ from index.css (per theme), never typed in here, so a token change
 * that breaks a ring turns this red. Before this change the dark-theme rings used --th-status-info (#12538d), about
 * 2.3:1 on the dark surfaces, and the ring on the dark page-header band was navy in light theme (1.3:1).
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
const tokensFor = (rootSel) => indexRules.filter((r) => r.sel === rootSel).reduce((acc, r) => ({ ...acc, ...decls(r.body) }), {});
const THEMES = { light: tokensFor(':root'), dark: { ...tokensFor(':root'), ...tokensFor(':root[data-theme="dark"]') } };

const hex = (v) => {
  const h = v.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const resolve = (theme, value) => {
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(String(value).trim());
  if (!m) return String(value).trim();
  return resolve(theme, THEMES[theme][m[1]] ?? m[2] ?? '');
};

/** Split a selector list at its top-level commas (not the ones inside :is( ... )). */
const splitTop = (sel) => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

/** The outline colour a rule paints: the last token in `outline: 3px solid <colour>` or `outline-color`. */
const ringOf = (css, selector) => {
  const hit = rules(css).filter((r) => splitTop(r.sel).some((s) => s === selector));
  const d = hit.reduce((acc, r) => ({ ...acc, ...decls(r.body) }), {});
  const colour = d['outline-color'] ?? (d.outline ? d.outline.replace(/^\S+\s+solid\s+/, '') : undefined);
  return { colour, width: d.outline ? parseFloat(d.outline) : undefined };
};

const PAGE_GROUNDS = ['--th-bg-page', '--th-bg-card', '--th-bg-inset', '--th-bg-hover'];
// The title band is a gradient from --th-bg-band to this stop (components/common/PageHeader.css).
const bandEnd = /linear-gradient\([^)]*var\(--th-bg-band[^)]*\)[^,]*,\s*(#[0-9a-fA-F]{6})\)/.exec(read('components/common/PageHeader.css'))?.[1];

describe('focus ring tokens', () => {
  it('reads the band gradient end from PageHeader.css', () => {
    expect(bandEnd, 'no gradient end colour found in PageHeader.css').toMatch(/^#[0-9a-f]{6}$/i);
  });

  for (const theme of ['light', 'dark']) {
    for (const ground of PAGE_GROUNDS) {
      it(`--th-focus-ring clears 3:1 on ${ground} (${theme})`, () => {
        const ring = resolve(theme, 'var(--th-focus-ring)');
        const r = ratio(ring, resolve(theme, `var(${ground})`));
        expect(r, `${ring} on ${ground} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      });
    }
    it(`--th-focus-ring-on-band clears 3:1 on both ends of the band (${theme})`, () => {
      const ring = resolve(theme, 'var(--th-focus-ring-on-band)');
      for (const ground of [resolve(theme, 'var(--th-bg-band)'), bandEnd]) {
        const r = ratio(ring, ground);
        expect(r, `${ring} on ${ground} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('every shared focus rule uses the ring tokens, and so clears 3:1', () => {
  const pingUi = read('styles/ping-ui.css');
  const reel = read('components/DiagramReel.css');
  const flow = read('styles/react-flow-a11y.css');
  const lesson = read('components/lesson/lesson.css');
  const chainMenu = read('components/ChainViewMenu.css');
  const filmstrip = read('components/TokenChainFilmstrip.css');

  const PAGE_RULES = [
    ['.pu-page .pu-btn:focus-visible', pingUi],
    ['.pu-page .pu-select:focus-visible', pingUi],
    ['.pu-page a:focus-visible', pingUi],
    ['.pu-page .dc-toolbar .dc-ctrl-btn:focus-visible', pingUi],
    ['.dreel-card:focus-visible', reel],
    ['.react-flow .react-flow__node:focus-visible', flow],
    ['.react-flow .react-flow__node.selectable:focus-visible', flow],
    ['.react-flow .react-flow__edge:focus-visible', flow],
    ['.react-flow .react-flow__controls-button:focus-visible', flow],
    [':is(.lesson-page, .lesson-run, .lesson-lede, .lesson-list, .lesson-foot) a:focus-visible', lesson],
  ];
  const BAND_RULES = [
    ['.ping-page-header.ping-page-header :is(.pu-btn, .pu-select, button, a, [role=\'button\']):focus-visible', pingUi],
    ['.lesson-header.lesson-header :is(a, button, [role=\'button\']):focus-visible', lesson],
  ];
  // The token-chain strip triggers sit on the rail header bar, #16325c in both themes (= light --th-bg-emphasis).
  const STRIP_RULES = [
    ['.cvm-trigger:focus-visible', chainMenu],
    ['.tcfs-more-trigger:focus-visible', filmstrip],
  ];

  for (const [selector, css] of PAGE_RULES) {
    for (const theme of ['light', 'dark']) {
      it(`${selector} (${theme}) is a 2px+ solid ring of at least 3:1 on each page surface`, () => {
        const { colour, width } = ringOf(css, selector);
        expect(colour, `no outline colour on ${selector}`).toBeTruthy();
        expect(colour).toBe('var(--th-focus-ring)');
        expect(width).toBeGreaterThanOrEqual(2);
        const ring = resolve(theme, colour);
        for (const ground of PAGE_GROUNDS) {
          const r = ratio(ring, resolve(theme, `var(${ground})`));
          expect(r, `${selector}: ${ring} on ${ground} (${theme}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  for (const [selector, css] of STRIP_RULES) {
    for (const theme of ['light', 'dark']) {
      it(`${selector} (${theme}) clears 3:1 on the navy strip`, () => {
        const { colour, width } = ringOf(css, selector);
        expect(colour).toBe('var(--th-focus-ring-on-band)');
        expect(width).toBeGreaterThanOrEqual(2);
        const r = ratio(resolve(theme, colour), resolve('light', 'var(--th-bg-emphasis)'));
        expect(r, `ring on the strip (${theme}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      });
    }
  }

  for (const [selector, css] of BAND_RULES) {
    for (const theme of ['light', 'dark']) {
      it(`${selector} (${theme}) clears 3:1 on the dark title band`, () => {
        const { colour, width } = ringOf(css, selector);
        expect(colour).toBe('var(--th-focus-ring-on-band)');
        expect(width).toBeGreaterThanOrEqual(2);
        const ring = resolve(theme, colour);
        for (const ground of [resolve(theme, 'var(--th-bg-band)'), bandEnd]) {
          const r = ratio(ring, ground);
          expect(r, `${ring} on ${ground} (${theme}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe('React Flow zoom / fit controls are token-coloured, so they read in dark theme', () => {
  const flow = rules(read('styles/react-flow-a11y.css'));
  const root = decls(flow.find((r) => r.sel === '.react-flow')?.body ?? '');

  it('sets the controls background and icon colour from tokens (the library default is a white block)', () => {
    expect(root['--xy-controls-button-background-color']).toBe('var(--th-bg-card)');
    expect(root['--xy-controls-button-color']).toBe('var(--th-text)');
  });

  for (const theme of ['light', 'dark']) {
    for (const [bgVar, fgVar] of [
      ['--xy-controls-button-background-color', '--xy-controls-button-color'],
      ['--xy-controls-button-background-color-hover', '--xy-controls-button-color-hover'],
    ]) {
      it(`${fgVar} on ${bgVar} is 4.5:1 or better (${theme})`, () => {
        const bg = resolve(theme, root[bgVar]);
        const fg = resolve(theme, root[fgVar]);
        const r = ratio(fg, bg);
        expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('AgentClientSkin: a two-tone ring on a skin that paints its own ground', () => {
  const css = read('components/AgentClientSkin.css');
  const src = read('components/AgentClientSkin.jsx');
  const FIELD = '.agent-client-skin .acs-field:has(.acs-input:focus-visible)';
  const SEND = '.agent-client-skin .acs-send:focus-visible';

  it('the message input keeps its inline outline:none only because the wrapper rings instead', () => {
    expect(src).toMatch(/className="acs-input"/);
    expect(src).toMatch(/className="acs-field"/);
    expect(rules(css).some((r) => splitTop(r.sel).includes(FIELD))).toBe(true);
    expect(rules(css).some((r) => splitTop(r.sel).includes(SEND))).toBe(true);
  });

  for (const selector of [FIELD, SEND]) {
    for (const theme of ['light', 'dark']) {
      it(`${selector} (${theme}): the outer or the inner tone clears 3:1 on any ground`, () => {
        const body = decls(rules(css).find((r) => splitTop(r.sel).includes(selector)).body);
        const outer = resolve(theme, body.outline.replace(/^\S+\s+solid\s+/, ''));
        const inner = resolve(theme, /0 0 0 \S+ (var\(--[\w-]+\))/.exec(body['box-shadow'])[1]);
        const grounds = [
          ...Object.keys(THEMES[theme]).filter((k) => /^--th-bg(-[a-z]+)?$/.test(k)).map((k) => resolve(theme, `var(${k})`)),
          '#000000', '#ffffff', '#808080', '#767676', '#595959', '#d20e0f', '#10a37f', '#d97757',
        ].filter((g) => /^#[0-9a-f]{6}$/i.test(g));
        for (const g of grounds) {
          const best = Math.max(ratio(outer, g), ratio(inner, g));
          expect(best, `${outer}/${inner} on ${g} = ${best.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
