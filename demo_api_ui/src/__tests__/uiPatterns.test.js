import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script shared with CI (npm run check:ui-patterns)
import { checkPage, runAll, loadRoutes, loadAllowlist, readPage, isVioletIndigo, violetLiterals } from '../../scripts/check-ui-patterns.mjs';

/**
 * Ping UI Standard ratchet: every route listed in scripts/ui-pattern-converted.txt must keep passing
 * the static pattern check (banner first, one primary button, chips carry text, no inline colour,
 * no violet/indigo or vertical colour on buttons, 10px floor). All other pages are advisory.
 * The mutation cases prove each rule can fail, so a green run is not vacuous.
 */
const drifted = (results) => results.filter((r) => r.status === 'DRIFT').map((r) => r.rule);

const saasFile = loadRoutes()['/privilege-saas-access'];
const saas = readPage(saasFile);
const cssWith = (extra) => [{ file: 'x.css', css: `${saas.css[0].css}\n${extra}` }];

describe('ui pattern check', () => {
  it('every allowlisted route resolves to a page and passes all rules', () => {
    const allowlist = loadAllowlist();
    expect(allowlist.length).toBeGreaterThan(0);
    const { pages, missing } = runAll({ allowlist });
    expect(missing, 'allowlisted routes with no <Route> in App.js').toEqual([]);
    const failing = pages.filter((p) => p.enforced && p.failed.length);
    const msg = failing.map((p) => `${p.routes.join(',')} ${p.failed.map((f) => `${f.rule}: ${f.detail}`).join(' | ')}`).join('\n');
    expect(failing.length, `enforced pages drifted:\n${msg}`).toBe(0);
  });

  it('starts with the SaaS Access page and nothing else is enforced silently', () => {
    expect(loadAllowlist()).toContain('/privilege-saas-access');
    expect(Object.keys(loadRoutes()).length).toBeGreaterThan(50);
  });

  it('the converted page passes as published', () => {
    expect(drifted(checkPage(saas))).toEqual([]);
  });

  it('fails when a second primary button appears', () => {
    const jsx = saas.jsx.replace('className="pu-btn" onClick={reset}', 'className="pu-btn pu-btn--primary" onClick={reset}');
    expect(jsx).not.toBe(saas.jsx);
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('counts the live-check default trigger (btn-primary) as a primary', () => {
    const jsx = saas.jsx.replace('buttonClassName="pu-btn"', '');
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('fails on a chip with no text, whether StatusChip or a chip class', () => {
    const a = saas.jsx.replace('<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info" />');
    expect(drifted(checkPage({ jsx: a, css: saas.css }))).toEqual(['P7 chips carry text']);
    const b = saas.jsx.replace(
      '<StatusChip tone="info">Live call</StatusChip>',
      '<span className="pu-chip pu-chip--info"><span className="pu-chip__dot" aria-hidden="true" /></span>',
    );
    expect(drifted(checkPage({ jsx: b, css: saas.css }))).toEqual(['P7 chips carry text']);
  });

  it('fails on an indigo/violet button literal and on a vertical colour token on a button', () => {
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: #4f46e5; }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: var(--app-primary-red); }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    // A non-button rule may still use a vertical colour (card edges do).
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-x-card { border-top-color: var(--app-primary-red); }') }))).toEqual([]);
  });

  it('fails on inline colour, a font under 10px, and a banner that is not first', () => {
    const inline = saas.jsx.replace('<p className="psa-justification">', '<p className="psa-justification" style={{ color: "#333" }}>');
    expect(drifted(checkPage({ jsx: inline, css: saas.css }))).toEqual(['H3 no inline colour']);
    expect(drifted(checkPage({ jsx: saas.jsx, css: cssWith('.psa-tiny { font-size: 9px; }') }))).toEqual(['H2 10px font floor']);
    const noBanner = saas.jsx.replace(/<SimBanner[\s\S]*?<\/SimBanner>/, '');
    expect(drifted(checkPage({ jsx: noBanner, css: saas.css }))).toEqual(['P2 banner first']);
  });

  it('ignores commented-out violations', () => {
    const jsx = `${saas.jsx}\n// <button className="pu-btn--primary">x</button>\n/* style={{ color: '#fff' }} */`;
    expect(drifted(checkPage({ jsx, css: saas.css }))).toEqual([]);
  });

  it('classifies violet and indigo but not Ping blue, red or green', () => {
    expect(isVioletIndigo([0x4f, 0x46, 0xe5])).toBe(true);
    expect(isVioletIndigo([0x6d, 0x28, 0xd9])).toBe(true);
    expect(isVioletIndigo([0x12, 0x53, 0x8d])).toBe(false);
    expect(isVioletIndigo([0xd2, 0x0e, 0x0f])).toBe(false);
    expect(violetLiterals('linear-gradient(90deg, #d20e0f 55%, #aa0005)')).toEqual([]);
  });

  it('the shared stylesheet is imported once, from the entry', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '..', 'index.jsx'), 'utf8');
    expect(entry.match(/styles\/ping-ui\.css/g)).toHaveLength(1);
  });
});
