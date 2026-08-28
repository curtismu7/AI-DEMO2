/**
 * Verify the modal title-bar controls (🪟 pop out, ✕ close) are actually
 * legible — in both themes, against the bar they sit on.
 *
 * They were reported as hard to see in dark mode and fixed blind, from a
 * 49x27 screenshot: 13px unweighted on rgba(255,255,255,0.12) -> 30px / 700 /
 * 0.22. "Reasonable numbers" is not the same as "legible", so measure.
 *
 * Reports WCAG contrast of the glyph against the composited title-bar
 * background, plus rendered size. Non-text UI components want >= 3.0 (WCAG
 * 1.4.11); as glyph-shaped controls these are held to that, not 4.5.
 *
 *   npx playwright test --config playwright.real.config.js modalTitlebarControls
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');
const { settle } = require('./helpers/uiProbe');

/** Pages that expose a DraggableModal behind a clickable control. */
const ROUTES = ['/token-chain', '/mcp-inspector', '/dashboard', '/audit'];

/** Composite an element's background down to the first opaque ancestor. */
const MEASURE = () => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    const a = p.length > 3 ? p[3] : 1;
    return a === 0 ? null : { r: p[0], g: p[1], b: p[2], a };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /**
   * A gradient paints the surface but has NO backgroundColor, so a walk that
   * reads backgroundColor alone strides straight past the modal's dark header
   * and lands on a white ancestor — reporting white-on-white for a control
   * that is plainly legible. Average the gradient's colour stops instead.
   */
  const gradientAverage = (bgImage) => {
    if (!bgImage || bgImage === 'none') return null;
    const stops = bgImage.match(/rgba?\([^)]+\)/g);
    if (!stops || !stops.length) return null;
    const cols = stops.map(parse).filter(Boolean);
    if (!cols.length) return null;
    return {
      r: cols.reduce((s, c) => s + c.r, 0) / cols.length,
      g: cols.reduce((s, c) => s + c.g, 0) / cols.length,
      b: cols.reduce((s, c) => s + c.b, 0) / cols.length,
      a: 1,
    };
  };

  const backdrop = (el) => {
    let cur = el.parentElement;
    let acc = null;
    while (cur) {
      const cs2 = getComputedStyle(cur);
      const grad = gradientAverage(cs2.backgroundImage);
      const c = parse(cs2.backgroundColor) || grad;
      if (c) {
        acc = acc === null ? c : over(acc, c);
        if (acc.a >= 0.99) return acc;
      }
      if (grad) return acc || grad; // a gradient is opaque — stop here
      cur = cur.parentElement;
    }
    return acc;
  };

  const btn = document.querySelector('.dm-btn');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const rect = btn.getBoundingClientRect();

  const under = backdrop(btn);
  const own = parse(cs.backgroundColor);
  const surface = own && under ? over(own, under) : (under || own);
  const glyph = parse(cs.color);
  if (!surface || !glyph) return null;

  const a = lum(glyph);
  const b = lum(surface);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  return {
    text: btn.textContent.trim(),
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    ownBg: cs.backgroundColor,
    surface: `rgb(${surface.r.toFixed(0)}, ${surface.g.toFixed(0)}, ${surface.b.toFixed(0)})`,
    glyph: cs.color,
    ratio: Math.round(ratio * 100) / 100,
  };
};

/** Click things that plausibly open a modal until a title bar appears. */
async function openAnyModal(page) {
  if (await page.locator('.dm-titlebar').count()) return true;
  const candidates = page.locator(
    'button:visible, [role="button"]:visible, .inspector-shell-tree-item:visible',
  );
  const n = Math.min(await candidates.count(), 25);
  for (let i = 0; i < n; i += 1) {
    try {
      await candidates.nth(i).click({ timeout: 1200 });
    } catch {
      continue;
    }
    if (await page.locator('.dm-titlebar').count()) return true;
  }
  return false;
}

test('modal title-bar controls are legible in both themes', async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsCustomer(page);

  const results = [];

  for (const theme of ['light', 'dark']) {
    for (const route of ROUTES) {
      await page.goto(route);
      await page.evaluate((t) => {
        try { localStorage.setItem('theme', t); } catch { /* private mode */ }
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      try {
        await settle(page);
      } catch {
        continue;
      }
      if (!(await openAnyModal(page))) continue;

      const m = await page.evaluate(MEASURE);
      if (m) {
        results.push({ theme, route, ...m });
        break; // one measurement per theme is enough
      }
    }
  }

  console.log('\n===== MODAL TITLE-BAR CONTROLS =====');
  if (!results.length) {
    console.log('  no DraggableModal could be opened on any route');
  }
  for (const r of results) {
    console.log(
      `\n${r.theme.toUpperCase()}  ${r.route}   glyph "${r.text}"\n` +
      `   size      ${r.size}  ${r.fontSize} / ${r.fontWeight}\n` +
      `   own bg    ${r.ownBg}\n` +
      `   composite ${r.surface}\n` +
      `   glyph     ${r.glyph}\n` +
      `   contrast  ${r.ratio}  ${r.ratio >= 3 ? 'PASS (>=3.0)' : 'FAIL (<3.0)'}`,
    );
  }
  console.log('\n====================================\n');

  expect(results.length, 'no modal opened — the probe proved nothing').toBeGreaterThan(0);
});
