import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * /dashboard banking forms: the Transfer, Deposit, Withdraw and Cancel buttons render from their own rules in
 * UserDashboard.css (.transfer-btn, .deposit-submit-btn, .withdraw-submit-btn, .cancel-btn), which read the fixed
 * Ping Red --btn-accent* tokens.
 *
 * What went wrong: refinedDashboardV2.css held `[data-rd-v2] .form-actions button[type="submit"]` (background:
 * var(--theme-accent)) and `... button[type="button"]` (grey). Those are (0,3,1) against the buttons' own single-class
 * (0,1,0) rules, so on the live page the three submits were blue and Cancel was grey even though the source said red.
 * A source test that only reads the four rules cannot see that, so this one does what the browser does:
 *   1. reads every stylesheet under src/ and runs the cascade (!important, specificity) for the four buttons, built
 *      as the real DOM chain from DashboardBankingMain.jsx under the /dashboard root (the one element that carries
 *      data-rd-v2), in light and in dark, at rest, on hover and disabled;
 *   2. requires the rule that wins background, colour, border, opacity, filter, padding and font-size to be the
 *      button's own rule;
 *   3. measures the white label on the winning gradient stops (4.5:1) from the real tokens, in both themes.
 * Selectors are matched by jsdom; a selector jsdom cannot parse, a pseudo-element, and the :focus / :active states are
 * not simulated (focus ring colours are pinned by focusRingContrast.test.js).
 */
const SRC = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function cssFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') cssFiles(p, out);
    } else if (e.name.endsWith('.css')) out.push(p);
  }
  return out.sort();
}

/** Flat list of { selector, decls: {prop: {value, important}}, file, order } over every stylesheet (media conditions are ignored). */
function rulesOf(css, file) {
  const rules = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      let value = d.slice(i + 1).trim();
      const important = /!\s*important\s*$/i.test(value);
      value = value.replace(/!\s*important\s*$/i, '').trim();
      if (prop && value) decls[prop] = { value, important };
    }
    for (const selector of m[1].split(',').map((s) => s.trim()).filter(Boolean)) rules.push({ selector, decls, file });
  }
  return rules;
}

const ALL_RULES = cssFiles(SRC).flatMap((f) => rulesOf(fs.readFileSync(f, 'utf8'), path.relative(SRC, f)));
ALL_RULES.forEach((r, i) => { r.order = i; });

/** Property groups the old override touched. Shorthands count for their longhands. */
const GROUPS = {
  background: (p) => p === 'background' || p.startsWith('background-'),
  color: (p) => p === 'color',
  border: (p) => p.startsWith('border') && !p.includes('radius'),
  opacity: (p) => p === 'opacity',
  filter: (p) => p === 'filter',
  padding: (p) => p === 'padding' || p.startsWith('padding-'),
  'font-size': (p) => p === 'font-size',
};

