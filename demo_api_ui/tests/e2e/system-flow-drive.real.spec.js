// Drives the System Flow map against the live stack.
//
//   cd demo_api_ui && E2E_BASE_URL=https://local.ping-devops.com:4000 \
//     npm run test:e2e:real -- system-flow-drive
//
// Not a gate — a driver, to see the thing paint on a real run before merging.
// Unit tests cover buildFlowModel; nothing covers the SVG geometry, the band
// layout, or whether a real run's step ids actually hit STEP_TO_EDGE.
//
// NAVIGATION IS CLIENT-SIDE ON PURPOSE. tokenChainTraceStore is a module
// singleton, so page.goto('/monitoring/system-flow') reloads the SPA and paints
// an empty map — which would look exactly like the feature not working.
'use strict';
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

const PROMPT = 'show my invoices';
const SHOTS = 'test-results/system-flow';

/** Close any OTP / consent modal — .dm-backdrop silently eats clicks. */
async function dismissDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const backdrop = page.locator('.dm-backdrop');
    if (!(await backdrop.first().isVisible().catch(() => false))) return;
    const otpCancel = page.locator('.otp-step-up-modal__btn-cancel');
    if (await otpCancel.first().isVisible().catch(() => false)) {
      await otpCancel.first().click().catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(700);
  }
}

/** What the map is actually showing, read off the DOM rather than guessed. */
const readMap = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.sfm-root');
    if (!root) return null;
    return {
      verdict: root.querySelector('.sfm-verdict')?.textContent?.trim() || null,
      ms: root.querySelector('.sfm-ms')?.textContent?.trim() || null,
      hops: root.querySelector('.sfm-hops')?.textContent?.trim() || null,
      caption: root.querySelector('.sfm-caption')?.textContent?.trim() || null,
      bands: [...root.querySelectorAll('.sfm-band')].map((b) => b.dataset.band),
      edges: [...root.querySelectorAll('.sfm-edge')].map((e) => {
        const d = e.getAttribute('d') || '';
        const box = root.querySelector('.sfm-canvas').getBoundingClientRect();
        const r = e.getBoundingClientRect();
        return {
          kind: e.dataset.kind,
          state: (e.getAttribute('class').match(/sfm-edge--(\w+)/) || [])[1],
          title: e.querySelector('title')?.textContent || null,
          // Rounded, so the log stays readable and two identical lanes are
          // obvious at a glance.
          d: d.replace(/[\d.]+/g, (n) => Math.round(Number(n))),
          // Does the line actually sit inside the map? The stale-geometry bug
          // drew an edge out through the side of the panel, and a truncated `d`
          // string could not show that.
          escapes:
            r.left < box.left - 2 || r.right > box.right + 2 ||
            r.top < box.top - 2 || r.bottom > box.bottom + 2,
        };
      }),
      litNodes: [...root.querySelectorAll('.sfm-node[data-state]')].map(
        (n) => `${n.querySelector('.sfm-node-name')?.textContent?.trim()}=${n.dataset.state}`,
      ),
      unlitNodes: [...root.querySelectorAll('.sfm-node:not([data-state])')].map(
        (n) => n.querySelector('.sfm-node-name')?.textContent?.trim(),
      ),
    };
  });

