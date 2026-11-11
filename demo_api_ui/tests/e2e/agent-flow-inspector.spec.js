/**
 * @file agent-flow-inspector.spec.js
 * @description Playwright E2E smoke for /agent-flow-inspector, which is the
 * "Agent & Token Flow History" page (AgentFlowHistoryPage): a master-detail
 * view of past agent runs. (It used to host the live three-tab
 * UnifiedTokenFlowInspector; that now lives in the floating DevTools overlay.)
 *
 * Covers:
 *   - Page title and heading
 *   - Run list from GET /api/agent-flow-history: loading is replaced by runs,
 *     the empty state, and the load-error state with "Try again"
 *   - The newest run is selected by default; picking another selects it
 *   - The page is public: it renders for a signed-out visitor
 *
 * Every /api call is stubbed (an empty 200 by default) — no live server needed,
 * and a running BFF cannot answer 401 and cover the page with its sign-in modal.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/agent-flow-inspector.spec.js
 */

const { test, expect } = require('@playwright/test');

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const RUNS = [
  {
    runId: 'run_2', userId: 'u1', vertical: 'banking', prompt: 'show my balance',
    startedAt: '2026-08-15T10:00:00.000Z', completedAt: '2026-08-15T10:00:05.000Z',
    toolsCalled: ['get_account_balance'], tokenEvents: [], success: true, agentPath: 'invoke',
  },
  {
    runId: 'run_1', userId: 'u1', vertical: 'pingone-admin', prompt: 'list the populations',
    startedAt: '2026-08-15T09:00:00.000Z', completedAt: '2026-08-15T09:00:03.000Z',
    toolsCalled: [], tokenEvents: [], success: false, agentPath: 'admin-agent',
  },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ signedIn?: boolean, history?: (route: import('@playwright/test').Route) => unknown }} [opts]
 */
async function mockHistory(page, { signedIn = true, history } = {}) {
  const user = { id: 'admin-flow-id', username: 'admin', email: 'admin@example.com', role: 'admin' };
  // Lowest priority: any other /api call gets an empty 200 (the most recently added route runs first).
  await page.route('**/api/**', (route) => route.fulfill(json({})));
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json(signedIn ? { authenticated: true, user } : { authenticated: false })));
  await page.route('**/api/auth/oauth/user/status', (route) => route.fulfill(json({ authenticated: false })));
  await page.route('**/api/auth/session**', (route) =>
    route.fulfill(json(signedIn ? { authenticated: true, user } : { authenticated: false })));
  await page.route('**/api/admin/config**', (route) => route.fulfill(json({ config: {} })));
  await page.route('**/api/admin/feature-flags**', (route) => route.fulfill(json({ flags: [] })));
  await page.route('**/api/config/vertical**', (route) => route.fulfill(json({ manifest: null })));
  await page.route('**/api/token-chain**', (route) => route.fulfill(json({ tokenEvents: [] })));
  await page.route('**/api/tokens/session-preview**', (route) => route.fulfill(json({ tokenEvents: [] })));
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/api/agent-flow-history**', history || ((route) => route.fulfill(json({ runs: RUNS }))));
}

const historyList = (page) => page.getByRole('complementary', { name: 'Run history' });
const runButton = (page, prompt) => historyList(page).getByRole('button', { name: new RegExp(prompt) });

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Agent Flow Inspector — page load', () => {
  test('renders the Agent & Token Flow History heading and sets the page title', async ({ page }) => {
    await mockHistory(page);
    await page.goto('/agent-flow-inspector');
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & Token Flow History' })).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveTitle('Agent & Token Flow History');
  });

  test('lists the recorded runs with their status and prompt', async ({ page }) => {
    await mockHistory(page);
    await page.goto('/agent-flow-inspector');
    await expect(runButton(page, 'show my balance')).toBeVisible({ timeout: 15000 });
    await expect(runButton(page, 'show my balance')).toContainText('Success');
    await expect(runButton(page, 'list the populations')).toContainText('Failed');
  });

  test('shows the empty state when there is no history', async ({ page }) => {
    await mockHistory(page, { history: (route) => route.fulfill(json({ runs: [] })) });
    await page.goto('/agent-flow-inspector');
    await expect(page.getByText('No agent runs recorded yet.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Select a run from the history list to inspect it.')).toBeVisible();
  });

  test('shows the load error and "Try again" refetches the list', async ({ page }) => {
    // Flag, not a call count: the dev server's StrictMode runs the page's fetch effect twice.
    let failing = true;
    await mockHistory(page, {
      history: (route) => (failing
        ? route.fulfill(json({ error: 'boom' }, 500))
        : route.fulfill(json({ runs: RUNS }))),
    });
    await page.goto('/agent-flow-inspector');
    await expect(page.getByText('Failed to load run history.')).toBeVisible({ timeout: 15000 });
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(runButton(page, 'show my balance')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Failed to load run history.')).toHaveCount(0);
  });
});

test.describe('Agent Flow Inspector — selecting a run', () => {
  test('the newest run is selected by default', async ({ page }) => {
    await mockHistory(page);
    await page.goto('/agent-flow-inspector');
    await expect(runButton(page, 'show my balance')).toHaveAttribute('aria-current', 'true', { timeout: 15000 });
    await expect(runButton(page, 'list the populations')).toHaveAttribute('aria-current', 'false');
  });

  test('clicking another run selects it and deselects the first', async ({ page }) => {
    await mockHistory(page);
    await page.goto('/agent-flow-inspector');
    await runButton(page, 'list the populations').click({ timeout: 15000 });
    await expect(runButton(page, 'list the populations')).toHaveAttribute('aria-current', 'true');
    await expect(runButton(page, 'show my balance')).toHaveAttribute('aria-current', 'false');
  });
});

test.describe('Agent Flow Inspector — signed out', () => {
  test('the page is public: a signed-out visitor still gets the history view', async ({ page }) => {
    await mockHistory(page, { signedIn: false });
    await page.goto('/agent-flow-inspector');
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & Token Flow History' })).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/agent-flow-inspector/);
  });
});