/** CSS specificity as a sortable number [ids, classes/attrs/pseudo-classes, elements]. */
function specificity(selector) {
  let s = selector.replace(/:where\([^)]*\)/g, '');
  let extra = [0, 0, 0];
  s = s.replace(/:(is|not|has)\(([^)]*)\)/g, (_, __, arg) => {
    const best = arg.split(',').map((a) => specificity(a.trim())).sort((a, b) => cmp(b, a))[0] || [0, 0, 0];
    extra = [extra[0] + best[0], extra[1] + best[1], extra[2] + best[2]];
    return '';
  });
  const ids = (s.match(/#[\w-]+/g) || []).length;
  s = s.replace(/#[\w-]+/g, '');
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  s = s.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, '');
  const els = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids + extra[0], classes + extra[1], els + extra[2]];
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const OWN = ['transfer-btn', 'deposit-submit-btn', 'withdraw-submit-btn', 'cancel-btn'];
const WATCHED = Object.values(GROUPS);
// A rule can reach one of the buttons only if its last compound could be a button, one of the four classes, or a bare
// universal / attribute / pseudo selector. Everything else is skipped before the (slow) jsdom match.
const lastCompound = (sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop();
const CANDIDATES = ALL_RULES.filter((r) => {
  if (!Object.keys(r.decls).some((p) => WATCHED.some((g) => g(p)))) return false;
  if (/::|:before|:after|:focus|:active|:visited/.test(r.selector)) return false;
  const last = lastCompound(r.selector);
  return /button|-btn|\*/.test(last) || /^[[:]/.test(last);
});

/** The /dashboard DOM that holds each button: DashboardBankingMain.jsx inside the UserDashboardPing2026.js root. */
function buildButton(cls, theme, { disabled }) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.innerHTML = '';
  const holder = { 'transfer-btn': 'transfer-form', 'deposit-submit-btn': 'deposit-form', 'withdraw-submit-btn': 'withdraw-form', 'cancel-btn': 'transfer-form' }[cls];
  const el = (tag, className, attrs = {}) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const chain = [
    el('div', '', { id: 'root' }),
    el('div', 'udp-page pu-page customer-skin-p1 user-dashboard user-dashboard--2026 refined-customer-surface', { 'data-refined-surface': 'customer', 'data-rd-v2': '' }),
    el('div', 'ud-body-outer'),
    el('div', 'dashboard-content ud-body ud-body--2026 ud-body--floating ud-body--float-mode'),
    el('div', 'ud-center', { id: 'main-dashboard-content' }),
    el('div', 'section'),
    el('div', holder),
    el('form'),
    el('div', 'form-actions'),
  ];
  let parent = document.body;
  for (const node of chain) { parent.appendChild(node); parent = node; }
  const button = el('button', cls, { type: cls === 'cancel-btn' ? 'button' : 'submit' });
  if (disabled) button.setAttribute('disabled', '');
  parent.appendChild(button);
  return button;
}

/** The rule that wins each property group for a button, in a state ('rest' | 'hover' | 'disabled'). */
function winners(cls, theme, state) {
  const button = buildButton(cls, theme, { disabled: state === 'disabled' });
  const matching = CANDIDATES.filter((r) => {
    let sel = r.selector;
    if (/:hover/.test(sel)) {
      if (state !== 'hover') return false;
      sel = sel.replace(/:hover/g, '');
    }
    try {
      return button.matches(sel);
    } catch {
      return false;
    }
  });
  const out = {};
  for (const [name, belongs] of Object.entries(GROUPS)) {
    const declaring = matching
      .map((r) => {
        const props = Object.keys(r.decls).filter(belongs);
        return props.length ? { rule: r, value: r.decls[props[props.length - 1]].value, important: props.some((p) => r.decls[p].important), spec: specificity(r.selector) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.important) - Number(a.important) || cmp(b.spec, a.spec) || b.rule.order - a.rule.order);
    // A tie in importance and specificity between two rules is decided by stylesheet load order, which this test does not
    // model; treat it as lost so a foreign rule can never share the win.
    const [first, second] = declaring;
    const tied = Boolean(second) && !second.rule.selector.includes(cls) && second.important === first?.important && cmp(second.spec, first.spec) === 0;
    out[name] = first ? { ...first, tied } : null;
  }
  return out;
}

const STATES = [['rest', ''], ['hover', ':hover'], ['disabled', ':disabled']];

describe('the old [data-rd-v2] .form-actions button overrides are gone (and cannot come back)', () => {
  const v2 = rulesOf(read('theme/refinedDashboardV2.css'), 'theme/refinedDashboardV2.css');

  it('refinedDashboardV2.css sets no colour, background, border, opacity, size or font on .form-actions buttons (layout only)', () => {
    const offenders = v2
      .filter((r) => /\.form-actions/.test(r.selector) && /\bbutton\b|\[type/.test(r.selector))
      .flatMap((r) => Object.keys(r.decls).filter((p) => Object.values(GROUPS).some((g) => g(p)) || p.startsWith('font') || p === 'border-radius').map((p) => `${r.selector} { ${p} }`));
    expect(offenders).toEqual([]);
  });

  it('no stylesheet scopes a paint rule to [data-rd-v2] and one of the four button classes', () => {
    const offenders = ALL_RULES
      .filter((r) => /\[data-rd-v2\]/.test(r.selector) && OWN.some((c) => r.selector.includes(`.${c}`)))
      .filter((r) => Object.keys(r.decls).some((p) => Object.values(GROUPS).some((g) => g(p)) || p === 'border-radius'))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  it('[data-rd-v2] is set by the dashboard page alone, so the shared theme file reaches no other page', () => {
    const owners = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
        else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) && /data-rd-v2/.test(fs.readFileSync(p, 'utf8'))) owners.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(owners).toEqual(['components/UserDashboardPing2026.js']);
  });
});

describe('each banking-form button renders from its own rule (the cascade winner), in both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const cls of OWN) {
      for (const [state] of STATES) {
        if (cls === 'cancel-btn' && state === 'disabled') continue; // Cancel is never disabled
        it(`${theme}: .${cls} ${state}`, () => {
          const w = winners(cls, theme, state);
          for (const group of ['background', 'color', 'border', 'padding', 'font-size']) {
            const won = w[group];
            expect(won, `${group} is declared for .${cls}`).not.toBeNull();
            expect(won.rule.selector, `${group} on .${cls} (${state}) is won by ${won.rule.selector} in ${won.rule.file}`).toContain(`.${cls}`);
            expect(won.tied, `${group} on .${cls} (${state}) ties with a foreign rule`).toBe(false);
          }
          // No opacity fade or grey-out on any of the four, ever (the shared inactive style is a muted red at full opacity).
          expect(w.opacity?.value ?? '1', `opacity on .${cls} (${state}) from ${w.opacity?.rule.selector}`).toBe('1');
          expect(w.filter?.value ?? 'none', `filter on .${cls} (${state}) from ${w.filter?.rule.selector}`).toBe('none');
        });
      }
    }
  }
});

/** Token maps from index.css, as UserDashboardPing2026.contrast.test.js reads them. */
function blocks(css, sel) {
  const out = [];
  const re = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'g');
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth && i < css.length) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}
function tokenMap(css, sel, base = {}) {
  const map = { ...base };
  for (const body of blocks(css, sel)) for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}
