import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Contrast and shared-styling fixes (theme F4, F5, F8, F9, F10; collisions CO-1, CO-2, CO-3).
 * Every ground and ink below is read from src/index.css, never hard-coded here, so a token change that breaks a
 * pairing fails this file. The computed-style twin (real browser, both themes) is tests/e2e/contrast-misc.spec.js.
 */
const SRC = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ---- tokens ----------------------------------------------------------------------------------------------------------
const indexCss = strip(read('index.css'));
const blocks = (selectorRe) => [...indexCss.matchAll(new RegExp(`(?:^|\\n)${selectorRe}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = Object.assign({}, ...blocks(':root').map(decls));
const dark = { ...light, ...Object.assign({}, ...blocks(':root\\[data-theme="dark"\\]').map(decls)) };
const THEMES = { light, dark };

const resolveVar = (map, value, depth = 0) => {
  const m = String(value).trim().match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/);
  if (!m) return String(value).trim();
  if (depth > 8) throw new Error(`token cycle at ${m[1]}`);
  const next = map[m[1]] ?? m[2];
  if (next === undefined) throw new Error(`unresolved token ${m[1]}`);
  return resolveVar(map, next, depth + 1);
};
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const tok = (theme, name) => hexToRgb(resolveVar(THEMES[theme], `var(${name})`));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));

// ---- css helpers -------------------------------------------------------------------------------------------------------
const rulesOf = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const rule = (css, selector) => rulesOf(css).filter((r) => r.sel.split(',').map((s) => s.trim()).includes(selector)).map((r) => r.body).join(';');
const prop = (body, name) => body.match(new RegExp(`(?<![-\\w])${name}:\\s*([^;]+?)\\s*(?:!important)?\\s*(?:;|$)`))?.[1];
const GROUNDS = ['--th-bg-page', '--th-bg-card', '--th-bg-inset'];

describe('token sanity (the grounds below are read from index.css)', () => {
  it('resolves both themes', () => {
    expect(tok('light', '--th-bg-card')).toEqual([255, 255, 255]);
    expect(tok('dark', '--th-bg-card')).not.toEqual(tok('light', '--th-bg-card'));
    expect(tok('dark', '--th-text')).toEqual([255, 255, 255]);
  });
});

describe('F4: the selected InspectorShell item keeps its navy ground on hover', () => {
  const css = read('components/shared/InspectorShell.css');
  it('the hover wash excludes the active item', () => {
    const hover = rulesOf(css).find((r) => /\.inspector-shell-tree-item:hover/.test(r.sel) && /--th-bg-hover/.test(r.body));
    expect(hover.sel).toContain(':not(.inspector-shell-tree-item--active)');
  });
  it('no hover rule paints a light ground behind the white active label', () => {
    const active = rule(css, '.inspector-shell-tree-item--active');
    expect(prop(active, 'color')).toBe('var(--th-text-invert)');
    const hoverRules = rulesOf(css).filter((r) => /\.inspector-shell-tree-item[^,]*:hover/.test(r.sel) && /(^|;)\s*background/.test(r.body));
    for (const r of hoverRules) expect(r.sel, r.sel).toContain(':not(.inspector-shell-tree-item--active)');
    for (const t of ['light', 'dark']) {
      expect(ratio(tok(t, '--th-text-invert'), hexToRgb(prop(active, 'background'))), t).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('F5: unselected controls use --control-border, 3:1 on every ground in both themes', () => {
  const targets = [
    ['components/DiagramReel.css', '.dreel-card', 'border'],
    ['components/DiagramReel.css', '.dreel-close', 'border'],
    ['components/DiagramReel.css', '.dreel-font button', 'border'],
    ['components/DiagramStepBar.css', '.dstep-reset', 'border'],
    ['components/diagram/StepTimeSelector.css', '.dc-steptime-select', 'border'],
    ['pages/DelegatedCommercePage.css', '.dcom-page .dcom-step', 'border'],
    ['pages/PingOneProtectBrowserDemo.css', '.p1p-auth__form input', 'border'],
    ['pages/PingOneProtectBrowserDemo.css', '.p1p-auth__secondary', 'border'],
    ['components/TransactionConsentPage.css', '.tx-otp-panel__input', 'border'],
    ['components/TransactionConsentPage.css', '.tx-otp-panel__resend-btn', 'border'],
    ['components/CIBAPanel.css', '.ciba-input', 'border'],
  ];
  it.each(targets)('%s %s edge is var(--control-border)', (file, selector, p) => {
    const body = rule(read(file), selector);
    expect(body, `${selector} not found in ${file}`).not.toBe('');
    expect(prop(body, p)).toMatch(/var\(--control-border\)/);
    expect(body).not.toMatch(/border[^;]*var\(--th-border(-strong)?\)/);
  });
  it.each(['light', 'dark'])('--control-border is >= 3:1 on page, card and inset in %s', (t) => {
    for (const g of GROUNDS) expect(ratio(tok(t, '--control-border'), tok(t, g)), `${t} ${g}`).toBeGreaterThanOrEqual(3);
  });
  it('the step-time select is on theme tokens, not a white literal', () => {
    const body = rule(read('components/diagram/StepTimeSelector.css'), '.dc-steptime-select');
    expect(prop(body, 'background')).toBe('var(--th-bg-card)');
    expect(prop(body, 'color')).toBe('var(--th-text)');
  });
});

describe('F8: the assistant dock never carries a second red primary', () => {
  const js = read('components/AIAgent.js');
  const css = read('components/AIAgent.css');
  it('the Dashboard navigation button is not a .primary', () => {
    const at = js.indexOf('Dashboard navigation button');
    expect(at).toBeGreaterThan(0);
    const snippet = js.slice(at, at + 400);
    expect(snippet).toContain('ba-left-auth-btn ba-left-nav-btn');
    expect(snippet).not.toMatch(/ba-left-auth-btn primary/);
  });
  it('the nav button is a bordered secondary on tokens', () => {
    const body = rule(css, '.banking-agent-panel .ba-left-auth-btn.ba-left-nav-btn');
    expect(prop(body, 'background')).toBe('var(--th-bg-card)');
    expect(prop(body, 'background-image')).toBe('none');
    expect(prop(body, 'border')).toMatch(/var\(--control-border\)/);
    expect(prop(body, 'color')).toBe('var(--th-text)');
  });
});

// Whole-element opacity composites the fill and the label over the ground: white label at opacity o over a fill at opacity o.
const labelContrast = (theme, fillHex, o, groundToken) => {
  const ground = tok(theme, groundToken);
  return ratio(over([255, 255, 255], o, ground), over(hexToRgb(fillHex), o, ground));
};

describe('F9: the busy PingOne Protect primary keeps its label at >= 4.5:1', () => {
  const css = read('pages/PingOneProtectBrowserDemo.css');
  const opacity = Number(prop(rule(css, '.p1p-auth__run-chip[aria-disabled="true"]'), 'opacity'));
  it('keeps the Ping Red gradient and the fixed tokens', () => {
    const body = rule(css, '.p1p-auth__run-chip');
    expect(prop(body, 'background-image')).toBe('var(--btn-accent-gradient)');
    expect(prop(body, 'color')).toBe('var(--btn-accent-text)');
  });
  it.each([['light'], ['dark']])('%s: lightest gradient stop at the busy opacity', (t) => {
    const fill = resolveVar(THEMES[t], 'var(--btn-accent)');
    for (const g of GROUNDS) expect(labelContrast(t, fill, opacity, g), `${t} ${g} opacity ${opacity}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('F10: the disabled Send primary keeps its label at >= 4.5:1', () => {
  const css = rulesOf(read('components/AIAgent.css'));
  const last = css.filter((r) => r.sel === '.ba-send-btn:disabled' && /opacity:[^;]*!important/.test(r.body)).pop();
  const opacity = Number(prop(last.body, 'opacity'));
  const fill = prop(last.body, 'background');
  it.each([['light'], ['dark']])('%s: !important disabled fill at its opacity', (t) => {
    for (const g of GROUNDS) expect(labelContrast(t, fill, opacity, g), `${t} ${g} ${fill} @ ${opacity}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('CO-2: the CIBA drawer follows the theme', () => {
  const css = read('components/CIBAPanel.css');
  it('the drawer ground is a token, not white', () => {
    const body = rule(css, '.ciba-drawer');
    expect(prop(body, 'background')).toBe('var(--th-bg-card)');
    expect(prop(body, 'color')).toBe('var(--th-text)');
  });
  it.each([['light'], ['dark']])('%s: body ink on the drawer ground is >= 4.5:1', (t) => {
    const ground = tok(t, '--th-bg-card');
    for (const ink of ['--th-text', '--th-text-body']) expect(ratio(tok(t, ink), ground), `${t} ${ink}`).toBeGreaterThanOrEqual(4.5);
  });
  it('no section or tab ink is the fixed navy literal that vanishes on the dark ground', () => {
    for (const sel of ['.ciba-tab:hover', '.ciba-tab--active', '.ciba-section-title', '.ciba-endpoint-row code']) {
      expect(prop(rule(css, sel), 'color'), sel).toBe('var(--th-text)');
    }
  });
  it('the live inline text and the shared education panels carry token ink, not #374151 / #475569', () => {
    for (const f of ['components/CIBAPanel.js', 'components/education/educationContent.js', 'components/education/educationImplementationSnippets.js', 'components/education/TokenChainPanel.js']) {
      expect(read(f), f).not.toMatch(/color:\s*'#(374151|475569)'/);
    }
  });
  it('code inside the navy header and tinted notices inherits its container ink', () => {
    expect(prop(rule(css, '.ciba-subtitle code'), 'color')).toBe('inherit');
    expect(prop(rule(css, '.ciba-notice code'), 'color')).toBe('inherit');
  });
});

describe('CO-3: no unscoped scrollbar rule in TokenFlowDetailModal.css', () => {
  const css = read('components/TokenFlowDetailModal.css');
  it('every ::-webkit-scrollbar selector sits under .tfd-root', () => {
    const sel = rulesOf(css).filter((r) => r.sel.includes('::-webkit-scrollbar'));
    expect(sel.length).toBeGreaterThan(0);
    for (const r of sel) expect(r.sel, r.sel).toMatch(/^\.tfd-root /);
  });
  it('the thumb is >= 3:1 on the modal ground in its dark default and in .tfd-light', () => {
    expect(prop(rule(css, '.tfd-root ::-webkit-scrollbar-thumb'), 'background')).toBe('var(--tfd-scroll-thumb)');
    const darkThumb = hexToRgb(prop(rule(css, '.tfd-root'), '--tfd-scroll-thumb'));
    const lightBody = rule(css, '.tfd-root.tfd-light');
    const lightThumb = hexToRgb(prop(lightBody, '--tfd-scroll-thumb'));
    const darkGround = hexToRgb(css.match(/--surface-primary,\s*(#[0-9a-fA-F]{6})\)/)[1]);
    const lightGround = hexToRgb(prop(lightBody, '--surface-primary'));
    expect(ratio(darkThumb, darkGround)).toBeGreaterThanOrEqual(3);
    expect(ratio(lightThumb, lightGround)).toBeGreaterThanOrEqual(3);
  });
});

describe('CO-1: PrivilegeMapPage.css cannot restyle other pages once it has loaded', () => {
  const rules = rulesOf(read('pages/PrivilegeMapPage.css'));
  it('every diagram-toolbar and link-primary rule is scoped to .pmap-page', () => {
    const risky = rules.filter((r) => /\.dstep-bar|\.dc-ctrl-btn|a\.pu-btn/.test(r.sel));
    expect(risky.length).toBeGreaterThan(0);
    for (const r of risky) for (const s of r.sel.split(',')) expect(s.trim(), s).toContain('.pmap-page');
  });
  it('no rule in the file starts at a bare .pu-page without the page class when it touches buttons', () => {
    for (const r of rules.filter((x) => /\.pu-page /.test(x.sel) && /button|btn/.test(x.sel))) {
      for (const s of r.sel.split(',')) expect(s.trim(), s).toMatch(/\.pmap-/);
    }
  });
});
