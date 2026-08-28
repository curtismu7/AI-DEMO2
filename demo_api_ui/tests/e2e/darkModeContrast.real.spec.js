/**
 * Live dark-mode triage for the pop-out modal audit.
 *
 * The static scan found 82 hard-coded white backgrounds across 22 modal
 * stylesheets. A hard-coded white is only a DEFECT where the surface is
 * actually reachable in dark mode — otherwise it is a deliberately
 * single-theme panel. A scanner cannot tell those apart; this can.
 *
 * Drives the real app with the theme stamped dark, walks the rendered DOM, and
 * reports every element whose own background is light while its text is light
 * too. That is the unreadable-in-dark-mode failure, measured rather than
 * guessed.
 *
 * Not a pass/fail gate — it prints a triage report. Run:
 *   npx playwright test --config playwright.real.config.js darkModeContrast
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');
const { settle } = require('./helpers/uiProbe');

/** Routes that host the stylesheets the static scan flagged. */
const ROUTES = [
  // The components converted to --th-* tokens, plus the shells they sit in.
  ['/token-chain', 'TokenChainDisplay — 437 hex -> 271'],
  ['/mcp-inspector', 'InspectorShell + signin strip'],
  ['/pingone-test', 'PingOneTestPage — 251 -> 192'],
  ['/mfa-test', 'MFATestPage — 182 -> 129'],
  ['/dashboard', 'AIAgent, UnifiedTokenFlowInspector'],
  ['/transaction-trace', 'TransactionTracePage'],
  ['/audit', 'AuditPage'],
  ['/config', 'Config'],
];

/** In-page: relative luminance + WCAG contrast ratio. */
const AUDIT = () => {
  const lum = (r, g, b) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((n) => parseFloat(n));
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null; // fully transparent
    return { r: p[0], g: p[1], b: p[2], a };
  };

  /**
   * A translucent background is NOT the colour that renders. rgba(255,255,255,.08)
   * on a dark bar is a subtle light tint, not white — treating it as opaque was
   * producing false "white-on-white" hits. Composite down the ancestor chain to
   * the first opaque backdrop to get the colour a human actually sees.
   */
  const effectiveBg = (el) => {
    let cur = el;
    let acc = null; // {r,g,b,a} accumulated from the element outward
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c) {
        acc = acc === null
          ? c
          : {
              r: acc.r * acc.a + c.r * (1 - acc.a),
              g: acc.g * acc.a + c.g * (1 - acc.a),
              b: acc.b * acc.a + c.b * (1 - acc.a),
              a: acc.a + c.a * (1 - acc.a),
            };
        if (acc.a >= 0.99) return acc;
      }
      cur = cur.parentElement;
    }
    return acc && acc.a >= 0.99 ? acc : null;
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const own = parse(cs.backgroundColor);
    if (!own) continue;                      // no own background — skip
    const bg = effectiveBg(el);
    if (!bg) continue;                       // could not resolve an opaque backdrop
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 16) continue;

    const bgL = lum(bg.r, bg.g, bg.b);
    if (bgL < 0.5) continue;                 // not a light surface

    // Does it hold light text?
    const fg = parse(cs.color);
    if (!fg) continue;
    const fgL = lum(fg.r, fg.g, fg.b);
    const ratio = (Math.max(bgL, fgL) + 0.05) / (Math.min(bgL, fgL) + 0.05);

    // Only flag when the element itself renders text.
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasText) continue;
    if (ratio >= 4.5) continue;              // legible — fine

    // WCAG 1.4.3 exempts inactive controls — a disabled button is SUPPOSED to
    // be low-contrast, so flagging one is a false positive.
    const inactive =
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.closest('[disabled],[aria-disabled="true"]') !== null;

    out.push({
      cls: (el.className && String(el.className).slice(0, 70)) || el.tagName,
      bg: cs.backgroundColor,
      fg: cs.color,
      ratio: Math.round(ratio * 100) / 100,
      inactive,
      text: (el.textContent || '').trim().slice(0, 28),
    });
  }
  // de-dupe by class+colours
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.cls}|${r.bg}|${r.fg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

test('dark-mode contrast triage across modal-bearing routes', async ({ page }) => {
  test.setTimeout(300_000);

  await loginAsCustomer(page);

  // Stamp dark the way ThemeContext does (attribute, never prefers-color-scheme).
  await page.evaluate(() => {
    try { localStorage.setItem('theme', 'dark'); } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  const report = [];
  for (const [route, owns] of ROUTES) {
    await page.goto(route);
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'));
    let seen = 0;
    try {
      const s = await settle(page);
      // settle() returns a measurement object on this helper version.
      seen = typeof s === 'number' ? s : (s?.chars ?? s?.text ?? JSON.stringify(s).length);
    } catch (e) {
      report.push({ route, owns, error: String(e.message).slice(0, 90) });
      continue;
    }
    const hits = await page.evaluate(AUDIT);
    report.push({ route, owns, chars: seen, offenders: hits.length, hits: hits.slice(0, 10) });
  }

  console.log('\n===== DARK-MODE CONTRAST TRIAGE =====');
  for (const r of report) {
    if (r.error) {
      console.log(`\n${r.route}  —  DID NOT RENDER: ${r.error}`);
      continue;
    }
    console.log(`\n${r.route}  (${r.owns})  ${r.chars} chars  ->  ${r.offenders} offender(s)`);
    for (const h of r.hits) {
      const tag = h.inactive ? '[disabled — WCAG exempt]' : '[ACTIVE]';
      console.log(`   ratio ${h.ratio} ${tag}  bg ${h.bg}  fg ${h.fg}`);
      console.log(`      ${h.cls}   "${h.text}"`);
    }
  }
  console.log('\n=====================================\n');

  // The drive itself must have worked; offenders are reported, not asserted.
  expect(report.filter((r) => !r.error).length).toBeGreaterThan(0);
});
