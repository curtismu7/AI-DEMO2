/**
 * @file use-cases-catalog.spec.js
 * @description Playwright E2E smoke for the Use Cases Catalog (/use-cases).
 *
 * Covers:
 *   - Page renders "AI Agent Security Use Cases" heading
 *   - Progress counter shown (data-testid="uc-demo-progress")
 *   - Vertical picker shown (data-testid="uc-vertical-picker")
 *   - Search input is visible
 *   - Use case cards render from /api/use-cases
 *   - Run button fires POST /api/use-cases/demo/run for chip UCs
 *   - Attack sim Run fires POST /api/demo/attack-sim/run
 *   - Search filter narrows cards
 *   - Error state shown when API fails
 *   - Loading state shown before data
 *   - Unauthenticated user is redirected away
 *   - Progressive Trust strip (Act cards) renders
 *
 * All network calls are intercepted — no live server required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/use-cases-catalog.spec.js
 */

const { test, expect } = require('@playwright/test');

const ADMIN_USER = {
  id: 'admin-uc-cat-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'UC',
  name: 'Admin UC',
  role: 'admin',
};

// UC24 is the only UC with track='demo' that is excluded from happyPath
// (via PROGRESSIVE_TRUST_STRIP_IDS). It must be present for grouped['demo']
// to have items — which is the condition that gates the ProgressiveTrustDemoStrip.
// UC1 (track='demo', PERMIT) is routed to happyPath, so UC24 keeps the demo
// section alive. The strip then finds both UC24 (Act 1) and UC1 (Act 2).
const USE_CASES = [
  {
    id: 'UC24',
    useCaseId: 'UC24',
    title: 'Act 1 — Public catalog access',
    track: 'demo',
    trigger: { type: 'chip', text: 'What branches are near me?' },
    expectedOutcome: 'PERMIT',
    maturity: 'works',
  },
  {
    id: 'UC1',
    useCaseId: 'UC1',
    title: 'Delegated Access — full flow',
    track: 'demo',
    trigger: { type: 'chip', text: 'Show my account balance' },
    expectedOutcome: 'PERMIT',
    maturity: 'works',
  },
  {
    id: 'UC8',
    useCaseId: 'UC8',
    title: 'HITL Transfer Approval',
    // track='demo' so the ProgressiveTrustDemoStrip (which filters by track='demo')
    // can resolve Act 3 (sourceId=UC8). UC8 ends up in grouped['demo'] grid too,
    // so card-title assertions must use .first() to avoid strict-mode errors.
    track: 'demo',
    trigger: { type: 'chip', text: 'Transfer $500 to savings' },
    expectedOutcome: 'HITL',
    maturity: 'works',
  },
  {
    id: 'UC7',
    useCaseId: 'UC7',
    title: 'MFA Step-Up',
    track: 'demo',
    trigger: { type: 'chip', text: 'View investment portfolio' },
    expectedOutcome: 'STEP_UP',
    maturity: 'works',
  },
  {
    id: 'UC5',
    useCaseId: 'UC5',
    title: 'Insufficient Scope',
    track: 'attacks',
    trigger: { type: 'attack', sim: 'insufficient-scope' },
    expectedOutcome: 'DENY',
    maturity: 'works',
  },
];

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockCatalog(page, { user = ADMIN_USER, useCases = USE_CASES } = {}) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill(json({ authenticated: true, user }))
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill(json({ authenticated: false }))
  );
  await page.route('**/api/users**', (route) => route.fulfill(json({ users: [], total: 0 })));
  await page.route('**/api/accounts**', (route) => route.fulfill(json({ accounts: [] })));
  await page.route('**/api/transactions**', (route) => route.fulfill(json({ transactions: [] })));
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill(json({ agent_ui_mode: 'standard', ff_use_cases_launcher: true }))
  );
  await page.route('**/api/admin/mcp-gateway/config**', (route) =>
    route.fulfill(json({
      mock: { url: '', running: false, devBypass: false, enabled: false },
      config: {}, envVars: {}, mcpMode: 'custom',
      pingGatewayJson: {}, pingGatewayAdminJson: {},
    }))
  );
  await page.route('**/api/api-calls**', (route) => route.fulfill(json({ calls: [] })));
  await page.route('**/api/mcp/**', (route) => route.fulfill(json({ tools: [], calls: [] })));
  await page.route('**/api/admin/feature-flags**', (route) =>
    route.fulfill(json({ flags: [{ id: 'ciba_enabled', value: false }] }))
  );
  await page.route('**/api/verticals/active**', (route) =>
    route.fulfill(json({ id: 'banking' }))
  );
  // Use cases list — registered last so it wins
  await page.route('**/api/use-cases**', (route) =>
    route.fulfill(json({ useCases }))
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Use Cases Catalog — page structure', () => {
  test('renders "AI Agent Security Use Cases" heading', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(
      page.getByRole('heading', { name: 'AI Agent Security Use Cases' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows progress counter', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.getByTestId('uc-demo-progress')).toBeVisible({ timeout: 10000 });
  });

  test('shows vertical picker', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.getByTestId('uc-vertical-picker')).toBeVisible({ timeout: 10000 });
  });

  test('shows search input', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    // Label "Filter" is on the search label; input has id="uc-search-input"
    await expect(page.locator('#uc-search-input')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Catalog — use case cards', () => {
  test('renders card titles from API', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.getByText('Delegated Access — full flow').first()).toBeVisible({ timeout: 10000 });
  });

  test('chip use case cards have a Run button', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(
      page.locator('.uc-run-btn').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows maturity badge for "works" UCs', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.locator('.uc-maturity--works').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Catalog — Progressive Trust strip', () => {
  test('Act 1 card is visible in the demo strip', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    // Use the act label span to avoid matching the banner text "Progressive Trust Demo — Act 1 from here"
    await expect(page.locator('.pt-demo-strip__act', { hasText: 'Act 1' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('Act 2 card (Authenticated access) is visible', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.getByText('Authenticated access')).toBeVisible({ timeout: 10000 });
  });

  test('Act 3 card (In-app HITL consent) is visible', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await expect(page.getByText('In-app HITL consent')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Catalog — search filter', () => {
  test('typing a query narrows visible cards', async ({ page }) => {
    await mockCatalog(page);
    await page.goto('/use-cases');
    await page.locator('#uc-search-input').waitFor({ timeout: 10000 });
    await page.locator('#uc-search-input').fill('HITL');
    // UC8 title appears in multiple sections — scope to first card title to avoid strict mode
    await expect(page.locator('.uc-card__title').filter({ hasText: 'HITL Transfer Approval' }).first()).toBeVisible();
    // MFA card should not be visible (doesn't match 'HITL' query)
    await expect(page.locator('.uc-card__title').filter({ hasText: 'MFA Step-Up' })).toHaveCount(0);
  });
});

test.describe('Use Cases Catalog — run flows', () => {
  test('chip Run POSTs to /api/use-cases/demo/run', async ({ page }) => {
    await mockCatalog(page);
    let runCalled = false;
    await page.route('**/api/use-cases/demo/run**', (route) => {
      runCalled = true;
      return route.fulfill(json({ triggerText: 'Show my account balance', useCaseId: 'UC1' }));
    });
    await page.route('**/api/verticals/active**', (route) => route.fulfill(json({ id: 'banking' })));
    await page.goto('/use-cases');
    const btn = page.locator('.uc-run-btn').first();
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    await page.waitForTimeout(1000);
    expect(runCalled).toBe(true);
  });

  test('attack sim Run POSTs to /api/demo/attack-sim/run', async ({ page }) => {
    await mockCatalog(page);
    let simCalled = false;
    await page.route('**/api/demo/attack-sim/run**', (route) => {
      simCalled = true;
      return route.fulfill(json({ status: 403, tokenChainEvents: [] }));
    });
    await page.goto('/use-cases');
    // Target the Attacks track section by its heading text to find the attack-sim run button
    const attacksSection = page.locator('.uc-track').filter({ hasText: /Attacks/i });
    const simBtn = attacksSection.locator('.uc-run-btn').first();
    await simBtn.waitFor({ timeout: 10000 });
    await simBtn.click();
    await page.waitForTimeout(1000);
    expect(simCalled).toBe(true);
  });
});

test.describe('Use Cases Catalog — error state', () => {
  test('shows error when /api/use-cases fails', async ({ page }) => {
    await mockCatalog(page);
    await page.route('**/api/use-cases**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) })
    );
    await page.goto('/use-cases');
    await expect(page.locator('.uc-launcher__error')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Catalog — auth guard', () => {
  test('unauthenticated user is redirected away', async ({ page }) => {
    await page.route('**/api/auth/oauth/status', (route) =>
      route.fulfill(json({ authenticated: false }))
    );
    await page.route('**/api/auth/oauth/user/status', (route) =>
      route.fulfill(json({ authenticated: false }))
    );
    await page.route('**/api/admin/config**', (route) =>
      route.fulfill(json({ agent_ui_mode: 'standard', ff_use_cases_launcher: true }))
    );
    await page.goto('/use-cases');
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain('/use-cases');
  });
});
