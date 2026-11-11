import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Mutation tests for scripts/check-ui-patterns.mjs. Each case builds a throwaway copy of the converted
 * SaaS Access page, the shared stylesheet and the shared components, applies ONE violation that a
 * skeptic got past the first version of the check, runs the real script on that copy and expects exit 1.
 * The clean copy must exit 0, so a red case is caused by the mutation and not by the harness.
 *
 * The script is copied into the temp root and run from there (it resolves its root from its own
 * location), so this file imports nothing from it: point it at any version of the script to compare.
 */
const UI = path.resolve(__dirname, '..', '..');
// UI_PATTERN_SCRIPT=/path/to/older/check-ui-patterns.mjs runs every case against another version of the script
// (that is how the round-2 cases are shown to fail on the round-1 script).
const SCRIPT = process.env.UI_PATTERN_SCRIPT || path.join(UI, 'scripts/check-ui-patterns.mjs');
const COPY = [
  'src/index.css',
  'src/styles/ping-ui.css',
  'src/components/pingUi/index.jsx',
  'src/components/privilege/PrivilegeLiveCheck.jsx',
  'src/components/privilege/PrivilegeLiveCheck.css',
  // The /dashboard parts are in the script's shared set, so the copy must carry them or "shared files present" fails.
  'src/components/DashboardBankingMain.jsx',
  'src/components/DashboardClinicalSplit.jsx',
  'src/components/DashboardFrameParts.jsx',
  'src/components/DashboardGlobalModals.jsx',
  'src/components/DashboardStepUpToast.jsx',
  'src/components/DashboardStepUpToast.css',
  'src/components/DashboardTracePanels.jsx',
  'src/pages/PrivilegeSaasAccessPage.jsx',
  'src/pages/PrivilegeSaasAccessPage.css',
];
const PAGE_JSX = 'src/pages/PrivilegeSaasAccessPage.jsx';
const PAGE_CSS = 'src/pages/PrivilegeSaasAccessPage.css';
const SHARED_CSS = 'src/styles/ping-ui.css';
const APP = `const PrivilegeSaasAccessPage = lazyWithRetry(() => import("./pages/PrivilegeSaasAccessPage"));
const routes = <Route path="/privilege-saas-access" element={<PrivilegeSaasAccessPage />} />;
`;

let base;
const roots = [];

/** Fresh temp root with the clean copy; `mutate(helpers)` edits it before the script runs. */
function build(mutate) {
  const root = fs.mkdtempSync(path.join(base, 'case-'));
  roots.push(root);
  for (const rel of COPY) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(UI, rel), path.join(root, rel));
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/check-ui-patterns.mjs'));
  fs.writeFileSync(path.join(root, 'src/App.js'), APP);
  fs.writeFileSync(path.join(root, 'scripts/ui-pattern-converted.txt'), '/privilege-saas-access\n');
  const file = (rel) => path.join(root, rel);
  const h = {
    append: (rel, text) => fs.appendFileSync(file(rel), `\n${text}\n`),
    prepend: (rel, text) => fs.writeFileSync(file(rel), `${text}\n${fs.readFileSync(file(rel), 'utf8')}`),
    write: (rel, text) => {
      fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
      fs.writeFileSync(file(rel), text);
    },
    edit: (rel, fn) => {
      const src = fs.readFileSync(file(rel), 'utf8');
      const out = fn(src);
      if (out === src) throw new Error(`edit changed nothing in ${rel}`);
      fs.writeFileSync(file(rel), out);
    },
    replace: (rel, from, to) => {
      const src = fs.readFileSync(file(rel), 'utf8');
      if (!src.includes(from)) throw new Error(`mutation anchor not found in ${rel}: ${from}`);
      fs.writeFileSync(file(rel), src.replace(from, to));
    },
  };
  if (mutate) mutate(h);
  return root;
}

/** Run the copied script in `root`. A run that printed nothing did not run the check, so it is an error, not a pass. */
function exec(root) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/check-ui-patterns.mjs')], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  if (!/\d+ routed pages/.test(out)) throw new Error(`the check did not run (exit ${r.status}):\n${out}`);
  return { status: r.status, out };
}

/** The rule must appear on a DRIFT line (enforced pages print their PASS rows too, so a bare match proves nothing). */
function expectDrift(out, rule) {
  expect(out).toMatch(new RegExp(`^\\s*DRIFT .*${rule.source}`, 'm'));
}

function run(mutate) {
  return exec(build(mutate));
}

beforeAll(() => {
  // realpath: on macOS os.tmpdir() is a symlink and the script's main() guard compares real paths.
  base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ui-pattern-mutation-'));
});
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const RESET = 'data-testid="psa-reset">Reset</button>';
const INDIGO = '#4f46e5';

describe('check-ui-patterns: clean baseline', () => {
  it('the unmodified copy exits 0', () => {
    const r = run();
    expect(r.status, r.out).toBe(0);
  });

  it('reports the shared set as its own always-enforced block', () => {
    const r = run();
    expect(r.out).toMatch(/\[SHARED, always enforced\]/);
    expect(r.out).toMatch(/shared set clean/);
  });

  it('near-black ink, Ping blue, Ping red and a violet card edge are not flagged', () => {
    const r = run((h) =>
      h.append(
        PAGE_CSS,
        `.psa-x-btn { color: hsl(250 20% 8%); background: hsl(209 77% 31%); border-color: oklch(0.55 0.22 27); }
         .psa-x-card { border-top-color: hsl(250 80% 50%); }
         .psa-ok { font: 700 10px/1.2 sans-serif; font-size: clamp(0.75rem, 1vw, 1rem); }`,
      ),
    );
    expect(r.status, r.out).toBe(0);
  });
});

