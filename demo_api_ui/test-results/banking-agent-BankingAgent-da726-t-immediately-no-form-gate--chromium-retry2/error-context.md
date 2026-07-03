# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: banking-agent.spec.js >> BankingAgent — Authenticated (customer logged in) >> money-movement chip closes the popout immediately (no form gate)
- Location: tests/e2e/banking-agent.spec.js:538:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.banking-agent-panel')
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('.banking-agent-panel')

```

# Test source

```ts
  229 |     route.fulfill({ status: 200, contentType: 'application/json',
  230 |       body: JSON.stringify({}) })
  231 |   );
  232 |   await page.route('**/api/verticals/**', (route) =>
  233 |     route.fulfill({ status: 200, contentType: 'application/json',
  234 |       body: JSON.stringify({}) })
  235 |   );
  236 |   await page.route('**/api/health/**', (route) =>
  237 |     route.fulfill({ status: 200, contentType: 'application/json',
  238 |       body: JSON.stringify({ status: 'ok' }) })
  239 |   );
  240 |   await page.route('**/ws**', (route) => route.abort());
  241 |   await page.route('**/mcp**', (route) => route.abort());
  242 | }
  243 | 
  244 | /**
  245 |  * Stub /api/mcp/tool to return a given result for one tool call.
  246 |  */
  247 | async function mockMcpTool(page, result) {
  248 |   await page.route('**/api/mcp/tool', (route) =>
  249 |     route.fulfill({ status: 200, contentType: 'application/json',
  250 |       body: JSON.stringify({ result }) })
  251 |   );
  252 | }
  253 | 
  254 | /**
  255 |  * Stub /api/mcp/tool to return a 502 (MCP server unavailable).
  256 |  */
  257 | async function mockMcpToolError(page) {
  258 |   await page.route('**/api/mcp/tool', (route) =>
  259 |     route.fulfill({ status: 502, contentType: 'application/json',
  260 |       body: JSON.stringify({ message: 'mcp_error: WebSocket connection failed' }) })
  261 |   );
  262 | }
  263 | 
  264 | /**
  265 |  * Post-Phase-4 the single BankingAgent renders inline on /dashboard (middle
  266 |  * placement default) and floating (via FAB) on /admin. Banking actions moved
  267 |  * out of the old `.ba-left-col` into an **Actions popout**: a header trigger
  268 |  * (`button.ba-actions-trigger`, text "Actions ▾") opens `.ba-actions-popout`,
  269 |  * whose `.ba-popout-section` groups (collapsed by default) hold
  270 |  * `button.ba-popout-list-item` rows. This opens the popout idempotently,
  271 |  * expands any collapsed section, and returns the matching action row.
  272 |  *
  273 |  * @returns {import('@playwright/test').Locator} the `.ba-popout-list-item`
  274 |  *   whose `.ba-popout-item-name` matches `namePattern`.
  275 |  */
  276 | async function agentPanelButton(page, namePattern) {
  277 |   const popout = page.locator('.ba-actions-popout');
  278 |   if (!(await popout.isVisible().catch(() => false))) {
  279 |     await page
  280 |       .locator('button.ba-actions-trigger', { hasText: /Actions/i })
  281 |       .first()
  282 |       .click();
  283 |     await expect(popout).toBeVisible({ timeout: 10000 });
  284 |   }
  285 |   // Expand every collapsed section so the target row is in the DOM regardless
  286 |   // of which group it lives in (Account / Transaction / etc.).
  287 |   const sections = popout.locator('.ba-popout-section');
  288 |   const sectionCount = await sections.count();
  289 |   for (let i = 0; i < sectionCount; i++) {
  290 |     const toggle = sections.nth(i).locator('.ba-popout-section-toggle');
  291 |     if (await toggle.count()) {
  292 |       const label = (await toggle.first().textContent()) || '';
  293 |       if (label.trim().startsWith('▶')) {
  294 |         await toggle.first().click();
  295 |       }
  296 |     }
  297 |   }
  298 |   return popout
  299 |     .locator('button.ba-popout-list-item')
  300 |     .filter({
  301 |       has: page.locator('.ba-popout-item-name', { hasText: namePattern }),
  302 |     });
  303 | }
  304 | 
  305 | /**
  306 |  * Wait for the single BankingAgent panel to be ready.
  307 |  *
  308 |  * - Customer `/dashboard`: middle placement is the default — the agent
  309 |  *   auto-renders inline (portaled into `.ud-dashboard-inline-agent-host`),
  310 |  *   there is NO floating FAB to click.
  311 |  * - Admin `/admin`: Dashboard.js has no inline host, so the agent stays in
  312 |  *   floating chrome behind a `.banking-agent-fab`; click it if present.
  313 |  */
  314 | async function ensureAgentReady(page) {
  315 |   const panel = page.locator('.banking-agent-panel');
  316 |   if (await panel.isVisible().catch(() => false)) return;
  317 |   // Race the inline panel (customer /dashboard auto-renders) against the
  318 |   // floating FAB (admin /admin needs a click). Whichever resolves first wins —
  319 |   // /admin (Dashboard.js) is heavy, so the FAB can take several seconds to
  320 |   // mount; waiting for it explicitly avoids the "no panel, no FAB yet" gap.
  321 |   const fab = page.locator('.banking-agent-fab');
  322 |   await Promise.race([
  323 |     panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  324 |     fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  325 |   ]);
  326 |   if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
  327 |     await fab.first().click();
  328 |   }
