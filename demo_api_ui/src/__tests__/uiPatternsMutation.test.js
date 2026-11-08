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
const COPY = [
  'scripts/check-ui-patterns.mjs',
  'src/index.css',
  'src/styles/ping-ui.css',
  'src/components/pingUi/index.jsx',
  'src/components/privilege/PrivilegeLiveCheck.jsx',
  'src/components/privilege/PrivilegeLiveCheck.css',
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
    expect(r.out).toMatch(rule);
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
    expect(r.out).toMatch(rule);
  });

  it('a missing shared file cannot silently drop coverage', () => {
    const root = build();
    fs.rmSync(path.join(root, 'src/components/privilege/PrivilegeLiveCheck.css'));
    const r = exec(root);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/shared files present/);
  });

  it('the shared set fails CI even when the page allowlist is empty', () => {
    const root = build((h) => h.append(SHARED_CSS, `.pu-btn { background: ${INDIGO}; }`));
    fs.writeFileSync(path.join(root, 'scripts/ui-pattern-converted.txt'), '# none\n');
    const r = exec(root);
    expect(r.status, r.out).toBe(1);
  });
});