describe('check-ui-patterns: the eight escapes now exit 1', () => {
  const cases = [
    ['(a) indigo button via hsl(250 80% 50%)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: hsl(250 80% 50%); }'), /P9 no violet/],
    [
      '(b) indigo via a custom property, .psa-x-btn { background: var(--ind) }',
      (h) => h.append(PAGE_CSS, `:root { --ind: ${INDIGO}; }\n.psa-x-btn { background: var(--ind); }`),
      /P9 no violet/,
    ],
    [
      '(c) indigo on .psa-go, a class with no button/btn in its name that is applied to a <button>',
      (h) => {
        h.replace(PAGE_JSX, RESET, `${RESET}\n                <button type="button" className="psa-go">Go</button>`);
        h.append(PAGE_CSS, `.psa-go { background: ${INDIGO}; }`);
      },
      /P9 no violet/,
    ],
    ['(d) font: 9px/1.2 sans-serif', (h) => h.append(PAGE_CSS, '.psa-tiny { font: 9px/1.2 sans-serif; }'), /H2 10px font floor/],
    ['(e) indigo on .pu-btn in ping-ui.css', (h) => h.append(SHARED_CSS, `.pu-btn { background: ${INDIGO}; }`), /shared: P9 no violet/],
    ['(f) font-size: 9px in ping-ui.css', (h) => h.append(SHARED_CSS, '.pu-tiny { font-size: 9px; }'), /shared: H2 10px font floor/],
    [
      '(g) a StatusChip whose only child is {""}',
      (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">{""}</StatusChip>'),
      /P7 chips carry text/,
    ],
    [
      '(h) a second stylesheet pulled in by @import',
      (h) => {
        h.prepend(PAGE_CSS, '@import "./psa-extra.css";');
        h.write('src/pages/psa-extra.css', `.psa-x-btn { background: ${INDIGO}; }\n`);
      },
      /P9 no violet/,
    ],
  ];
  it.each(cases)('%s', (_name, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });
});

