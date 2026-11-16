import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script shared with CI (npm run check:ui-patterns)
import { checkPage, runAll, readPage, loadRoutes, loadGlobalTokens, J1_ENFORCED } from '../../scripts/check-ui-patterns.mjs';

/**
 * Rule J1 of scripts/check-ui-patterns.mjs: a JSON pane is the shared JsonPane, not a hand-rolled
 * <pre>{JSON.stringify(x, null, N)}</pre>, and a JSON/pre/code-named selector never caps its height or scrolls.
 * J1 is ADVISORY today (J1_ENFORCED = false): it reports ADVISORY and must never fail check:ui-patterns, on an
 * enforced page or any other. These cases prove the rule detects, that it stays advisory, and that flipping the
 * constant is what would make it fail (phase 3 of the JSON-pane plan).
 */
const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'check-ui-patterns.mjs');
const tokens = loadGlobalTokens();
const saas = readPage(loadRoutes()['/privilege-saas-access']);
const J1 = 'J1 JSON panes use the shared JsonPane';
const j1 = (page) => checkPage({ tokens, ...page }).find((r) => r.rule === J1);
const withJsx = (extra) => ({ jsx: saas.jsx.replace('</PingPage>', `${extra}</PingPage>`), css: saas.css });
const withCss = (extra) => ({ jsx: saas.jsx, css: [...saas.css, { file: 'x.css', css: extra }] });

describe('J1 JSON panes (advisory)', () => {
  it('is advisory: J1_ENFORCED is false', () => {
    expect(J1_ENFORCED).toBe(false);
  });

  it('passes the converted page as published', () => {
    expect(saas.jsx).toContain('</PingPage>');
    expect(j1(saas).status).toBe('PASS');
  });

  it.each([
    ['a pretty stringify in a <pre>', '<pre>{JSON.stringify(data, null, 2)}</pre>'],
    ['with attributes and a nested call', '<pre className="x" tabIndex={0}>{JSON.stringify(build(a, b), null, 4)}</pre>'],
    ['with a string indent', '<pre>{JSON.stringify(data, null, "  ")}</pre>'],
  ])('reports %s as ADVISORY, not DRIFT', (_n, jsx) => {
    const r = j1(withJsx(jsx));
    expect(r.status).toBe('ADVISORY');
    expect(r.detail).toMatch(/hand-rolled <pre/);
    expect(checkPage({ tokens, ...withJsx(jsx) }).filter((x) => x.status === 'DRIFT')).toEqual([]);
  });

  it.each([
    ['a compact stringify', '<pre>{JSON.stringify(data)}</pre>'],
    ['a <pre> of plain text', '<pre>{text}</pre>'],
    ['a stringify outside a <pre>', '<p>{JSON.stringify(data, null, 2)}</p>'],
    ['the shared pane', '<JsonPane value={data} />'],
  ])('does not report %s', (_n, jsx) => {
    expect(j1(withJsx(jsx)).status).toBe('PASS');
  });

  it.each([
    ['max-height on a json selector', '.audit-json { max-height: 300px; }'],
    ['overflow auto on a pre selector', '.audit-details-pre { overflow: auto; }'],
    ['overflow-y scroll on a code selector', '.tctr-code { overflow-y: scroll; }'],
    ['overflow-x auto in a media block', '@media (max-width: 600px) { .insp-json { overflow-x: auto; } }'],
  ])('reports %s as ADVISORY', (_n, css) => {
    const r = j1(withCss(css));
    expect(r.status).toBe('ADVISORY');
    expect(r.detail).toMatch(/finding\(s\)/);
  });

  it.each([
    ['a cap on a non-JSON selector', '.psa-card { max-height: 300px; overflow: auto; }'],
    ['max-height: none on a json selector', '.audit-json { max-height: none; overflow: visible; }'],
    ['overflow hidden on a json selector', '.audit-json { overflow: hidden; }'],
    ['a selector that only contains the letters pre', '.preview-panel { overflow: auto; }'],
  ])('does not report %s', (_n, css) => {
    expect(j1(withCss(css)).status).toBe('PASS');
  });

  it('never fails the real run: every J1 row in every routed page and the exit status stay non-failing', () => {
    const { pages, shared } = runAll();
    const rows = pages.flatMap((p) => p.results.filter((r) => r.rule === J1));
    expect(rows.length).toBe(pages.length);
    expect(rows.every((r) => r.status === 'PASS' || r.status === 'ADVISORY')).toBe(true);
    expect(pages.some((p) => p.failed.some((f) => f.rule === J1))).toBe(false);
    expect(shared.failed.some((f) => f.rule.includes('J1'))).toBe(false);
  });

  it('would fail, as DRIFT, if J1_ENFORCED were flipped (a throwaway copy of the script, run in a child process)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j1-enforced-'));
    try {
      const src = fs.readFileSync(SCRIPT, 'utf8');
      expect(src).toContain('export const J1_ENFORCED = false;');
      const copy = path.join(dir, 'check-ui-patterns.mjs');
      const probe = (script) => {
        fs.writeFileSync(copy, script);
        const code =
          `import { checkPage } from ${JSON.stringify(pathToFileURL(copy).href)};` +
          `const jsx = '<pre>{JSON.stringify(data, null, 2)}</pre>';` +
          `console.log(checkPage({ jsx }).find((r) => r.rule === ${JSON.stringify(J1)}).status);`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
        return r.stdout.trim();
      };
      expect(probe(src)).toBe('ADVISORY');
      expect(probe(src.replace('export const J1_ENFORCED = false;', 'export const J1_ENFORCED = true;'))).toBe('DRIFT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check:ui-patterns CLI', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: path.resolve(__dirname, '..', '..') });

  it('exits 0 and reports J1 as advisory', () => {
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/\d+ page\(s\) with J1 advisory findings \(JSON panes; advisory, not a failure\)/);
    expect(r.stdout).toMatch(/ADVISORY J1 JSON panes use the shared JsonPane/);
  });
});
