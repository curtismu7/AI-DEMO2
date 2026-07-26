/**
 * @file use-cases-live.spec.js
 * @description Playwright E2E smoke for the Live Use-Case Workbench (/use-cases/live).
 *
 * Covers:
 *   - Page renders "Use Cases / Live Workbench" header
 *   - "Demo script" drawer heading visible
 *   - Use case cards render from /api/use-cases
 *   - Cards have Run buttons
 *   - Search filter narrows the card list
 *   - Banking glance panel shows Checking / Policy / Recent
 *   - Running a chip use case POSTs to /api/use-cases/demo/run
 *   - Running an attack sim POSTs to /api/demo/attack-sim/run
 *   - Error state shown when /api/use-cases fails
 *   - Unauthenticated user is redirected away
 *
 * All network calls are intercepted — no live server required.
 *
 * Run:
 *   cd demo_api_ui
 *   npx playwright test tests/e2e/use-cases-live.spec.js
 */

const { test, expect } = require('@playwright/test');

const ADMIN_USER = {
  id: 'admin-uc-id',
  username: 'admin',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'UC',
  name: 'Admin UC',
  role: 'admin',
};

// Use real DEMO_PRIMARY_USE_CASE_IDS so cards land in primaryDemo (visible, not collapsed)
const USE_CASES = [
  {
    id: 'UC8',
    useCaseId: 'UC8',
    title: 'HITL Transfer Approval',
    track: 'hitl',
    trigger: { type: 'chip', text: 'Transfer $500 to savings' },
    expectedOutcome: 'HITL',
  },
  {
    id: 'UC7',
    useCaseId: 'UC7',
    title: 'Step-Up MFA',
    track: 'controls',
    trigger: { type: 'chip', text: 'View investment portfolio' },
    expectedOutcome: 'STEP_UP',
  },
  {
    // Non-primary ID → lands in groupedOther with track='attacks' (open by default)
    id: 'uc-attack-rogue',
    useCaseId: 'rogue-actor',
    title: 'Rogue Actor Attack',
    track: 'attacks',
    trigger: { type: 'attack', sim: 'rogue-actor' },
    expectedOutcome: 'DENY',
  },
];

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockUseCasesLive(page, { user = ADMIN_USER, useCases = USE_CASES } = {}) {
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
    route.fulfill(
      json({
        mock: { url: '', running: false, devBypass: false, enabled: false },
        config: {},
        envVars: {},
        mcpMode: 'custom',
        pingGatewayJson: {},
        pingGatewayAdminJson: {},
      })
    )
  );
  await page.route('**/api/api-calls**', (route) => route.fulfill(json({ calls: [] })));
  await page.route('**/api/mcp/**', (route) => route.fulfill(json({ tools: [], calls: [] })));
  await page.route('**/api/verticals/active**', (route) => route.fulfill(json({ id: 'banking' })));
  // Use cases list — registered last
  await page.route('**/api/use-cases**', (route) =>
    route.fulfill(json({ useCases }))
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Use Cases Live — page structure', () => {
  test('renders "Use Cases" and "Live Workbench" in the topbar', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    // Scope to the page topbar to avoid sidebar nav and topnav button matches
    await expect(page.locator('.luw-topbar__title')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('/ Live Workbench')).toBeVisible({ timeout: 10000 });
  });

  test('shows "Demo script" drawer heading', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText('Demo script')).toBeVisible({ timeout: 10000 });
  });

  test('shows "Pick a step" sub-heading', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText(/Pick a step/)).toBeVisible({ timeout: 10000 });
  });

  test('filter input has placeholder "Filter use cases…"', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(
      page.getByPlaceholder('Filter use cases…')
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Live — use case cards', () => {
  test('renders use case card titles from the API', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText('HITL Transfer Approval')).toBeVisible({ timeout: 10000 });
  });

  test('chip use case cards have a "Run in agent →" button', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(
      page.getByRole('button', { name: 'Run in agent →' }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('attack sim cards have a "Run sim →" button', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    // Scope to button element (card div also has role=button — strict mode fix)
    await expect(
      page.locator('button.luw-card__run', { hasText: 'Run sim →' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('non-runnable cards show "Not runnable in live workbench" hint', async ({ page }) => {
    const withNonRunnable = [
      ...USE_CASES,
      {
        // Non-primary, track='attacks' (open by default), sim NOT in RUNNABLE_SIMS → canRun=false
        id: 'uc-no-run',
        useCaseId: 'no-run',
        title: 'Non-Runnable Attack',
        track: 'attacks',
        trigger: { type: 'attack', sim: 'not-a-runnable-sim' },
        expectedOutcome: 'DENY',
      },
    ];
    await mockUseCasesLive(page, { useCases: withNonRunnable });
    await page.goto('/use-cases/live');
    await expect(page.getByText('Not runnable in live workbench')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Live — search filter', () => {
  test('typing a query hides non-matching cards', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await page.getByPlaceholder('Filter use cases…').waitFor({ timeout: 10000 });
    await page.getByPlaceholder('Filter use cases…').fill('HITL');
    await expect(page.getByText('HITL Transfer Approval')).toBeVisible();
    await expect(page.getByText('Step-Up MFA')).not.toBeVisible();
  });

  test('no matches shows empty-state message', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await page.getByPlaceholder('Filter use cases…').waitFor({ timeout: 10000 });
    await page.getByPlaceholder('Filter use cases…').fill('zzz-no-match-zzz');
    await expect(page.getByText(/No use cases match/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Use Cases Live — banking glance panel', () => {
  test('glance panel shows Checking label', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText('Checking')).toBeVisible({ timeout: 10000 });
  });

  test('glance panel shows Policy label', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    // Scope to the glance panel to avoid ambiguity with card metadata
    await expect(page.locator('.luw-glance').getByText('Policy')).toBeVisible({ timeout: 10000 });
  });

  test('glance panel shows Recent label', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText('Recent')).toBeVisible({ timeout: 10000 });
  });

  test('initial Checking value is $4,820.00', async ({ page }) => {
    await mockUseCasesLive(page);
    await page.goto('/use-cases/live');
    await expect(page.getByText('$4,820.00')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Live — run flows', () => {
  test('Run in agent POSTs to /api/use-cases/demo/run', async ({ page }) => {
    await mockUseCasesLive(page);
    let runCalled = false;
    await page.route('**/api/use-cases/demo/run**', (route) => {
      runCalled = true;
      return route.fulfill(json({ triggerText: 'Transfer $500', useCaseId: 'hitl-transfer' }));
    });
    await page.goto('/use-cases/live');
    // Scope to button.luw-card__run — card div also has role=button and contains same text
    const btn = page.locator('button.luw-card__run', { hasText: 'Run in agent →' }).first();
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    await page.waitForTimeout(1000);
    expect(runCalled).toBe(true);
  });

  test('Run sim POSTs to /api/demo/attack-sim/run', async ({ page }) => {
    await mockUseCasesLive(page);
    let simCalled = false;
    await page.route('**/api/demo/attack-sim/run**', (route) => {
      simCalled = true;
      return route.fulfill(json({ status: 403, tokenChainEvents: [] }));
    });
    await page.goto('/use-cases/live');
    // Scope to button element (card div also has role=button — strict mode fix)
    const btn = page.locator('button.luw-card__run', { hasText: 'Run sim →' });
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    await page.waitForTimeout(1000);
    expect(simCalled).toBe(true);
  });
});

test.describe('Use Cases Live — error state', () => {
  test('shows error message when /api/use-cases fails', async ({ page }) => {
    await mockUseCasesLive(page, { useCases: [] });
    // Override with a 500
    await page.route('**/api/use-cases**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) })
    );
    await page.goto('/use-cases/live');
    // Either an error text or empty state shows up
    const errorOrEmpty = page.locator('.luw-drawer__empty');
    await expect(errorOrEmpty).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Use Cases Live — auth guard', () => {
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
    await page.goto('/use-cases/live');
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain('/use-cases/live');
  });
});
