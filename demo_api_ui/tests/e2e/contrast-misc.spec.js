/**
 * Computed-style checks for the contrast and shared-styling fixes (theme F4, F5, F8, F9, F10; collisions CO-1, CO-2,
 * CO-3), in light and dark, on a sample of routes. Every API call is stubbed (admin session mocked on the route that
 * needs the assistant dock); nothing here signs in or touches a tenant.
 *
 * Contrast is computed in the page from the rendered colours with effective opacity, against the nearest opaque
 * ground. The CSS-text twin that reads the token values is src/__tests__/contrastMiscFixes.test.js.
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:<vite port> npx playwright test contrast-misc
 */
const { test, expect } = require('@playwright/test');

const ADMIN = { id: 'a', username: 'admin', email: 'a@example.com', firstName: 'A', lastName: 'B', name: 'A B', role: 'admin' };
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openRoute(page, route, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.removeItem('userLoggedOut');
      localStorage.setItem('ba_dark_mode', t === 'dark' ? 'true' : 'false');
    } catch { /* storage unavailable */ }
  }, theme);
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/auth/oauth/status') || u.includes('/api/auth/session')) return r.fulfill(json({ authenticated: true, user: ADMIN }));
    if (u.includes('/api/auth/oauth/user/status')) return r.fulfill(json({ authenticated: false }));
    return r.fulfill(json({}));
  });
  await page.goto(route, { waitUntil: 'load' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 30_000 });
  await page.waitForSelector('.pu-page', { timeout: 60_000 });
}

/** In-page measurement: label contrast vs the element's own fill, and edge contrast vs its parent's ground. */
const MEASURE = (sel) => {
  const P = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const CR = (a, b) => { const x = L(a); const y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const ground = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = P(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) > 0) { stack.push(c); if ((c[3] ?? 1) >= 1) break; }
    }
    let g = P(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
    if (!g.length) g = [255, 255, 255];
    while (stack.length) { const c = stack.pop(); g = over(c.slice(0, 3), c[3] ?? 1, g); }
    return g;
  };
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return null;
  const cs = getComputedStyle(el);
  const par = ground(el.parentElement || el);
  let o = 1;
  for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
  const fillC = P(cs.backgroundColor);
  const grad = cs.backgroundImage.includes('gradient') ? cs.backgroundImage.match(/rgba?\([^)]+\)/g) : null;
  const fill = grad ? P(grad[0]).slice(0, 3) : (fillC.length && (fillC[3] ?? 1) > 0 ? over(fillC.slice(0, 3), fillC[3] ?? 1, par) : par);
  const colC = P(cs.color);
  const col = over(colC.slice(0, 3), colC[3] ?? 1, fill);
  const bc = P(cs.borderTopColor);
  const bw = parseFloat(cs.borderTopWidth);
  const edge = bw > 0 ? over(over(bc.slice(0, 3), bc[3] ?? 1, par), o, par) : null;
  return {
    text: +CR(over(col, o, par), over(fill, o, par)).toFixed(2),
    edge: edge ? +CR(edge, par).toFixed(2) : null,
    opacity: +o.toFixed(2),
  };
};
const measure = (page, sel) => page.evaluate(MEASURE, sel);