test.describe('System Flow map on a live run', () => {
  test.describe.configure({ timeout: 300_000 });

  test('paints a real run onto the deployment map', async ({ page }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');

    await loginAsCustomer(page);
    await page.goto('/dashboard');

    const panel = page.locator('.banking-agent-panel');
    await expect(panel, 'agent panel on /dashboard').toBeVisible({ timeout: 30_000 });
    await dismissDialogs(page);

    const calls = [];
    page.on('response', (r) => {
      const u = r.url();
      if (/\/api\/(demo-agent\/nl|mcp\/tool|agent\/(invoke|run))/.test(u)) {
        const line = `${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`;
        calls.push(line);
        console.log(`[drive] call ${line}`);
      }
    });

    const input = panel.locator('input.ba-input');
    await expect(input, 'chat input visible').toBeVisible();
    await input.click();
    await input.fill(PROMPT);
    await input.press('Enter');

    // Wait for a hop only a completed round trip produces. Browser and Prompt
    // are seeded the moment you type.
    const deadline = Date.now() + 240_000;
    let nodes = [];
    while (Date.now() < deadline) {
      nodes = await page.$$eval('.tcnr-node', (ns) =>
        ns.map((n) => n.textContent.trim().replace(/\s+/g, ' ')),
      );
      if (nodes.some((t) => /Reply|Gateway/i.test(t))) break;
      await page.waitForTimeout(2_000);
    }
    console.log(`[drive] agent calls: ${calls.join(', ') || 'none'}`);
    console.log(`[drive] ${nodes.length} chain nodes: ${nodes.join(' | ')}`);

    // Browser and Prompt are seeded the moment you type, so a run that stalls
    // still leaves two nodes and every assertion below passes vacuously — the
    // map draws one edge and is declared correct. Fail here instead: a thin run
    // means the STACK was slow, and saying so beats a green that proves nothing.
    expect(
      nodes.length,
      `only ${nodes.length} chain nodes (${nodes.join(' | ')}) — the run stalled, ` +
        `so this drive proves nothing about the map. Agent calls: ${calls.join(', ') || 'none'}`,
    ).toBeGreaterThanOrEqual(5);

    // ---- surface 1: the pop-out, the path the rail's view menu takes ----
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('system-flow-open')));
    const root = page.locator('.sfm-root');
    await expect(root, 'system flow map mounted').toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200); // let React Flow measure and fit the view

    const popout = await readMap(page);
    console.log(`[drive] POPOUT ${JSON.stringify(popout, null, 2)}`);
    await page.screenshot({ path: `${SHOTS}/popout.png`, fullPage: false });

    // The map is worthless if the run produced no edges — that is the failure
    // this whole drive exists to catch, so assert it rather than eyeball it.
    expect(popout, 'map read from DOM').not.toBeNull();
    expect(popout.edges.length, `edges drawn (nodes lit: ${popout.litNodes})`).toBeGreaterThan(0);
    for (const e of popout.edges) {
      expect(e.d, `edge ${e.kind}/${e.state} has geometry`).toMatch(/^M-?\d+,-?\d+ C/);
      expect(e.escapes, `edge "${e.title}" stays inside the map`).toBe(false);
      // Control points must stay between the endpoints. A fixed offset floor
      // overshot on short gaps and drew an S-squiggle between adjacent boxes.
      const [x1, , cx1, , cx2, , x2] = e.d.match(/-?\d+/g).map(Number);
      const lo = Math.min(x1, x2) - 1;
      const hi = Math.max(x1, x2) + 1;
      expect(
        cx1 >= lo && cx1 <= hi && cx2 >= lo && cx2 <= hi,
        `edge "${e.title}" curve doubles back: ${e.d}`,
      ).toBe(true);
    }
    // One lane per node pair. Three bff→pep steps drew three coincident lines
    // whose visible colour was whichever painted last.
    const lanes = popout.edges.map((e) => e.d);
    expect(new Set(lanes).size, `no duplicate lanes in ${JSON.stringify(lanes)}`).toBe(lanes.length);

    // ---- surface 2: the side-nav page, reached WITHOUT a reload ----
    await page.keyboard.press('Escape').catch(() => {});
    const navLink = page.locator('a[href="/monitoring/system-flow"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
    } else {
      console.log('[drive] side-nav link not visible — using client-side history push');
      await page.evaluate(() => {
        window.history.pushState({}, '', '/monitoring/system-flow');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    }
    await expect(page.locator('.sfm-root'), 'map on its own page').toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200);

    const pageView = await readMap(page);
    console.log(`[drive] PAGE ${JSON.stringify(pageView, null, 2)}`);
    await page.screenshot({ path: `${SHOTS}/page.png`, fullPage: true });

    expect(pageView.bands.length, 'five trust boundaries').toBe(5);
  });
});