describe('check-ui-patterns: more mutations', () => {
  const cases = [
    [
      'indigo in the shared child PrivilegeLiveCheck.css (.plc__run is the trigger button)',
      (h) => h.append('src/components/privilege/PrivilegeLiveCheck.css', '.plc__run { background: oklch(0.5 0.2 285); }'),
      /shared: P9 no violet/,
    ],
    [
      'shared StatusChip loses its text (children dropped in pingUi/index.jsx)',
      (h) => h.replace('src/components/pingUi/index.jsx', '{children}\n    </span>\n  );\n}\n\n/** P5', '{""}\n    </span>\n  );\n}\n\n/** P5'),
      /shared: P7 chips carry text/,
    ],
    [
      'the fixed button token --btn-accent turned violet in index.css',
      (h) => h.replace('src/index.css', '--btn-accent: #d20e0f;', '--btn-accent: #6d28d9;'),
      /shared: P9 fixed button tokens/,
    ],
    [
      'the type scale token --font-size-3xs dropped below the floor',
      (h) => h.replace('src/index.css', '--font-size-3xs: 10px;', '--font-size-3xs: 9px;'),
      /shared: H2 type scale/,
    ],
    ['a vertical token reached through a var() chain (--pu-accent -> --app-primary-red)', (h) => h.append(PAGE_CSS, '.psa-x-btn { border-color: var(--pu-accent); }'), /vertical colour token/],
    ['a button element selector, button.psa-y { background: oklab(0.5 0.1 -0.2) }', (h) => h.append(PAGE_CSS, 'button.psa-y { background: oklab(0.5 0.1 -0.2); }'), /P9 no violet/],
    ['[type="submit"] with lch violet', (h) => h.append(PAGE_CSS, '[type="submit"] { background: lch(40 60 300); }'), /P9 no violet/],
    ['a violet named colour that is not on the old list (plum) on a button', (h) => h.append(PAGE_CSS, '.psa-x-btn { color: plum; }'), /P9 no violet/],
    ['hwb violet on a button', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: hwb(260 10% 20%); }'), /P9 no violet/],
    ['violet nested in a gradient inside color-mix on a button', (h) => h.append(PAGE_CSS, `.psa-x-btn { background: linear-gradient(90deg, color-mix(in srgb, ${INDIGO} 60%, white), red); }`), /P9 no violet/],
    ['violet through CSS nesting', (h) => h.append(PAGE_CSS, `.psa-card { .psa-go-btn { background: ${INDIGO}; } }`), /P9 no violet/],
    [
      'violet through a channel custom property, rgb(var(--rgb))',
      (h) => h.append(PAGE_CSS, ':root { --rgb: 79 70 229; }\n.psa-x-btn { background: rgb(var(--rgb)); }'),
      /P9 no violet/,
    ],
    ['font-size in pt (6pt = 8px)', (h) => h.append(PAGE_CSS, '.psa-t { font-size: 6pt; }'), /H2 10px font floor/],
    ['font-size from a custom property (--tiny: 9px)', (h) => h.append(PAGE_CSS, ':root { --tiny: 9px; }\n.psa-t { font-size: var(--tiny); }'), /H2 10px font floor/],
    ['font shorthand through a custom property', (h) => h.append(PAGE_CSS, ':root { --f: italic 600 8px/1 serif; }\n.psa-t { font: var(--f); }'), /H2 10px font floor/],
    ['font-size: clamp(8px, 2vw, 14px) (8px at phone width)', (h) => h.append(PAGE_CSS, '.psa-t { font-size: clamp(8px, 2vw, 14px); }'), /H2 10px font floor/],
    ['font-size: xx-small', (h) => h.append(PAGE_CSS, '.psa-t { font-size: xx-small; }'), /H2 10px font floor/],
    ['font-size: calc(0.5rem + 1px)', (h) => h.append(PAGE_CSS, '.psa-t { font-size: calc(0.5rem + 1px); }'), /H2 10px font floor/],
    ['font-size inside @media', (h) => h.append(PAGE_CSS, '@media (max-width: 400px) { .psa-t { font-size: 9px; } }'), /H2 10px font floor/],
    ['a chip with {" "} as its only child', (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">{" "}</StatusChip>'), /P7 chips carry text/],
    ['a chip with &nbsp; as its only child', (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">&nbsp;</StatusChip>'), /P7 chips carry text/],
    ['a chip with {null}', (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">{null}</StatusChip>'), /P7 chips carry text/],
    ['a chip with children=""', (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info" children="" />'), /P7 chips carry text/],
    [
      'an hsl() colour in an inline style custom property',
      (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', `<p className="psa-justification" style={{ '--x': 'hsl(250 80% 50%)' }}>`),
      /H3 no inline colour/,
    ],
    [
      'an @import two hops deep',
      (h) => {
        h.prepend(PAGE_CSS, '@import url("./psa-a.css");');
        h.write('src/pages/psa-a.css', '@import "./psa-b.css";\n');
        h.write('src/pages/psa-b.css', `.psa-x-btn { background: ${INDIGO}; }\n`);
      },
      /P9 no violet/,
    ],
  ];
  it.each(cases)('%s', (_name, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });

  it('a missing shared file cannot silently drop coverage', () => {
    const root = build();
    fs.rmSync(path.join(root, 'src/components/privilege/PrivilegeLiveCheck.css'));
    const r = exec(root);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, /shared files present/);
  });

  it('the shared set fails CI even when the page allowlist is empty', () => {
    const root = build((h) => h.append(SHARED_CSS, `.pu-btn { background: ${INDIGO}; }`));
    fs.writeFileSync(path.join(root, 'scripts/ui-pattern-converted.txt'), '# none\n');
    const r = exec(root);
    expect(r.status, r.out).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 2: the escapes a skeptic found in the round-1 script (42 of 77 new violations passed), and more of our own.
// Every case below exits 0 on the round-1 script and 1 on this one; the "stays clean" cases exit 0 on both.
// ---------------------------------------------------------------------------------------------------------------

const PINGUI = 'src/components/pingUi';
const STAGE_ANCHOR = 'const STAGE_INDEX';
const VIOLET_GO = `.psa-go, .psaGo { background: ${INDIGO}; }`;
/** Adds a top-level declaration and/or a button to the page, and a violet rule for .psa-go in its stylesheet. */
const withButton = (extraTop, button) => (h) => {
  if (extraTop) h.replace(PAGE_JSX, STAGE_ANCHOR, `${extraTop}\n${STAGE_ANCHOR}`);
  if (button) h.replace(PAGE_JSX, RESET, `${RESET}\n                ${button}`);
  h.append(PAGE_CSS, VIOLET_GO);
};
const asCase = (name, mutate, rule) => [name, mutate, rule];
const P9 = /P9 no violet/;
const RESOLVABLE = /P9 button colours resolvable/;
const FLOOR = /H2 10px font floor/;
const SIZES = /H2 font sizes resolvable/;
const BTN_TOKENS = /P9 fixed button tokens/;
const SCALE = /H2 type scale/;

describe('check-ui-patterns round 2: token overrides in ANY scanned stylesheet (skeptic 1)', () => {
  const cases = [
    asCase('page CSS: --btn-accent turned violet under a non-button selector', (h) => h.append(PAGE_CSS, '.psa-x { --btn-accent: #6d28d9; }'), BTN_TOKENS),
    asCase('page CSS: --btn-accent-gradient turned violet', (h) => h.append(PAGE_CSS, '.psa-x { --btn-accent-gradient: linear-gradient(90deg, #6d28d9, #4c1d95); }'), BTN_TOKENS),
    asCase('page CSS: --font-size-xs redefined to 6px', (h) => h.append(PAGE_CSS, ':root { --font-size-xs: 6px; }'), SCALE),
    asCase('page CSS: --font-size-sm redefined to unitless 0', (h) => h.append(PAGE_CSS, '.psa-x { --font-size-sm: 0; }'), SCALE),
    asCase(
      'an @import-ed stylesheet redefines --btn-accent-hover (hsl violet)',
      (h) => {
        h.prepend(PAGE_CSS, '@import "./psa-tokens.css";');
        h.write('src/pages/psa-tokens.css', ':root { --btn-accent-hover: hsl(260 70% 45%); }\n');
      },
      BTN_TOKENS,
    ),
    asCase('@property --btn-accent with a violet initial-value', (h) => h.append(PAGE_CSS, "@property --btn-accent { syntax: '<color>'; inherits: true; initial-value: rebeccapurple; }"), BTN_TOKENS),
    asCase('page CSS: --btn-accent reads a vertical token', (h) => h.append(PAGE_CSS, '.psa-x { --btn-accent: var(--app-primary-red); }'), BTN_TOKENS),
    asCase('page CSS: --btn-accent from a var() that is defined nowhere (unresolvable)', (h) => h.append(PAGE_CSS, '.psa-x { --btn-accent: var(--never-defined-anywhere); }'), BTN_TOKENS),
    asCase('(also caught in round 1) shared CSS: --font-size-md redefined to 8px in ping-ui.css', (h) => h.append(SHARED_CSS, ':root { --font-size-md: 8px; }'), /shared: H2 type scale/),
    asCase(
      'inline style overrides --btn-accent on an element',
      (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', `<p className="psa-justification" style={{ '--btn-accent': 'teal' }}>`),
      /H3 no inline colour/,
    ),
  ];
  it.each(cases)('%s', (_n, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });
});

describe('check-ui-patterns round 2: the shared directory is walked recursively (skeptic 2)', () => {
  const cases = [
    asCase('a nested stylesheet pingUi/sub/deep.css', (h) => h.write(`${PINGUI}/sub/deep.css`, `.pu-btn { background: ${INDIGO}; }\n`), /shared: P9 no violet/),
    asCase('a .tsx file with an inline colour', (h) => h.write(`${PINGUI}/Extra.tsx`, "export const X = () => <span style={{ color: '#fff' }}>x</span>;\n"), /shared: H3/),
    asCase('a .mjs file with an inline background', (h) => h.write(`${PINGUI}/helper.mjs`, 'export const c = <i style={{ background: "#fff" }} />;\n'), /shared: H3/),
    asCase('a .ts file that assigns element.style.color', (h) => h.write(`${PINGUI}/dom.ts`, "export const f = (el: HTMLElement) => { el.style.color = 'red'; };\n"), /shared: H3/),
    asCase('a .scss file the scanner cannot read', (h) => h.write(`${PINGUI}/legacy.scss`, '.pu-btn { background: #4f46e5; }\n'), /shared files understood/),
    asCase('an unknown file type (.html) in a nested directory', (h) => h.write(`${PINGUI}/a/b/note.html`, '<style>.pu-btn{background:#4f46e5}</style>\n'), /shared files understood/),
    asCase(
      'a symlink inside the shared directory',
      (h) => {
        h.write(`${PINGUI}/real.css`, '.x { color: red; }\n');
        fs.symlinkSync(path.join(base, 'does-not-matter'), path.join(roots[roots.length - 1], PINGUI, 'link.css'));
      },
      /shared files understood/,
    ),
    asCase(
      'a nested .jsx that imports its own stylesheet with a tiny font',
      (h) => {
        h.write(`${PINGUI}/n/Tiny.jsx`, "import './tiny.css';\nexport const T = () => <b>x</b>;\n");
        h.write(`${PINGUI}/n/tiny.css`, '.t { font-size: 8px; }\n');
      },
      /shared: H2 10px font floor/,
    ),
  ];
  it.each(cases)('%s', (_n, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });

  it('inert files (.md, .txt) in the shared directory do not fail the run', () => {
    const r = run((h) => h.write(`${PINGUI}/sub/NOTES.md`, '# notes\n.pu-btn { background: #4f46e5 }\n'));
    expect(r.status, r.out).toBe(0);
  });
});

describe('check-ui-patterns round 2: at-rules in any case, and keyframes (skeptic 3)', () => {
  const cases = [
    asCase('@MEDIA (upper case) around a 9px font', (h) => h.append(PAGE_CSS, '@MEDIA (min-width: 1px) { .psa-t { font-size: 9px; } }'), FLOOR),
    asCase('@Supports (mixed case) around a violet button', (h) => h.append(PAGE_CSS, `@Supports (display: grid) { .psa-x-btn { background: ${INDIGO}; } }`), P9),
    asCase('@LAYER around a violet button', (h) => h.append(PAGE_CSS, `@LAYER ui { .psa-x-btn { background: ${INDIGO}; } }`), P9),
    asCase('@Container around a violet button', (h) => h.append(PAGE_CSS, `@Container (min-width: 1px) { .psa-x-btn { background: ${INDIGO}; } }`), P9),
    asCase('an unknown at-rule block around a violet button', (h) => h.append(PAGE_CSS, `@future-rule (x) { .psa-x-btn { background: ${INDIGO}; } }`), P9),
    asCase('a 8px font inside @keyframes', (h) => h.append(PAGE_CSS, '@keyframes grow { from { font-size: 12px; } to { font-size: 8px; } }'), FLOOR),
    asCase('a 8px font inside @-webkit-keyframes', (h) => h.append(PAGE_CSS, '@-webkit-keyframes k { 50% { font-size: 8px; } }'), FLOOR),
    asCase('@keyframes that a button animates to violet', (h) => h.append(PAGE_CSS, `.psa-x-btn { animation: swap 1s; }\n@keyframes swap { to { background: ${INDIGO}; } }`), P9),
    asCase('@keyframes animated through animation-name on a button class', (h) => h.append(PAGE_CSS, `.psa-x-btn { animation-name: swap; }\n@keyframes swap { to { border-color: oklch(0.5 0.2 285); } }`), P9),
  ];
  it.each(cases)('%s', (_n, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });

  it('a @keyframes nothing animates with a button is not a button rule', () => {
    const r = run((h) => h.append(PAGE_CSS, `@keyframes psa-pulse { to { background: ${INDIGO}; } }\n.psa-card { animation: psa-pulse 1s; }`));
    expect(r.status, r.out).toBe(0);
  });
});

describe('check-ui-patterns round 2: colours fail closed (skeptic 4)', () => {
  const btn = (decl) => (h) => h.append(PAGE_CSS, `.psa-x-btn { ${decl} }`);
  const violet = [
    ['calc() inside hsl()', 'background: hsl(calc(250) 80% 50%);'],
    ['calc() inside rgb()', 'background: rgb(calc(79) 70 229);'],
    ['calc() inside oklch()', 'background: oklch(calc(0.5) 0.2 calc(285));'],
    ['color(srgb) with calc()', 'background: color(srgb calc(0.3) 0.27 0.9);'],
    ['color(xyz-d65 ...)', 'background: color(xyz-d65 0.1955 0.117 0.7535);'],
    ['color(xyz-d50 ...)', 'background: color(xyz-d50 0.19 0.115 0.57);'],
    ['color(srgb-linear ...)', 'background: color(srgb-linear 0.0782 0.0612 0.7835);'],
    ['color(a98-rgb ...)', 'background: color(a98-rgb 0.3 0.28 0.85);'],
    ['color(rec2020 ...)', 'background: color(rec2020 0.3 0.25 0.8);'],
    ['color(prophoto-rgb ...)', 'background: color(prophoto-rgb 0.3 0.2 0.6);'],
    ['color-mix whose inputs are fine but whose result is purple', 'background: color-mix(in srgb, #ff0066, #0066ff);'],
    ['color-mix in oklab whose inputs are fine but whose result is purple', 'border-color: color-mix(in oklab, #ff0066 50%, #0066ff);'],
    ['light-dark() with a violet dark branch built with calc()', 'background: light-dark(white, hsl(calc(250) 80% 50%));'],
    ['relative colour: hsl(from red calc(h + 250) s l)', 'background: hsl(from red calc(h + 250) s l);'],
    ['relative colour: oklch(from #d20e0f l c calc(h + 260))', 'background: oklch(from #d20e0f l c calc(h + 260));'],
    ['relative colour from a blue origin: rgb(from #0066ff calc(r + 100) g b)', 'background: rgb(from #0066ff calc(r + 100) g b);'],
    ['system colour VisitedText (purple)', 'border-color: VisitedText;'],
    ['violet inside a drop-shadow filter', 'filter: drop-shadow(0 0 4px hsl(calc(250) 80% 50%));'],
    ['violet in a stop-color style property', 'stop-color: hwb(260 10% 20%);'],
    ['a property written with a CSS escape (b\\61 ckground)', 'b\\61 ckground: #4f46e5;'],
    ['violet in scrollbar-color', 'scrollbar-color: #4f46e5 transparent;'],
  ];
  it.each(violet)('violet: %s', (_n, decl) => {
    const r = run(btn(decl));
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, P9);
  });

  const unknown = [
    ['attr() supplies the colour', 'background: attr(data-colour type(<color>));'],
    ['a var() that is defined nowhere', 'background: var(--never-defined-anywhere);'],
    ['a relative colour from currentColor', 'background: rgb(from currentColor r g b);'],
    ['a colour function with a keyword it cannot resolve', 'background: hsl(calc(var(--x) + 1) 80% 50%);'],
    ['an OS-tinted system colour (AccentColor)', 'background: AccentColor;'],
    ['env() supplies the colour', 'border-color: env(brand-colour);'],
    ['color() in a space the script does not know', 'background: color(future-space 0.3 0.2 0.9);'],
    ['a fallback chain that never resolves', 'background: var(--a-b-c, var(--d-e-f));'],
    ['a self-referencing var()', ':root { --loop: var(--loop); } .psa-x-btn { background: var(--loop); }'],
  ];
  it.each(unknown)('unknown colour fails: %s', (_n, decl) => {
    const r = run(decl.includes('{') ? (h) => h.append(PAGE_CSS, decl) : btn(decl));
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, RESOLVABLE);
  });

  it('unknown colours on a NON-button rule do not fail (cards and heroes follow the vertical)', () => {
    const r = run((h) => h.append(PAGE_CSS, '.psa-card { border-top-color: var(--never-defined-anywhere); background: attr(data-c type(<color>)); }'));
    expect(r.status, r.out).toBe(0);
  });

  it('the safe keywords and resolvable tokens stay clean on a button', () => {
    const r = run(btn('color: currentColor; background: transparent; border-color: inherit; outline-color: initial; box-shadow: none; background-image: var(--btn-accent-gradient); border: 1px solid color-mix(in srgb, #d20e0f 40%, transparent); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 0 0 2px hsl(calc(209) 77% 31%); color: light-dark(#111, #fff); background-color: rgb(from #d20e0f r g b);'));
    expect(r.status, r.out).toBe(0);
  });

  describe('the per-line escape comment', () => {
    const line = 'background: attr(data-colour type(<color>));';
    it('lets an UNRESOLVABLE colour through and lists the escape in the report', () => {
      const r = run(btn(`/* ui-pattern: allow colour comes from a data attribute set by the vertical shell */ ${line}`));
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/ui-pattern escapes - .*colour comes from a data attribute/);
      expect(r.out).toMatch(/1 file\(s\) with ui-pattern escapes/);
    });
    it('on the line above the declaration also counts', () => {
      const r = run((h) => h.append(PAGE_CSS, `.psa-x-btn {\n  /* ui-pattern: allow attr() colour is validated by the shell */\n  ${line}\n}`));
      expect(r.status, r.out).toBe(0);
    });
    it('without a reason it is itself drift and excuses nothing', () => {
      const r = run(btn(`/* ui-pattern: allow */ ${line}`));
      expect(r.status, r.out).toBe(1);
      expectDrift(r.out, /ui-pattern escape needs a reason/);
      expectDrift(r.out, RESOLVABLE);
    });
    it('never excuses a colour that resolves to violet', () => {
      const r = run(btn(`/* ui-pattern: allow this one is fine, trust me please */ background: ${INDIGO};`));
      expect(r.status, r.out).toBe(1);
      expectDrift(r.out, P9);
    });
    it('covers only its own line, not a later declaration', () => {
      const r = run((h) => h.append(PAGE_CSS, `.psa-x-btn {\n  /* ui-pattern: allow attr() colour is validated by the shell */\n  ${line}\n  color: attr(data-other type(<color>));\n}`));
      expect(r.status, r.out).toBe(1);
      expectDrift(r.out, RESOLVABLE);
    });
  });
});

describe('check-ui-patterns round 2: button detection beyond class literals (skeptic 5)', () => {
  const cases = [
    asCase('className={variable} assigned a string once', withButton("const goCls = 'psa-go';", '<button type="button" className={goCls}>Go</button>'), P9),
    asCase('(also caught in round 1) className={ternary}', withButton('', `<button type="button" className={stage ? 'psa-go' : 'psa-no'}>Go</button>`), P9),
    asCase('className={template literal} with a known variable', withButton("const kind = 'go';", '<button type="button" className={`psa-${kind}`}>Go</button>'), P9),
    asCase('className={template literal} with a hole nobody can resolve (prefix pattern psa-g*)', withButton('', '<button type="button" className={`psa-g${scenario.key}`}>Go</button>'), P9),
    asCase('(also caught in round 1) className={clsx(...)} with a quoted object key', withButton('', `<button type="button" className={clsx('pu-btn', { 'psa-go': stageIdx > 0 })}>Go</button>`), P9),
    asCase('(also caught in round 1) className={cn(...)} with an unquoted object key', withButton('', '<button type="button" className={cn("pu-btn", { psaGo: stageIdx > 0 })}>Go</button>'), P9),
    asCase('className={ternary of variables}', withButton("const goCls = 'psa-go';", '<button type="button" className={stageIdx ? goCls : "pu-btn"}>Go</button>'), P9),
    asCase('className={clsx(base, variable)}', withButton("const goCls = 'psa-go';", `<button type="button" className={clsx('pu-btn', goCls)}>Go</button>`), P9),
    asCase('className={cn(...)} with a template literal inside', withButton("const tone = 'go';", '<button type="button" className={cn(`psa-${tone}`, stageIdx && "pu-btn")}>Go</button>'), P9),
    asCase('a class map: className={map[kind]}', withButton("const map = { a: 'psa-go', b: 'psa-other' };", '<button type="button" className={map[scenarioKey]}>Go</button>'), P9),
    asCase('a function that returns the class', withButton("const pick = (s) => (s ? 'psa-go' : 'psa-no');", '<button type="button" className={pick(stage)}>Go</button>'), P9),
    asCase('a local component that renders a <button>', withButton('function Btn(p) { return <button type="button" className={p.className}>{p.children}</button>; }', '<Btn className="psa-go">Go</Btn>'), P9),
    asCase('a local arrow component with a styled button name', withButton('const Fancy = (p) => <button type="button" {...p} />;', '<Fancy className="psa-go">Go</Fancy>'), P9),
    asCase('a polymorphic component with as="button"', withButton('', '<Slot as="button" className="psa-go">Go</Slot>'), P9),
    asCase('React.createElement("button", { className })', withButton("const made = React.createElement('button', { className: 'psa-go' }, 'x');", ''), P9),
    asCase('a button reached only by #id', (h) => h.append(PAGE_CSS, `#psa-advance-1 { background: ${INDIGO}; }`), P9),
    asCase('a button reached only by [data-testid]', (h) => h.append(PAGE_CSS, `[data-testid="psa-reset"] { background: ${INDIGO}; }`), P9),
    asCase('a button reached by a structural selector', (h) => h.append(PAGE_CSS, `.psa-row > :nth-child(2) { color: ${INDIGO}; }`), P9),
    asCase('a button reached by :is() with an attribute alternative', (h) => h.append(PAGE_CSS, `:is(.psa-card, [data-x]) { background: ${INDIGO}; }`), P9),
    asCase('a button reached by the universal selector', (h) => h.append(PAGE_CSS, `.psa-actions > * { border-color: ${INDIGO}; }`), P9),
    asCase('a button reached by a bare pseudo-class', (h) => h.append(PAGE_CSS, `:focus-visible { outline-color: ${INDIGO}; }`), P9),
    asCase('a <style> element inside the JSX', (h) => h.replace(PAGE_JSX, RESET, `${RESET}\n                <style>{\`.psa-x-btn { background: ${INDIGO}; }\`}</style>`), P9),
    asCase('a <style dangerouslySetInnerHTML>', (h) => h.replace(PAGE_JSX, RESET, `${RESET}\n                <style dangerouslySetInnerHTML={{ __html: '.psa-x-btn { background: ${INDIGO}; }' }} />`), P9),
    asCase('a styled.button template', withButton('const Go = styled.button`background: #4f46e5;`;', '<Go>Go</Go>'), P9),
    asCase('a styled(Button) template with a violet border', withButton('const Go = styled(Button)`border-color: hsl(calc(250) 80% 50%);`;', ''), P9),
    asCase('an interpolated colour in a styled button (fails closed)', withButton('const Go = styled.button`background: ${(p) => p.tint};`;', '<Go>Go</Go>'), RESOLVABLE),
    asCase('a dynamic import("./x.css") of a violet button', (h) => {
      h.replace(PAGE_JSX, STAGE_ANCHOR, `const later = () => import('./psa-dyn.css');\n${STAGE_ANCHOR}`);
      h.write('src/pages/psa-dyn.css', `.psa-x-btn { background: ${INDIGO}; }\n`);
    }, P9),
    asCase('an scss import the check cannot read', (h) => h.replace(PAGE_JSX, "import './PrivilegeSaasAccessPage.css';", "import './PrivilegeSaasAccessPage.css';\nimport './more.scss';"), /stylesheets readable/),
    asCase(
      'quoted-key inline style (background-color)',
      (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', `<p className="psa-justification" style={{ 'background-color': 'var(--x)' }}>`),
      /H3 no inline colour/,
    ),
    asCase('kebab and camel keys in a style object assigned to a variable', (h) => {
      h.replace(PAGE_JSX, STAGE_ANCHOR, `const tint = { borderColor: 'red' };\n${STAGE_ANCHOR}`);
      h.replace(PAGE_JSX, '<p className="psa-justification">', '<p className="psa-justification" style={tint}>');
    }, /H3 no inline colour/),
    asCase(
      'a computed style key',
      (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', '<p className="psa-justification" style={{ [prop]: "x" }}>'),
      /H3 no inline colour/,
    ),
    asCase('style="..." as a string', (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', '<p className="psa-justification" style="color: red">'), /H3 no inline colour/),
    asCase('el.style.color assigned from a handler', (h) => h.replace(PAGE_JSX, STAGE_ANCHOR, `const paint = (el) => { el.style.color = 'x'; };\n${STAGE_ANCHOR}`), /H3 no inline colour/),
    asCase('el.style.setProperty from a handler', (h) => h.replace(PAGE_JSX, STAGE_ANCHOR, `const paint = (el) => { el.style.setProperty('--x', 'y'); };\n${STAGE_ANCHOR}`), /H3 no inline colour/),
  ];
  it.each(cases)('%s', (_n, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });

  it('a button-free page does not treat #id or [attr] rules as button rules', () => {
    const r = run((h) => {
      h.write(PAGE_JSX, 'export default function P() { return <div className="x">hi</div>; }\n');
      h.append(PAGE_CSS, `#psa-1 { background: ${INDIGO}; }\n[data-x] { border-color: ${INDIGO}; }`);
    });
    // P2/P9 banner and primary fail on this stub, but the P9 colour rule must not.
    expect(r.out).not.toMatch(/P9 no violet.*psa-1/);
    expect(r.out).toMatch(/DRIFT\s+\[ENFORCED\]/);
  });
});

describe('check-ui-patterns round 2: font floor gaps (skeptic 6)', () => {
  const tiny = (decl) => (h) => h.append(PAGE_CSS, `.psa-t { ${decl} }`);
  const small = [
    ['font-size in vw (2vw = 7.5px on a phone)', 'font-size: 2vw;'],
    ['font-size in vh', 'font-size: 1vh;'],
    ['font-size in vmin', 'font-size: 1vmin;'],
    ['calc(1vw + 2px)', 'font-size: calc(1vw + 2px);'],
    ['max(4px, 1vw): the floor is 4px', 'font-size: max(4px, 1vw);'],
    ['(also caught in round 1) min(2vw, 9px)', 'font-size: min(2vw, 9px);'],
    ['the font shorthand in vmin', 'font: 1vmin serif;'],
    ['font-size in vmax', 'font-size: 1vmax;'],
    ['font-size in dvw (dynamic viewport)', 'font-size: 2dvw;'],
    ['unitless zero', 'font-size: 0;'],
    ['(also caught in round 1) zero with a unit', 'font-size: 0px;'],
    ['(also caught in round 1) min(9px, 2rem)', 'font-size: min(9px, 2rem);'],
    ['(also caught in round 1) min() with an unknown on the other side', 'font-size: min(9px, var(--fluid, 3rem));'],
    ['calc(2vw + 1px) (8.5px on a phone)', 'font-size: calc(2vw + 1px);'],
    ['(also caught in round 1) calc(100% * 0.5)', 'font-size: calc(100% * 0.5);'],
    ['(also caught in round 1) clamp(6px, 2vw, 12px) (7.5px on a phone)', 'font-size: clamp(6px, 2vw, 12px);'],
    ['(also caught in round 1) percent: 50%', 'font-size: 50%;'],
    ['(also caught in round 1) the font shorthand in vw', 'font: 700 2vw/1.2 sans-serif;'],
    ['(also caught in round 1) font shorthand with a calc size', 'font: calc(0.5rem + 1px) serif;'],
    ['(also caught in round 1) uppercase unit and property (FONT-SIZE: 9PX)', 'FONT-SIZE: 9PX;'],
    ['a font-size set through a CSS escape', 'f\\6fnt-size: 9px;'],
    ['(also caught in round 1) a size from a custom property chain', ':root { --a: var(--b); --b: 4pt; } .psa-t2 { font-size: var(--a); }'],
  ];
  it.each(small)('%s', (_n, decl) => {
    const r = run(decl.includes('{') ? (h) => h.append(PAGE_CSS, decl) : tiny(decl));
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, FLOOR);
  });

  const unknown = [
    ['container-query units (1cqw)', 'font-size: 1cqw;'],
    ['line-height units (1lh)', 'font-size: 1lh;'],
    ['a var() defined nowhere', 'font-size: var(--never-defined-size);'],
    ['max() whose floor is an unknown (max(var(--x), 4px))', 'font-size: max(var(--never-defined-size), 4px);'],
    ['calc() with an unknown unit', 'font-size: calc(1rem * 0.5 + 2cap);'],
    ['a font shorthand with an unknown unit', 'font: 700 2cqw sans-serif;'],
  ];
  it.each(unknown)('unknown size fails: %s', (_n, decl) => {
    const r = run(tiny(decl));
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, /H2 (font sizes resolvable|10px font floor)/);
  });

  it('sizes that clear the floor at every judged viewport stay clean', () => {
    const r = run(
      tiny(
        'font-size: calc(1rem + 0.5vw); font-size: clamp(0.75rem, 1vw, 1rem); font-size: max(var(--never-defined-size), 12px); font-size: smaller; font-size: inherit; font-size: 10px; font: 700 4vw/1.2 serif; font-size: min(12px, 3rem); font-size: 125%; font: caption;',
      ),
    );
    expect(r.status, r.out).toBe(0);
  });

  it('an escape comment lets an unknown size through but not a small one', () => {
    const ok2 = run(tiny('/* ui-pattern: allow container-relative size reviewed in the browser */ font-size: 1cqw;'));
    expect(ok2.status, ok2.out).toBe(0);
    const bad = run(tiny('/* ui-pattern: allow reviewed in the browser by the owner */ font-size: 9px;'));
    expect(bad.status, bad.out).toBe(1);
  });
});

describe('check-ui-patterns round 2: nothing regresses', () => {
  it('Ping red, near-black ink, a violet card edge and every safe keyword stay clean in one stylesheet', () => {
    const r = run((h) =>
      h.append(
        PAGE_CSS,
        `.psa-x-btn { color: hsl(250 20% 8%); background: color(srgb 0.82 0.05 0.06); border-color: oklch(0.55 0.22 27); outline: 2px solid var(--btn-accent); }
         .psa-x-card { border-top-color: hsl(250 80% 50%); background: attr(data-x type(<color>)); }
         @MEDIA (max-width: 400px) { .psa-x-btn { font-size: 0.75rem; } }
         @keyframes psa-fade { from { opacity: 0 } to { opacity: 1 } }`,
      ),
    );
    expect(r.status, r.out).toBe(0);
  });
});

describe('check-ui-patterns round 2: more of our own', () => {
  const cases = [
    asCase('the 62.5% root trick makes 0.9rem 9px', (h) => h.append(PAGE_CSS, 'html { font-size: 62.5%; }\n.psa-t { font-size: 0.9rem; }'), FLOOR),
    asCase('a root font size that cannot be resolved makes rem sizes unknown', (h) => h.append(PAGE_CSS, ':root { font-size: var(--never-defined-root); }\n.psa-t { font-size: 1rem; }'), SIZES),
    asCase('a value written with a CSS escape (\\69 ndigo)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: \\69 ndigo; }'), P9),
    asCase('a function name written with an escape', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: r\\67 b(79 70 229); }'), P9),
    asCase('a size written with an escape (9\\70 x)', (h) => h.append(PAGE_CSS, '.psa-t { font-size: 9\\70 x; }'), FLOOR),
    asCase(
      'a CSS-modules class (styles.go) on a button',
      (h) => {
        h.replace(PAGE_JSX, "import './PrivilegeSaasAccessPage.css';", "import './PrivilegeSaasAccessPage.css';\nimport styles from './psa.module.css';");
        h.replace(PAGE_JSX, RESET, `${RESET}\n                <button type="button" className={styles.go}>Go</button>`);
        h.write('src/pages/psa.module.css', `.go { background: ${INDIGO}; }\n`);
      },
      P9,
    ),
    asCase('a button class passed through a custom prop (btnClass="psa-go")', withButton('', '<Toolbar btnClass="psa-go" />'), P9),
    asCase('a button class passed as buttonClassName to PrivilegeLiveCheck from a variable', withButton("const live = 'psa-go';", '<PrivilegeLiveCheck buttonClassName={live} />'), P9),
    asCase('(also caught in round 1) a violet button rule inside a nested @media inside a rule', (h) => h.append(PAGE_CSS, `.psa-card { @media (min-width: 1px) { .psa-x-btn { background: ${INDIGO}; } } }\n`), P9),
    asCase('a button rule inside a createGlobalStyle template', withButton('const G = createGlobalStyle`.psa-x-btn { background: #4f46e5; }`;', ''), P9),
    asCase('(also caught in round 1) a hex colour with an alpha channel (#4f46e5cc)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: #4f46e5cc; }'), P9),
    asCase('(also caught in round 1) a 4-digit hex colour (#44ff)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: #44ff; }'), P9),
    asCase('(also caught in round 1) upper-case function and keyword (RGB(79 70 229), INDIGO)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: RGB(79 70 229); border-color: INDIGO; }'), P9),
    asCase('(also caught in round 1) violet in a -webkit-gradient', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: -webkit-gradient(linear, left top, right top, from(#4f46e5), to(#fff)); }'), P9),
    asCase('a class name built by string concatenation (\'psa-\' + \'go\')', withButton('', `<button type="button" className={'psa-' + 'go'}>Go</button>`), P9),
    asCase('a class name built from a variable by concatenation', withButton("const tail = 'go';", `<button type="button" className={'psa-' + tail}>Go</button>`), P9),
    asCase('an IE-hack property prefix (*background)', (h) => h.append(PAGE_CSS, '.psa-x-btn { *background: #4f46e5; }'), P9),
    asCase('a vendor-prefixed shadow (-webkit-box-shadow)', (h) => h.append(PAGE_CSS, '.psa-x-btn { -webkit-box-shadow: 0 0 0 2px #4f46e5; }'), P9),
    asCase('(also caught in round 1) a block that is never closed still applies', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: #4f46e5'), P9),
    asCase('(also caught in round 1) hsl() with a turn hue (0.69turn)', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: hsl(0.69turn 80% 50%); }'), P9),
    asCase('lab() relative colour with calc on b', (h) => h.append(PAGE_CSS, '.psa-x-btn { background: lab(from red l a calc(b - 200)); }'), P9),
    asCase('--font-size-3xs defined with calc() below the floor in page CSS', (h) => h.append(PAGE_CSS, ':root { --font-size-3xs: calc(0.5rem + 1px); }'), SCALE),
  ];
  it.each(cases)('%s', (_n, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });
});

describe('check-ui-patterns: a route behind a routes/ wrapper resolves to the real page', () => {
  const WRAP_APP = `import lazyWithRetry from "./utils/lazyWithRetry";
import { SaasRoute } from "./routes/PublicRoutes";
import SignInRequired from "./routes/SignInRequired";
const routes = <Route path="/privilege-saas-access" element={loading ? null : user ? (<SaasRoute user={user} />) : (<SignInRequired />)} />;
`;
  const PUBLIC = `import lazyWithRetry from "../utils/lazyWithRetry";
import AppShell from "./AppShell";
const PrivilegeSaasAccessPage = lazyWithRetry(() => import("../pages/PrivilegeSaasAccessPage"));
export function SaasRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PrivilegeSaasAccessPage />
    </AppShell>
  );
}
`;
  const wrapped = (h) => {
    h.write('src/App.js', WRAP_APP);
    h.write('src/routes/PublicRoutes.js', PUBLIC);
    h.write('src/routes/SignInRequired.js', 'export default function SignInRequired() { return null; }\n');
  };

  it('the wrapped, allowlisted page is found and checked (exit 0, no "no <Route>" error)', () => {
    const r = run(wrapped);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/\[ENFORCED\] \/privilege-saas-access\s+\(src\/pages\/PrivilegeSaasAccessPage\.jsx\)/);
    expect(r.out).not.toMatch(/ALLOWLIST/);
  });

  it('a violation in the wrapped page fails the run (before the fix the gate file SignInRequired.js was checked instead)', () => {
    const r = run((h) => {
      wrapped(h);
      h.replace(PAGE_JSX, 'data-testid="psa-reset">Reset</button>', 'data-testid="psa-reset" style={{ background: "#4f46e5" }}>Reset</button>');
    });
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, /H3/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3: nine violations a 28-case battery got past the round-2 script. Each exits 0 on the round-2 script
// (run with UI_PATTERN_SCRIPT=<that script> to see it) and 1 on this one. The page keeps exactly one primary
// button, so a red case is caused by the mutation and not by a second primary the old script already counted.
// ---------------------------------------------------------------------------------------------------------------

const PRIMARY = 'className="pu-btn pu-btn--primary"';
const SECONDARY_RESET = 'className="pu-btn" onClick={reset}';
const BANNER_BLOCK = /<SimBanner data-testid="psa-banner">[\s\S]*?<\/SimBanner>/;

describe('check-ui-patterns: round 3 (a skeptic battery, 9 of 28 passed)', () => {
  const cases = [
    [
      'a primary button rendered by .map() (repeats per item, so more than one primary)',
      (h) => {
        h.replace(PAGE_JSX, PRIMARY, 'className="pu-btn"');
        h.replace(PAGE_JSX, RESET, `${RESET}\n                {[1, 2, 3].map((n) => <button key={n} type="button" className="pu-btn pu-btn--primary">Go {n}</button>)}`);
      },
      /P9 one primary button/,
    ],
    ['a StatusChip whose only child is {icon} (a glyph, no words)', (h) => h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">{icon}</StatusChip>'), /P7 chips carry text/],
    [
      'a chip whose child is a variable that is only ever the empty string',
      (h) => {
        h.replace(PAGE_JSX, STAGE_ANCHOR, `const blankLabel = '';\n${STAGE_ANCHOR}`);
        h.replace(PAGE_JSX, '<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info">{blankLabel}</StatusChip>');
      },
      /P7 chips carry text/,
    ],
    [
      "an inline style set from script, el.setAttribute('style', ...)",
      (h) => h.replace(PAGE_JSX, '<p className="psa-justification">', `<p className="psa-justification" ref={(el) => el && el.setAttribute('style', 'font-size: 9px')}>`),
      /H3 no inline colour/,
    ],
    ['a button whose style spreads a value the check cannot read, style={{ ...tint }}', (h) => h.replace(PAGE_JSX, RESET, `${RESET}\n                <button type="button" className="pu-btn" style={{ ...tint }}>Tinted</button>`), /H3 no inline colour/],
    ['an empty <SimBanner>', (h) => h.edit(PAGE_JSX, (src) => src.replace(BANNER_BLOCK, '<SimBanner data-testid="psa-banner"></SimBanner>')), /P2 banner first/],
    [
      'the banner under a plain <div> root instead of <PingPage>',
      (h) => h.edit(PAGE_JSX, (src) => src.replace('<PingPage className="psa-page">', '<div className="psa-page">').replace('</PingPage>\n  );', '</div>\n  );')),
      /P2 content inside PingPage/,
    ],
    [
      'a button beside <PingPage>, outside it',
      (h) =>
        h.edit(PAGE_JSX, (src) =>
          src.replace('<PingPage className="psa-page">', '<div><PingPage className="psa-page">').replace('</PingPage>\n  );', '</PingPage><button type="button" className="pu-btn">Stray</button></div>\n  );'),
        ),
      /P2 content inside PingPage/,
    ],
    ['a Tailwind-style violet utility class on a button (bg-indigo-600)', (h) => h.replace(PAGE_JSX, SECONDARY_RESET, 'className="pu-btn bg-indigo-600" onClick={reset}'), /P9 no violet/],
  ];
  it.each(cases)('%s', (_name, mutate, rule) => {
    const r = run(mutate);
    expect(r.status, r.out).toBe(1);
    expectDrift(r.out, rule);
  });

  it('stays clean: a conditional primary in a loop (the selected tab), a secondary in a loop, a button returned by a helper outside the root', () => {
    const r = run((h) => {
      h.append(PAGE_JSX, 'function renderSpare() {\n  return (\n    <div className="psa-spare"><button type="button" className="pu-btn">Spare</button></div>\n  );\n}');
      h.replace(
        PAGE_JSX,
        RESET,
        `${RESET}\n                {[1, 2].map((n) => <button key={n} type="button" className={n === 1 ? 'pu-btn pu-btn--primary' : 'pu-btn'}>Tab {n}</button>)}\n                {[1, 2].map((n) => <button key={n} type="button" className="pu-btn">Row {n}</button>)}`,
      );
      h.replace(PAGE_JSX, PRIMARY, 'className="pu-btn"');
    });
    expect(r.status, r.out).toBe(0);
  });
});
