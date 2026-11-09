import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const block = (css, selector) => {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
};
// The text of the last `@media (max-width: 600px)` block that contains `needle`.
const phoneBlock = (css, needle) => {
  const parts = css.split('@media (max-width: 600px)').slice(1);
  return parts.find((p) => p.includes(needle)) || '';
};

// jsdom does no layout, so these read the CSS text. tests/e2e/mobile-layout.spec.js measures the same things in a
// real 375px browser; this file keeps the rules from being deleted in a run that has no browser.
describe('phone-width layout rules (CSS text)', () => {
  const ping = read('styles/ping-ui.css');

  it('.pu-chip wraps inside its column instead of running off the screen', () => {
    const chip = block(ping, '\n.pu-chip {');
    expect(chip).toMatch(/max-width:\s*100%/);
    expect(chip).toMatch(/white-space:\s*normal/);
    expect(chip).not.toMatch(/white-space:\s*nowrap/);
  });

  it('every text-bearing .pu-* class breaks long words, scoped under .pu-page so the end-user-nano skin cannot beat it', () => {
    const rule = ping.slice(ping.indexOf('.pu-page .pu-banner,'));
    const head = rule.slice(0, rule.indexOf('}') + 1);
    for (const sel of ['.pu-kicker', '.pu-h2', '.pu-h3', '.pu-lede', '.pu-note', '.pu-label', '.pu-chip', '.pu-btn', '.plc__hint', '.pu-kv dt', '.pu-kv dd']) {
      expect(head, sel).toContain(`.pu-page ${sel}`);
    }
    expect(head).toMatch(/overflow-wrap:\s*anywhere/);
    expect(head).toMatch(/min-width:\s*0/);
  });

  it('flex and grid children of the shared primitives can shrink', () => {
    const rule = block(ping, '.pu-status-line > *,');
    expect(rule).toContain('.pu-actions > *');
    expect(rule).toContain('.pu-card-grid > *');
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('holds the banner to three lines on a phone, on a line boundary', () => {
    const phone = phoneBlock(ping, '.pu-banner.pu-banner--clamp');
    expect(phone).toMatch(/\.pu-banner\.pu-banner--clamp\s*\{[^}]*max-height:\s*calc\(var\(--pu-banner-lh\) \* 3em/);
    expect(phone).toMatch(/overflow:\s*hidden/);
    // Not clamped above the phone breakpoint: the only clamp rule is inside the media block.
    expect(ping.replace(phone, '')).not.toMatch(/pu-banner--clamp\s*\{/);
  });

  it('personal-agent client cards use a fluid column floor', () => {
    const css = read('components/learning/PersonalAgentClientCards.css');
    expect(css).toContain('minmax(min(100%, 300px), 1fr)');
    expect(css).not.toMatch(/minmax\(300px,/);
  });

  it('the token chain rail wraps its header, toolbar and tabs', () => {
    const css = read('components/TokenChainTraceRail.css');
    for (const sel of ['.tctr-head {', '.tctr-toolbar {', '.tctr-chain-tabs {']) {
      expect(block(css, sel), sel).toMatch(/flex-wrap:\s*wrap/);
    }
    expect(block(css, '.tctr-chain-tabs {')).toMatch(/max-width:\s*100%/);
  });

  it('the shared diagram bars and the embedded diagram grid cannot be wider than their column', () => {
    expect(read('components/EmbeddedFlowDiagram.css')).toMatch(/\.efd \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(read('components/DiagramStepBar.css')).toMatch(/\.dstep-bar \{[^}]*min-width:\s*0/);
    expect(read('components/diagram/StepTimeSelector.css')).toMatch(/\.dc-steptime \{[^}]*flex-wrap:\s*wrap/);
    expect(read('components/diagram/DiagramControls.css')).toMatch(/\.dc-toolbar \{[^}]*max-width:\s*100%/);
    expect(read('components/shared/PageAgentModeToggle.css')).toMatch(/\.page-agent-mode \{[^}]*flex-wrap:\s*wrap/);
  });
});

describe('TopNav at <= 600px', () => {
  const css = read('components/TopNav.css');
  const phone = phoneBlock(css, '.topnav-menu-toggle');

  it('is not sticky, and folds everything but the brand behind a Menu button', () => {
    expect(phone).toMatch(/\.topnav\s*\{[^}]*position:\s*static/);
    expect(phone).toMatch(/\.topnav-menu\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/\.topnav--menu-open \.topnav-menu\s*\{[^}]*display:\s*flex/);
    expect(phone).toMatch(/\.topnav-menu-toggle\s*\{[^}]*display:\s*inline-flex/);
    expect(phone).toMatch(/min-height:\s*44px/);
  });

  it('above the breakpoint the wrapper is display: contents and the Menu button is hidden', () => {
    expect(block(css, '\n.topnav-menu {')).toMatch(/display:\s*contents/);
    expect(block(css, '\n.topnav-menu-toggle {')).toMatch(/display:\s*none/);
  });

  it('the desktop bar stays sticky', () => {
    expect(block(css, '\n.topnav {')).toMatch(/position:\s*sticky/);
  });
});

describe('the in-shell sign-in gates', () => {
  const app = read('App.js');
  it.each(['/agent-builder', '/secret-rotation'])('%s renders SignInPrompt, not a second TopNav, for a signed-out visitor', (path) => {
    const i = app.indexOf(`path="${path}"`);
    const route = app.slice(i, app.indexOf('<Route', i + 10));
    expect(route).toContain('<SignInPrompt');
    expect(route).not.toContain('<SignInRequired');
  });
});

describe('StaticFlowDiagram on a narrow pane', () => {
  it('floors the fit at a zoom that keeps the 13px node label at 10px or more', () => {
    const src = read('components/StaticFlowDiagram.jsx');
    const m = src.match(/const READABLE = \{ narrowBelow: (\d+), minZoom: ([\d.]+) \}/);
    expect(m, 'READABLE constant').toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(600);
    expect(13 * Number(m[2])).toBeGreaterThanOrEqual(10);
    expect(src).toContain('useFitOnResize(ref, fit, READABLE)');
  });
});