const index = stripComments(read('index.css'));
const LIGHT = tokenMap(index, ':root');
const MAPS = { light: LIGHT, dark: tokenMap(index, ':root[data-theme="dark"]', LIGHT) };

/** Replace every var(--x[, fallback]) in a value with its token value, repeatedly. */
function substitute(map, value, depth = 0) {
  if (depth > 8) throw new Error(`token loop in ${value}`);
  const next = value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
    if (map[name] !== undefined) return map[name];
    if (fallback) return fallback;
    throw new Error(`unresolved ${name}`);
  });
  return next === value ? value : substitute(map, next, depth + 1);
}
const rgbOf = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The fill colours of a background value: every hex in it, the repeating-linear-gradient pinstripe overlay removed. */
function fillStops(map, value) {
  const resolved = substitute(map, value).replace(/repeating-linear-gradient\((?:[^()]|\([^)]*\))*\)/g, '');
  return [...resolved.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => m[0]);
}

describe('the white label on the Ping Red fill is 4.5:1 or better, in light and dark', () => {
  for (const theme of ['light', 'dark']) {
    for (const cls of OWN) {
      for (const [state] of STATES) {
        if (cls === 'cancel-btn' && state === 'disabled') continue;
        it(`${theme}: .${cls} ${state}`, () => {
          const w = winners(cls, theme, state);
          const map = MAPS[theme];
          const label = rgbOf(substitute(map, w.color.value));
          expect(label, 'the label is white').toEqual([255, 255, 255]);
          const stops = fillStops(map, w.background.value);
          expect(stops.length, `fill stops in ${w.background.value}`).toBeGreaterThan(0);
          for (const stop of stops) {
            const [r, g, b] = rgbOf(stop);
            expect(r - Math.max(g, b), `${stop} is a red`).toBeGreaterThanOrEqual(40);
            expect(ratio(label, rgbOf(stop)), `white on ${stop} (${theme}, .${cls} ${state})`).toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    }
  }

  // The 25% white pinstripe overlay the three submit buttons used to lay over the fill (~4.07:1 on the lighter bands)
  // is gone: no repeating-linear-gradient may appear in any of the four button rules again.
  it('no banking-form button rule carries a repeating-linear-gradient pinstripe overlay', () => {
    const offenders = OWN.flatMap((cls) =>
      ALL_RULES.filter((r) => r.selector.includes(`.${cls}`) && Object.values(r.decls).some((d) => /repeating-linear-gradient/.test(d.value))).map((r) => r.selector),
    );
    expect(offenders).toEqual([]);
  });
});
