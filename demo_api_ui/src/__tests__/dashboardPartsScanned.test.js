import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sharedFiles, SHARED_FILES } from '../../scripts/check-ui-patterns.mjs';

/**
 * UserDashboardPing2026.js holds the /dashboard frame only; the clinical split, the overlays, the banking body, the
 * step-up toast and the small button/card parts live in Dashboard*.jsx. The page scan does not follow imports, so these
 * files are in the check's shared set. This file proves that (1) they are in it, (2) a colour literal injected into one is
 * flagged, and (3) the page's stylesheet rules for the buttons in them are judged: restoring the old resize-handle colours
 * in UserDashboard.css fails the enforced /dashboard, which it did not while the page file had no button.
 * It runs the real script on a throwaway copy of just these files, like uiPatternsMutation.test.js.
 */
const UI = path.resolve(__dirname, '..', '..');
const PARTS = [
  'DashboardBankingMain.jsx',
  'DashboardClinicalSplit.jsx',
  'DashboardFrameParts.jsx',
  'DashboardGlobalModals.jsx',
  'DashboardStepUpToast.jsx',
  'DashboardTracePanels.jsx',
].map((f) => `src/components/${f}`);
const PAGE = 'src/components/UserDashboardPing2026.js';
const COPY = [
  'src/index.css',
  'src/styles/ping-ui.css',
  'src/components/pingUi/index.jsx',
  'src/components/privilege/PrivilegeLiveCheck.jsx',
  'src/components/privilege/PrivilegeLiveCheck.css',
  PAGE,
  'src/components/UserDashboard.css',
  'src/components/customerSkinPing2026.css',
  'src/components/UserDashboardPing2026.pingUi.css',
  'src/components/DashboardStepUpToast.css',
  ...PARTS,
];
const APP = `const UserDashboardPing2026 = lazyWithRetry(() => import("./components/UserDashboardPing2026"));
const routes = <Route path="/dashboard" element={<UserDashboardPing2026 />} />;
`;

let base;
function build(mutate) {
  const root = fs.mkdtempSync(path.join(base, 'case-'));
  for (const rel of COPY) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(UI, rel), path.join(root, rel));
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(UI, 'scripts/check-ui-patterns.mjs'), path.join(root, 'scripts/check-ui-patterns.mjs'));
  fs.writeFileSync(path.join(root, 'src/App.js'), APP);
  fs.writeFileSync(path.join(root, 'scripts/ui-pattern-converted.txt'), '/dashboard\n');
  const file = (rel) => path.join(root, rel);
  if (mutate) {
    mutate({
      replace: (rel, from, to) => {
        const src = fs.readFileSync(file(rel), 'utf8');
        if (!src.includes(from)) throw new Error(`mutation anchor not found in ${rel}: ${from}`);
        fs.writeFileSync(file(rel), src.replace(from, to));
      },
      append: (rel, text) => fs.appendFileSync(file(rel), `\n${text}\n`),
    });
  }
  const r = spawnSync(process.execPath, [file('scripts/check-ui-patterns.mjs')], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  if (!/\d+ routed pages/.test(out)) throw new Error(`the check did not run (exit ${r.status}):\n${out}`);
  return { status: r.status, out };
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dashboard-parts-scanned-'));
});
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('the Dashboard parts are scanned', () => {
  it('SHARED_FILES lists all six parts and the shared scan reads them', () => {
    for (const rel of PARTS) expect(SHARED_FILES, rel).toContain(rel);
    const present = sharedFiles().present.map((f) => f.rel);
    for (const rel of PARTS) expect(present, rel).toContain(rel);
  });

  it('the page file itself still holds no button, no primary and no inline colour (frame only)', () => {
    const page = fs.readFileSync(path.join(UI, PAGE), 'utf8');
    expect(page).not.toMatch(/<button\b/);
    expect(page).not.toMatch(/btn-primary|pu-btn--primary/);
  });

  it('the clean copy passes with /dashboard enforced and the parts listed as shared', () => {
    const r = build();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/PASS\s+\[ENFORCED\] \/dashboard/);
    expect(r.out).toMatch(/\[SHARED, always enforced\].*DashboardBankingMain\.jsx.*DashboardGlobalModals\.jsx/);
  });

  it('P9 one primary is vacuous for the page ("no buttons on this page"): the check says so', () => {
    const r = build();
    expect(r.out).toMatch(/INFO\s+P9 one primary button - no buttons on this page/);
  });

  it('a hex colour literal injected into a part is flagged (inline style)', () => {
    const r = build((h) => h.replace('src/components/DashboardBankingMain.jsx', 'className="udp-link-btn"', 'className="udp-link-btn" style={{ color: "#6b7280" }}'));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/DRIFT shared: H3 no inline colour/);
  });

  it('a hex colour literal injected into the toast part is flagged too', () => {
    const r = build((h) => h.replace('src/components/DashboardStepUpToast.jsx', 'className="dashboard-toast-error__challenge"', 'className="dashboard-toast-error__challenge" style={{ background: "#fff1f2" }}'));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/DRIFT shared: H3 no inline colour/);
  });

  it('restoring the old resize-handle colour (a vertical token on a button) in UserDashboard.css fails /dashboard', () => {
    const r = build((h) => h.replace('src/components/UserDashboard.css', 'border-top: 2px solid var(--control-border);', 'border-top: 2px solid var(--brand-medium-gray);'));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/DRIFT\s+P9 no violet\/indigo or vertical colour on buttons.*\.ud-middle-resize-handle/);
  });

  it('a vertical token on a button rule the parts use (.transfer-btn) fails /dashboard', () => {
    const r = build((h) => h.append('src/components/UserDashboard.css', '.transfer-btn { background: var(--app-primary-red); }'));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/DRIFT\s+P9 no violet\/indigo or vertical colour on buttons.*\.transfer-btn/);
  });
});
