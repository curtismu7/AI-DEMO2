// demo_api_ui/tests/e2e/tokenchain-replay.real.spec.js
'use strict';
/**
 * Token Chain step card — real browser spec for the step actions.
 *
 * Unit tests prove buildTraceSteps emits the right descriptors, but they
 * cannot tell you the action reads as a link, that "More Education" on the
 * gateway hop lands on the gateway inspector, or that a replay actually
 * re-runs the call in the target inspector. This drives /use-cases/live
 * against the running stack.
 *
 * Sign-in only works on the local.ping-devops.com host (passkey rp.id /
 * OAuth callback), so PLAYWRIGHT_BASE_URL must point there.
 *
 * Run: stack up + E2E_CUSTOMER_* env (auto-skips otherwise):
 *   PLAYWRIGHT_BASE_URL=https://local.ping-devops.com:4444 \
 *   npx playwright test tests/e2e/tokenchain-replay.real.spec.js \
 *     --config=playwright.real.config.js --reporter=list
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

test.describe('Token Chain step actions — real browser (link affordance + replay)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let ctx;
  let page;
  const restoreFlags = {};

  test.beforeAll(async ({ browser }) => {
    // describe.configure({ timeout }) does not raise the hook budget.
    test.setTimeout(300_000);
    // baseURL MUST be set explicitly: a hand-built context does not inherit
    // `use.baseURL` from the config, and without it every relative goto()
    // resolves against whatever port the OAuth callback landed on — which
    // silently tests the main checkout instead of this worktree.
    ctx = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.E2E_BASE_URL,
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
    });
    page = await ctx.newPage();
    // The OAuth callback is registered against the main checkout's port, so
    // the helper lands on :4000 and its waitForURL can time out even though
    // the session cookie was set. The cookie is host-scoped, not port-scoped,
    // so it carries to this worktree's port either way — the session check
    // below is the real gate.
    await loginAsCustomer(page).catch((err) => {
      console.log(`[login] helper returned ${err.message} — verifying session directly`);
    });
    const session = await ctx.request.get('/api/auth/oauth/user/status');
    expect(session.ok(), 'session status endpoint reachable').toBe(true);
    expect((await session.json())?.authenticated, 'authenticated session required').toBe(true);

    await page.goto('/use-cases/live');
    expect(page.url(), 'must be driving the worktree UI, not the main checkout')
      .toContain(new URL(process.env.PLAYWRIGHT_BASE_URL || process.env.E2E_BASE_URL).port);
    await page.waitForSelector('.luw-topbar__agent-tools', { timeout: 30_000 });

    // Same reason as luw-workbench.real.spec.js: without a live decision
    // endpoint no authorize-decision lands at all, so the authorize step
    // would have no replay to test.
    const flagsResp = await ctx.request.get('/api/admin/feature-flags');
    if (flagsResp.ok()) {
      const flags = (await flagsResp.json())?.flags || [];
      const f = flags.find((x) => x.id === 'ff_authorize_simulated');
      const current = f && (f.value === true || f.value === 'true');
      if (f && current !== true) {
        restoreFlags.ff_authorize_simulated = current;
        await ctx.request.patch('/api/admin/feature-flags', {
          data: { updates: { ff_authorize_simulated: true } },
        });
      }
    }

    // One real run supplies the evidence every assertion below reads.
    // The drawer's open/closed state is persisted per origin, so this
    // worktree's port starts with its own default — never assume it is open.
    const body = page.locator('.luw-body');
    await expect(body).toBeVisible({ timeout: 30_000 });
    if (((await body.getAttribute('class')) || '').includes('luw-body--drawer-closed')) {
      await page.locator('.luw-drawer-tab').click();
      await expect(body).not.toHaveClass(/luw-body--drawer-closed/);
    }
    // Catalog is fetched after mount — the cards do not exist on first paint.
    await expect(page.locator('.luw-card').first()).toBeVisible({ timeout: 60_000 });
    const card = page.locator('.luw-card').filter({
      has: page.locator('.luw-card__meta', { hasText: /^UC1\b/ }),
    }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.locator('.luw-card__run').click();
    await expect(page.locator('.tctr-step').first()).toBeVisible({ timeout: 60_000 });
    // Gate on the rail's own evidence, not the use-case verdict: a replay
    // button exists exactly when buildTraceSteps found a re-issuable request,
    // which is the precondition every assertion below actually needs.
    await page
      .locator('button.tctr-inspect', { hasText: /^→ Replay in/ })
      .first()
      .waitFor({ state: 'attached', timeout: 180_000 })
      .catch(() => {}); // diagnostic test 0 reports what landed either way

    // Close the drawer: its scrim overlays the rail and intercepts clicks on
    // the replay buttons the later tests have to press.
    if (!((await body.getAttribute('class')) || '').includes('luw-body--drawer-closed')) {
      await page.locator('.luw-drawer__toggle').click();
      await expect(body).toHaveClass(/luw-body--drawer-closed/);
    }
  });

  test('0. the run produced both replayable hops', async () => {
    const labels = await page.locator('.tctr-step').evaluateAll((els) =>
      els.flatMap((el) => {
        el.open = true;
        return Array.from(el.querySelectorAll('.tctr-inspect'))
          .map((a) => `${el.getAttribute('data-step-id')}:${(a.textContent || '').trim()}`);
      }),
    );
    expect(labels).toContain('authorize:→ Replay in P1AZ Evaluate');
    expect(labels).toContain('gateway:→ Replay in Gateway Tester');
  });

  test.afterAll(async () => {
    if (Object.keys(restoreFlags).length) {
      await ctx.request
        .patch('/api/admin/feature-flags', { data: { updates: restoreFlags } })
        .catch(() => {});
    }
    await page?.close().catch(() => {});
    await ctx?.close().catch(() => {});
  });

  /**
   * Expands one step's <details>. Sets `open` directly rather than clicking the
   * summary: the drawer scrim overlays the rail and intercepts pointer events,
   * and this spec is asserting the step body's contents, not the disclosure.
   */
  async function openStep(stepId) {
    const step = page.locator(`.tctr-step[data-step-id="${stepId}"]`);
    await expect(step).toHaveCount(1);
    await step.evaluate((el) => { el.open = true; });
    await expect(step.locator('.tctr-step-body')).toBeVisible();
    return step;
  }

  test('2. "More Education" on the Agent Gateway hop opens the gateway inspector', async () => {
    const step = await openStep('gateway');
    const link = step.locator('a.tctr-inspect', { hasText: 'More Education' });
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute('href');
    expect(href, 'gateway hop must not point at the P1AZ page').toBe('/pinggateway-inspector');
  });

  test('3. replaying the gateway hop re-runs the tool in the Agent Gateway Tester', async () => {
    const step = await openStep('gateway');
    const replay = step.locator('button.tctr-inspect', { hasText: 'Replay in Gateway Tester' });
    await expect(replay).toHaveCount(1);

    const [tab] = await Promise.all([ctx.waitForEvent('page'), replay.click()]);
    await tab.waitForLoadState('domcontentloaded');
    expect(tab.url()).toContain('/pinggateway-inspector');
    expect(tab.url()).toContain('subtab=tester');
    expect(tab.url()).toMatch(/[?&]replay=/);

    // Auto-run: a result footer only renders once a response has come back.
    await expect(tab.locator('.inspector-shell-output-footer')).toBeVisible({ timeout: 60_000 });
    await expect(tab.locator('.inspector-shell-output-footer')).toContainText('Status:');
    await tab.close();
  });

  test('4. replaying the authorize hop re-evaluates in the P1AZ console', async () => {
    const step = await openStep('authorize');
    const replay = step.locator('button.tctr-inspect', { hasText: 'Replay in P1AZ Evaluate' });
    await expect(replay).toHaveCount(1);

    const [tab] = await Promise.all([ctx.waitForEvent('page'), replay.click()]);
    await tab.waitForLoadState('domcontentloaded');
    expect(tab.url()).toContain('/pingone-authorize');
    expect(tab.url()).toMatch(/[?&]replay=/);

    // Auto-run: the empty state is gone and a real decision is rendered.
    // "engine:" only appears inside the result box, so it cannot pass on a
    // merely-prefilled form.
    await expect(tab.locator('.inspector-shell-output-body')).toContainText('engine:', { timeout: 60_000 });
    await tab.close();
  });
  test('1. step actions read as links, not as plain text', async () => {
    const step = await openStep('authorize');
    const action = step.locator('.tctr-inspect').first();
    await expect(action).toBeVisible();
    // Relative, not absolute: the rail renders inside `style={{ zoom }}`
    // (presenter text size, persisted per origin) and getComputedStyle reports
    // the zoom-scaled px, so a hard-coded size is a false failure at any zoom
    // but 100%. Comparing against the step body holds at every zoom.
    const style = await action.evaluate((el) => {
      const s = getComputedStyle(el);
      const body = el.closest('.tctr-step-body');
      return {
        fontSize: parseFloat(s.fontSize),
        bodyFontSize: parseFloat(getComputedStyle(body).fontSize),
        decoration: s.textDecorationLine,
      };
    });
    // Was 11px declared (and 12px actual, inherited) against a 12px body —
    // never larger than the prose it sits under.
    expect(style.fontSize).toBeGreaterThan(style.bodyFontSize);
    expect(style.decoration).toContain('underline');
  });

});
