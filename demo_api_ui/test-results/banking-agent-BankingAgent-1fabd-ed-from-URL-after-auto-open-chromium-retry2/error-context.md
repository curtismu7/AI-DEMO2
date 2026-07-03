# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: banking-agent.spec.js >> BankingAgent — auto-open via ?oauth=success >> ?oauth=success param is removed from URL after auto-open
- Location: tests/e2e/banking-agent.spec.js:649:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.banking-agent-panel')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('.banking-agent-panel')

```

# Test source

```ts
  552 |   // ── Error handling ──
  553 | 
  554 |   test('MCP 502 surfaces a friendly "server unreachable" toast', async ({ page }) => {
  555 |     await mockAuthenticatedCustomer(page);
  556 |     await mockMcpToolError(page);
  557 |     await page.goto('/dashboard');
  558 |     await ensureAgentReady(page);
  559 |     const myAccounts = await agentPanelButton(page, /^My Accounts$/);
  560 |     await myAccounts.click();
  561 | 
  562 |     // Post-Phase-4 the conversation pane renders only user/assistant turns;
  563 |     // connection failures surface as a react-toastify error toast, not chat
  564 |     // text. Scope to the error variant (an in-progress info toast coexists).
  565 |     const toast = page.locator('.Toastify__toast--error');
  566 |     await expect(toast).toContainText(/unreachable|not reachable|server connection/i);
  567 |     // No raw stack trace leaks into the user-facing message.
  568 |     await expect(toast).not.toContainText('at Object.');
  569 |   });
  570 | 
  571 |   test('login action buttons are NOT shown when user is authenticated', async ({ page }) => {
  572 |     await mockAuthenticatedCustomer(page);
  573 |     await page.goto('/dashboard');
  574 |     await ensureAgentReady(page);
  575 |     // The popout / panel must not surface a sign-in affordance for an
  576 |     // already-authenticated customer.
  577 |     const panel = page.locator('.banking-agent-panel');
  578 |     await expect(panel).not.toContainText('Admin Sign In');
  579 |     await expect(panel).not.toContainText('Customer Sign In');
  580 |   });
  581 | });
  582 | 
  583 | // ─── ADMIN tests ───────────────────────────────────────────────────────────────
  584 | 
  585 | test.describe('BankingAgent — Authenticated (admin logged in)', () => {
  586 |   test.beforeEach(async ({ page }) => {
  587 |     await page.addInitScript(() => {
  588 |       try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  589 |     });
  590 |   });
  591 | 
  592 |   // Admin uses Dashboard.js (no inline middle host), so the single agent stays
  593 |   // in floating chrome behind a `.banking-agent-fab`. ensureAgentReady() clicks
  594 |   // the FAB when present, then waits for the panel.
  595 | 
  596 |   test('agent panel opens from the FAB on /admin', async ({ page }) => {
  597 |     await mockAuthenticatedAdmin(page);
  598 |     await page.goto('/admin');
  599 |     await expect(page.locator('.banking-agent-fab')).toBeVisible({ timeout: 20000 });
  600 |     await ensureAgentReady(page);
  601 |     // Admin float chrome renders "{Brand} AI Agent".
  602 |     // The brand name is theme-driven so match the suffix only.
  603 |     await expect(page.locator('.ba-title')).toContainText('Agent');
  604 |   });
  605 | 
  606 |   test('subtitle shows admin role badge for admin user', async ({ page }) => {
  607 |     await mockAuthenticatedAdmin(page);
  608 |     await page.goto('/admin');
  609 |     await ensureAgentReady(page);
  610 |     await expect(page.locator('.ba-subtitle')).toContainText('Admin');
  611 |     await expect(page.locator('.ba-subtitle')).toContainText('Alice');
  612 |   });
  613 | 
  614 |   test('dashboard nav button shows "Admin Dashboard" for admin', async ({ page }) => {
  615 |     await mockAuthenticatedAdmin(page);
  616 |     await page.goto('/admin');
  617 |     await ensureAgentReady(page);
  618 |     await expect(
  619 |       page.locator('.banking-agent-panel .ba-left-auth-btn.primary', { hasText: 'Admin Dashboard' })
  620 |     ).toBeVisible();
  621 |   });
  622 | 
  623 |   test('admin-only actions are present in the Actions popout', async ({ page }) => {
  624 |     await mockAuthenticatedAdmin(page);
  625 |     await page.goto('/admin');
  626 |     await ensureAgentReady(page);
  627 |     // Old admin "suggestions" (e.g. "Show all customer accounts") were replaced
  628 |     // by admin-scoped popout actions; assert an admin-only entry is reachable.
  629 |     const row = await agentPanelButton(page, /Query User by Email/i);
  630 |     await expect(row).toHaveCount(1);
  631 |   });
  632 | });
  633 | 
  634 | // ─── AUTO-OPEN via ?oauth=success ─────────────────────────────────────────────
  635 | 
  636 | test.describe('BankingAgent — auto-open via ?oauth=success', () => {
  637 |   test.beforeEach(async ({ page }) => {
  638 |     await page.addInitScript(() => {
  639 |       try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  640 |     });
  641 |   });
  642 | 
  643 |   test('panel opens automatically when URL contains ?oauth=success', async ({ page }) => {
  644 |     await mockAuthenticatedCustomer(page);
  645 |     await page.goto('/dashboard?oauth=success');
  646 |     await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });
  647 |   });
  648 | 
  649 |   test('?oauth=success param is removed from URL after auto-open', async ({ page }) => {
  650 |     await mockAuthenticatedCustomer(page);
  651 |     await page.goto('/dashboard?oauth=success');
> 652 |     await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });
      |                                                        ^ Error: expect(locator).toBeVisible() failed
  653 |     await expect(page).not.toHaveURL(/oauth=success/);
  654 |   });
  655 | });
  656 | 
```