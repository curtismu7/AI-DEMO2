// The realistic-flow lock: a real UC1 run must show the 401 dance on both legs
// in the live surfaces, and the chain must collapse what didn't run. Runs ONLY
// against the live stack (loginAsCustomer + real gateway + PingOne); CI runs
// the mocked suites instead.
//
// The run is dispatched the way a presenter fires it: the /use-cases card's
// Run button, which POSTs /api/use-cases/demo/run, pins the vertical, and
// navigates to /dashboard with the trigger text — AIAgent's mount effect then
// sends the chip through sendAgentMessage, whose SSE stream and run envelope
// feed the token-chain store. A raw API dispatch would leave the UI store
// empty, so the assertions cover what a human sees on the dashboard's chain
// surface (the filmstrip): the dance hops drawn as nodes with their 401
// evidence, the never-fired hops collapsed behind the "+N hops not in this
// run" chip, and the chip revealing them.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, getE2eBaseUrl } = require('./helpers/realLogin');
const { USE_CASES, resolveUseCase } = require('../../../demo_api_server/config/useCases');

/** First works-maturity banking chip whose primaryTool reads a balance. */
function findBankingReadChip() {
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (uc.primaryTool === 'get_my_accounts' || uc.primaryTool === 'get_account_balance') {
      return { id: u.id, useCaseId: uc.useCaseId || u.useCaseId, title: uc.title || u.title, text: t.text };
    }
  }
  return null;
}

test('UC1 run: dance hops visible, non-fired hops collapsed behind the chip', async ({ page }) => {
  // The real-config default is 60s; the OAuth round-trip + live dance need more.
  test.setTimeout(300_000);
  await loginAsCustomer(page);

  const chip = findBankingReadChip();
  test.skip(!chip, 'no works-maturity banking read chip in the catalog');

  // The session's vertical persists server-side (whatever the last run left
  // active — airlines, healthcare…). Pin banking so the launcher shows (and
  // Run dispatches with) the banking catalog.
  const vsResp = await page.request.post(`${getE2eBaseUrl().replace(/\/$/, '')}/api/verticals/active`, {
    data: { id: 'banking' },
  });
  test.skip(!vsResp.ok(), `could not pin the banking vertical (HTTP ${vsResp.status()})`);

  const base = getE2eBaseUrl().replace(/\/$/, '');
  await page.goto(`${base}/use-cases`);

  // The catalog is grouped by track; scope the Run to the card whose title is
  // the read-balance use case (UC1, "Delegated access (consent only)").
  const card = page.locator('.uc-card', { has: page.locator('.uc-card__title', { hasText: chip.title }) }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^Run$|Run again/ }).click();

  // Run navigates to /dashboard and auto-dispatches the trigger text. UC1's
  // agent-access consent gate pauses the send until the presenter clicks
  // Allow (AgentConsentModal) — part of the story, not a detour.
  await page.waitForURL('**/dashboard');
  // The consent modal mounts after the resume effect's settle timers, so wait
  // for it briefly rather than probing visibility once.
  const allow = page.getByRole('button', { name: 'Allow', exact: true });
  await allow.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  if (await allow.isVisible().catch(() => false)) await allow.click();

  // The completed-run marker on the dashboard's chain surface (filmstrip):
  // the collapsed-hops chip only renders once the run has settled.
  const collapse = page.locator('[data-testid="tctr-skipped-chip"]');
  await collapse.waitFor({ state: 'visible', timeout: 240_000 });

  // 1. The dance: both challenge hops render as chain nodes with 401 evidence
  //    (the node fact reads the hop's first kv pair: "status 401").
  const listHop = page.locator('.tcnr-node', { has: page.locator('.tcnr-node-title', { hasText: 'tools/list 401' }) });
  const callHop = page.locator('.tcnr-node', { has: page.locator('.tcnr-node-title', { hasText: 'tools/call 401' }) });
  await expect(listHop).toHaveCount(1);
  await expect(callHop).toHaveCount(1);
  await expect(listHop.locator('.tcnr-node-fact')).toContainText('401');
  await expect(callHop.locator('.tcnr-node-fact')).toContainText('401');

  // 2. The collapse: nonzero count, and a hop that never fired (database, on a
  //    balance read without backend evidence) is not drawn.
  await expect(collapse).not.toContainText('+ 0');
  await expect(page.locator('.tcnr-node-title', { hasText: 'Database' })).toHaveCount(0);

  // 3. Expanding reveals the greyed hops.
  await collapse.click();
  await expect(page.locator('.tcnr-node-title', { hasText: 'Database' })).toHaveCount(1);

  // 4. The evidence is inspectable: clicking a challenge hop opens the detail
  //    sheet with the challenge response (the 401 + WWW-Authenticate wire).
  await callHop.click();
  await expect(page.locator('.sdp-title')).toContainText('tools/call 401');
  await expect(page.locator('.tcfs-sheet')).toContainText('401');
  await page.screenshot({ path: 'evidence/uc1-token-dance.png', fullPage: true });
});