> 329 |   await expect(panel).toBeVisible({ timeout: 20000 });
      |                       ^ Error: expect(locator).toBeVisible() failed
  330 | }
  331 | 
  332 | // ─── UNAUTHENTICATED LANDING (no floating agent) ───────────────────────────────
  333 | 
  334 | test.describe('BankingAgent — unauthenticated landing', () => {
  335 |   test.beforeEach(async ({ page }) => {
  336 |     await page.addInitScript(() => {
  337 |       try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  338 |     });
  339 |   });
  340 | 
  341 |   test('landing offers the guest agent FAB but does not auto-open a panel', async ({ page }) => {
  342 |     await mockUnauthenticated(page);
  343 |     await page.goto('/');
  344 |     // Post-Phase-4 the public marketing landing surfaces a guest agent FAB
  345 |     // (marketingAgentSurface), but the agent panel must NOT auto-render before
  346 |     // any interaction — it stays unobtrusive until the visitor opens it.
  347 |     await expect(page.locator('.banking-agent-fab')).toBeVisible({ timeout: 20000 });
  348 |     await expect(page.locator('.banking-agent-panel')).toHaveCount(0);
  349 |   });
  350 | });
  351 | 
  352 | // ─── AUTHENTICATED tests ───────────────────────────────────────────────────────
  353 | 
  354 | test.describe('BankingAgent — Authenticated (customer logged in)', () => {
  355 |   test.beforeEach(async ({ page }) => {
  356 |     await page.addInitScript(() => {
  357 |       try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  358 |     });
  359 |   });
  360 | 
  361 |   test('agent renders inline on the user dashboard (no floating FAB)', async ({ page }) => {
  362 |     await mockAuthenticatedCustomer(page);
  363 |     await mockMcpTool(page, SAMPLE_ACCOUNTS);
  364 |     await page.goto('/dashboard');
  365 |     // Phase 4: middle placement is the default — the single agent auto-renders
  366 |     // inline inside the dashboard's middle column. There is no floating FAB.
  367 |     await expect(
  368 |       page.locator('.ud-dashboard-inline-agent-host .banking-agent-panel.ba-mode-inline')
  369 |     ).toBeVisible({ timeout: 20000 });
  370 |     await expect(page.locator('.banking-agent-fab')).toHaveCount(0);
  371 |   });
  372 | 
  373 |   test('inline agent panel uses split-column chrome on /dashboard', async ({ page }) => {
  374 |     await mockAuthenticatedCustomer(page);
  375 |     await page.goto('/dashboard');
  376 |     await ensureAgentReady(page);
  377 |     const panel = page.locator('.banking-agent-panel');
  378 |     await expect(panel).toHaveClass(/ba-mode-inline/);
  379 |     await expect(panel).toHaveClass(/ba-split-column/);
  380 |   });
  381 | 
  382 |   test('panel shows the inline assistant title on /dashboard', async ({ page }) => {
  383 |     await mockAuthenticatedCustomer(page);
  384 |     await page.goto('/dashboard');
  385 |     await ensureAgentReady(page);
  386 |     // Inline split-column chrome renders "{Brand} Assistant".
  387 |     // The brand name is theme-driven so match the suffix only.
  388 |     await expect(page.locator('.ba-title')).toContainText('Assistant');
  389 |   });
  390 | 
  391 |   test('subtitle shows customer role badge when logged in', async ({ page }) => {
  392 |     await mockAuthenticatedCustomer(page);
  393 |     await page.goto('/dashboard');
  394 |     await ensureAgentReady(page);
  395 |     await expect(page.locator('.ba-subtitle')).toContainText('Customer');
  396 |     await expect(page.locator('.ba-subtitle')).toContainText('Test');
  397 |   });
  398 | 
  399 |   test('welcome message area is shown for logged-in user', async ({ page }) => {
  400 |     await mockAuthenticatedCustomer(page);
  401 |     await page.goto('/dashboard');
  402 |     await ensureAgentReady(page);
  403 |     const messages = page.locator('.banking-agent-messages');
  404 |     await expect(messages).toBeVisible();
  405 |   });
  406 | 
  407 |   test('inline chrome surfaces a session sign-out control for the customer', async ({ page }) => {
  408 |     await mockAuthenticatedCustomer(page);
  409 |     await page.goto('/dashboard');
  410 |     await ensureAgentReady(page);
  411 |     // The old `.ba-left-col` "My Dashboard" nav button does not exist in inline
  412 |     // split-column chrome (the agent IS the dashboard surface there). The
  413 |     // equivalent signed-in affordance is the split-column header sign-out.
  414 |     await expect(
  415 |       page.locator('.banking-agent-panel .ba-header-signout', { hasText: 'Sign out' })
  416 |     ).toBeVisible();
  417 |   });
  418 | 
  419 |   test('panel lists core banking actions in the Actions popout', async ({ page }) => {
  420 |     await mockAuthenticatedCustomer(page);
  421 |     await page.goto('/dashboard');
  422 |     await ensureAgentReady(page);
  423 |     for (const label of [
  424 |       'My Accounts',
  425 |       'Recent Transactions',
  426 |       'Check Balance',
  427 |       'Deposit',
  428 |       'Withdraw',
  429 |       'Transfer',
```