/** Visible buttons/links painted with the Ping Red gradient, outside the (hidden, off-canvas) CIBA drawer. */
const redPrimaries = (page) => page.evaluate(() => [...document.querySelectorAll('button, a')]
  .filter((e) => e.checkVisibility() && !e.closest('.ciba-drawer') && /210, 14, 15/.test(getComputedStyle(e).backgroundImage))
  .map((e) => e.textContent.trim().slice(0, 40)));

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} theme`, () => {
    test('F4: hovering the selected InspectorShell item keeps its label readable', async ({ page }) => {
      await openRoute(page, '/privilege-coding-agents', theme);
      const active = page.locator('.inspector-shell-tree-item--active').first();
      await active.hover();
      await page.waitForTimeout(300);
      const m = await measure(page, '.inspector-shell-tree-item--active');
      expect(m.text, JSON.stringify(m)).toBeGreaterThanOrEqual(4.5);
    });

    test('F5: unselected diagram controls have a 3:1 edge', async ({ page }) => {
      await openRoute(page, '/gateway-claims', theme);
      for (const sel of ['.dreel-card:not(.dreel-card--now)', '.dc-steptime-select']) {
        const m = await measure(page, sel);
        expect(m, sel).not.toBeNull();
        expect(m.edge, `${sel} ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(3);
      }
    });

    test('F5: /delegated-commerce steps and /ai-products/protect fields have a 3:1 edge', async ({ page }) => {
      await openRoute(page, '/delegated-commerce', theme);
      const step = await measure(page, '.dcom-step:not(.dcom-step--active)');
      expect(step.edge, JSON.stringify(step)).toBeGreaterThanOrEqual(3);
      await page.goto('/ai-products/protect', { waitUntil: 'load' });
      await page.waitForSelector('.p1p-auth__form input', { timeout: 60_000 });
      for (const sel of ['.p1p-auth__form input', '.p1p-auth__secondary']) {
        const m = await measure(page, sel);
        expect(m.edge, `${sel} ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(3);
      }
    });

    test('F8 and F10: one red primary beside the assistant, and its disabled Send reads', async ({ page }) => {
      for (const route of ['/agent-lifecycle', '/delegated-commerce']) {
        await openRoute(page, route, theme);
        await page.waitForSelector('.ba-left-nav-btn', { state: 'visible', timeout: 60_000 });
        const reds = await redPrimaries(page);
        expect(reds, `${route}: ${reds.join(' | ')}`).toHaveLength(1);
        const send = page.locator('button.ba-send-btn:disabled').first();
        await expect(send).toBeVisible();
        const m = await measure(page, 'button.ba-send-btn:disabled');
        expect(m.text, `${route} ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test('F9: the busy PingOne Protect primary keeps its label at 4.5:1', async ({ page }) => {
      await openRoute(page, '/ai-products/protect', theme);
      await page.waitForSelector('.p1p-auth__run-chip', { timeout: 60_000 });
      await page.evaluate(() => document.querySelector('.p1p-auth__run-chip').setAttribute('aria-disabled', 'true'));
      const m = await measure(page, '.p1p-auth__run-chip');
      expect(m.text, JSON.stringify(m)).toBeGreaterThanOrEqual(4.5);
    });

    test('CO-2: every text node in the CIBA drawer reads on the drawer ground', async ({ page }) => {
      await openRoute(page, '/weather-mcp', theme);
      for (const tab of ['what', 'roles', 'tokenx', 'tryit', 'bffcode']) {
        await page.evaluate((t) => window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: t } })), tab);
        await page.waitForSelector('.ciba-drawer--open .ciba-tab--active');
        const bad = await page.evaluate(() => {
          const P = (c) => (c.match(/[\d.]+/g) || []).map(Number);
          const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
          const CR = (a, b) => { const x = L(a); const y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
          const ground = (el) => {
            const st = [];
            for (let n = el; n; n = n.parentElement) { const c = P(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) { st.push(c); if ((c[3] ?? 1) >= 1) break; } }
            let g = [255, 255, 255];
            while (st.length) { const c = st.pop(); const a = c[3] ?? 1; g = g.map((v, i) => c[i] * a + v * (1 - a)); }
            return g;
          };
          const out = [];
          const w = document.createTreeWalker(document.querySelector('.ciba-drawer--open'), NodeFilter.SHOW_TEXT);
          while (w.nextNode()) {
            const t = w.currentNode;
            if (!t.textContent.trim() || !t.parentElement.checkVisibility()) continue;
            const col = P(getComputedStyle(t.parentElement).color);
            const g = ground(t.parentElement);
            const a = col[3] ?? 1;
            const r = CR(col.slice(0, 3).map((v, i) => v * a + g[i] * (1 - a)), g);
            if (r < 4.5) out.push(`${t.parentElement.tagName}.${t.parentElement.className}|${t.textContent.trim().slice(0, 30)}|${r.toFixed(2)}`);
          }
          return out;
        });
        expect(bad, `${tab}: ${bad.slice(0, 4).join(' ; ')}`).toEqual([]);
      }
    });

    test('CO-3: scrollbars outside the token modal keep the default width (no ::-webkit-scrollbar size); inside it the thumb is 3:1', async ({ page }) => {
      await openRoute(page, '/privilege-saas-access', theme);
      const r = await page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="tfd-root" style="position:fixed;top:0;left:0;width:100px;height:100px"><div id="fx-in" style="overflow:scroll;width:80px;height:50px"><div style="height:300px;width:300px"></div></div></div>'
          + '<div id="fx-out" style="position:fixed;top:0;left:200px;overflow:scroll;width:80px;height:50px"><div style="height:300px;width:300px"></div></div>';
        document.body.appendChild(host);
        // The pseudo's computed width, not offsetWidth - clientWidth: the app zoom and overlay scrollbars make the latter 0.
        const w = (id) => getComputedStyle(document.getElementById(id), '::-webkit-scrollbar').width;
        return { outside: w('fx-out'), inside: w('fx-in'), thumb: getComputedStyle(document.getElementById('fx-in'), '::-webkit-scrollbar-thumb').backgroundColor };
      });
      expect(r.outside, 'the app-wide scrollbar must not be the 4px modal one').toBe('auto');
      expect(r.inside).toBe('4px');
      expect(r.thumb).toBe('rgb(139, 148, 158)');
    });
  });
}

test('CO-1: visiting /privilege-map does not turn another page\'s diagram Simulate red', async ({ page }) => {
  await openRoute(page, '/privilege-map', 'light');
  await page.evaluate(() => { history.pushState({}, '', '/privilege-pf-token'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('.dc-ctrl-btn--simulate', { timeout: 60_000 });
  const sim = await page.evaluate(() => { const s = document.querySelector('.dc-ctrl-btn--simulate'); const cs = getComputedStyle(s); return { img: cs.backgroundImage, bg: cs.backgroundColor }; });
  expect(sim.img).not.toMatch(/gradient/);
  expect(sim.bg).not.toBe('rgb(210, 14, 15)');
  // and the Privilege Map's own diagram view still has its Simulate as the one primary
  await page.goto('/privilege-map?page=identity&feature=agent-registry&diagram=1', { waitUntil: 'load' });
  await page.waitForSelector('.pmap-page .dc-ctrl-btn--simulate', { timeout: 60_000 });
  const own = await page.evaluate(() => getComputedStyle(document.querySelector('.dc-ctrl-btn--simulate')).backgroundImage);
  expect(own).toMatch(/210, 14, 15/);
});
