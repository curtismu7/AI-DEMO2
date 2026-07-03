# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-legacy-bottom-no-duplicate.spec.js >> legacy "bottom" placement → single agent, accounts auto-load renders once
- Location: tests/e2e/agent-legacy-bottom-no-duplicate.spec.js:102:1

# Error details

```
Error: exactly one BankingAgent panel

expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0
```

# Test source

```ts
  10  |  *
  11  |  *   Phase 4b-4d retired 'bottom' and consolidated to a single instance
  12  |  *   (middle + float). AgentUiModeContext.readState() now coerces a persisted
  13  |  *   'bottom' to {placement:'middle'} (one autoLoadedRef → one bubble).
  14  |  *
  15  |  *   This test locks that in: with the legacy value set, there must be
  16  |  *   exactly ONE agent instance and the "Your Accounts" auto-load bubble
  17  |  *   must appear exactly ONCE.
  18  |  *
  19  |  *   All API calls intercepted — no live server required.
  20  |  */
  21  | 
  22  | const { test, expect } = require('@playwright/test');
  23  | 
  24  | const CUSTOMER_USER = {
  25  |   id: 'user-123',
  26  |   username: 'testuser',
  27  |   email: 'testuser@bank.com',
  28  |   firstName: 'Test',
  29  |   lastName: 'User',
  30  |   name: 'Test User',
  31  |   role: 'customer',
  32  | };
  33  | 
  34  | const SAMPLE_ACCOUNTS = {
  35  |   accounts: [
  36  |     { id: 'acc_001', account_number: 'CHK-001', account_type: 'checking', name: 'Checking Account', balance: 1500.0 },
  37  |     { id: 'acc_002', account_number: 'SAV-002', account_type: 'savings', name: 'Savings Account', balance: 8200.5 },
  38  |   ],
  39  | };
  40  | 
  41  | test.beforeEach(async ({ page }) => {
  42  |   await page.addInitScript(() => {
  43  |     try {
  44  |       localStorage.removeItem('userLoggedOut');
  45  |       // The bug trigger: a persisted RETIRED 'bottom' placement from an
  46  |       // older build. Must coerce to a single middle instance, not spawn two.
  47  |       localStorage.setItem(
  48  |         'banking_agent_ui_v2',
  49  |         JSON.stringify({ placement: 'bottom', fab: true })
  50  |       );
  51  |     } catch (_) {}
  52  |   });
  53  | });
  54  | 
  55  | async function mockAuthenticatedCustomer(page) {
  56  |   await page.route('**/api/auth/oauth/status', (route) =>
  57  |     route.fulfill({ status: 200, contentType: 'application/json',
  58  |       body: JSON.stringify({ authenticated: false, user: null }) }));
  59  |   await page.route('**/api/auth/oauth/user/status', (route) =>
  60  |     route.fulfill({ status: 200, contentType: 'application/json',
  61  |       body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }));
  62  |   await page.route('**/api/auth/session**', (route) =>
  63  |     route.fulfill({ status: 200, contentType: 'application/json',
  64  |       body: JSON.stringify({ authenticated: true, user: CUSTOMER_USER }) }));
  65  |   await page.route('**/api/accounts**', (route) =>
  66  |     route.fulfill({ status: 200, contentType: 'application/json',
  67  |       body: JSON.stringify(SAMPLE_ACCOUNTS) }));
  68  |   await page.route('**/api/transactions**', (route) =>
  69  |     route.fulfill({ status: 200, contentType: 'application/json',
  70  |       body: JSON.stringify({ transactions: [] }) }));
  71  |   await page.route('**/api/config/vertical**', (route) =>
  72  |     route.fulfill({ status: 200, contentType: 'application/json',
  73  |       body: JSON.stringify({ manifest: null }) }));
  74  |   await page.route('**/api/admin/config**', (route) =>
  75  |     route.fulfill({ status: 200, contentType: 'application/json',
  76  |       body: JSON.stringify({ config: {} }) }));
  77  |   await page.route('**/api/admin/feature-flags**', (route) =>
  78  |     route.fulfill({ status: 200, contentType: 'application/json',
  79  |       body: JSON.stringify({ flags: [] }) }));
  80  |   await page.route('**/api/tokens/session-preview**', (route) =>
  81  |     route.fulfill({ status: 200, contentType: 'application/json',
  82  |       body: JSON.stringify({ tokenEvents: [] }) }));
  83  |   await page.route('**/api/token-chain**', (route) =>
  84  |     route.fulfill({ status: 200, contentType: 'application/json',
  85  |       body: JSON.stringify({ tokenEvents: [] }) }));
  86  |   await page.route('**/api/admin/app-events**', (route) =>
  87  |     route.fulfill({ status: 201, contentType: 'application/json',
  88  |       body: JSON.stringify({ ok: true }) }));
  89  |   await page.route('**/api/pingone-test/config**', (route) =>
  90  |     route.fulfill({ status: 200, contentType: 'application/json',
  91  |       body: JSON.stringify({}) }));
  92  |   await page.route('**/api/verticals/**', (route) =>
  93  |     route.fulfill({ status: 200, contentType: 'application/json',
  94  |       body: JSON.stringify({}) }));
  95  |   await page.route('**/api/health/**', (route) =>
  96  |     route.fulfill({ status: 200, contentType: 'application/json',
  97  |       body: JSON.stringify({ status: 'ok' }) }));
  98  |   await page.route('**/ws**', (route) => route.abort());
  99  |   await page.route('**/mcp**', (route) => route.abort());
  100 | }
  101 | 
  102 | test('legacy "bottom" placement → single agent, accounts auto-load renders once', async ({ page }) => {
  103 |   await mockAuthenticatedCustomer(page);
  104 |   await page.goto('/dashboard');
  105 | 
  106 |   // Single-instance guard: the retired 'bottom' value must not spawn two
  107 |   // BankingAgent components (the root cause of the duplicate render).
  108 |   await page.waitForTimeout(3000);
  109 |   expect(await page.locator('.banking-agent-panel').count(),
> 110 |     'exactly one BankingAgent panel').toBe(1);
      |                                       ^ Error: exactly one BankingAgent panel
  111 |   expect(await page.locator('.ba-input').count(),
  112 |     'exactly one chat input').toBe(1);
  113 | 
  114 |   // Open the panel. Middle placement collapses to an "Open AI Banking
  115 |   // Assistant" control; float uses .banking-agent-fab. Try both.
  116 |   const openBtn = page.getByRole('button', { name: /Open AI Banking Assistant/i });
  117 |   if (await openBtn.count()) {
  118 |     await openBtn.first().click();
  119 |   } else {
  120 |     const fab = page.locator('.banking-agent-fab');
  121 |     if (await fab.count()) await fab.first().click();
  122 |   }
  123 | 
  124 |   // The welcome greeting must appear exactly once (single instance — no duplicate bubble).
  125 |   await expect(page.locator('.banking-agent-messages').first())
  126 |     .toContainText("I'm your AI assistant", { timeout: 20000 });
  127 |   await page.waitForTimeout(1500);
  128 | 
  129 |   const greetingBubbles = page.locator('.banking-agent-msg.assistant', { hasText: "I'm your AI assistant" });
  130 |   expect(await greetingBubbles.count(),
  131 |     'welcome greeting renders exactly once (no duplicate panel)').toBe(1);
  132 | });
  133 | 
```