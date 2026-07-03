# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chip-themes.spec.js >> Chip labels per vertical theme >> Vertical: workforce >> [workforce] clicking "Request History" (key=transactions) sends invariant message "transactions"
- Location: tests/e2e/chip-themes.spec.js:235:9

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/dashboard
Call log:
  - navigating to "https://api.ping.demo:4000/dashboard", waiting until "load"

```

# Test source

```ts
  164 | 
  165 |   if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
  166 |     await fab.first().click();
  167 |   }
  168 |   await expect(panel).toBeVisible({ timeout: 20000 });
  169 | }
  170 | 
  171 | /**
  172 |  * Open the Actions popout if not already open, then navigate to the
  173 |  * BankingChips area (Quick Actions section).
  174 |  *
  175 |  * The chips live inside `.banking-chips-content` which is rendered inside
  176 |  * the agent panel — it may be directly visible or inside the Actions popout
  177 |  * depending on the agent chrome mode.
  178 |  */
  179 | async function openChipsPanel(page) {
  180 |   // Try the Actions trigger first (popout-mode chrome)
  181 |   const trigger = page.locator('button.ba-actions-trigger').first();
  182 |   if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
  183 |     const popout = page.locator('.ba-actions-popout');
  184 |     if (!(await popout.isVisible().catch(() => false))) {
  185 |       await trigger.click();
  186 |       await expect(popout).toBeVisible({ timeout: 10000 });
  187 |     }
  188 |   }
  189 | }
  190 | 
  191 | // ── Tests ──────────────────────────────────────────────────────────────────────
  192 | 
  193 | test.describe('Chip labels per vertical theme', () => {
  194 | 
  195 |   for (const verticalId of VERTICALS) {
  196 |     const manifest = loadVertical(verticalId);
  197 |     const manifestChips = (manifest.dashboard && manifest.dashboard.chips) || [];
  198 | 
  199 |     // Build expected label map from the manifest
  200 |     const expectedLabels = {};
  201 |     for (const c of manifestChips) {
  202 |       if (INVARIANT_MESSAGES[c.key] !== undefined) {
  203 |         expectedLabels[c.key] = c.label;
  204 |       }
  205 |     }
  206 | 
  207 |     test.describe(`Vertical: ${verticalId}`, () => {
  208 | 
  209 |       test(`[${verticalId}] Quick Action chips show manifest labels`, async ({ page }) => {
  210 |         await mockCustomerWithVertical(page, manifest);
  211 |         await page.goto('/dashboard');
  212 |         await ensureAgentReady(page);
  213 |         await openChipsPanel(page);
  214 | 
  215 |         // The BankingChips "Quick Actions" section renders heuristic chips
  216 |         const chipsSection = page.locator('.banking-chips-dropdown__section')
  217 |           .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
  218 |         await expect(chipsSection).toBeVisible({ timeout: 15000 });
  219 | 
  220 |         for (const [key, label] of Object.entries(expectedLabels)) {
  221 |           const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label });
  222 |           await expect(
  223 |             chipBtn.first(),
  224 |             `[${verticalId}] chip key="${key}" should have label "${label}"`,
  225 |           ).toBeVisible({ timeout: 10000 });
  226 |         }
  227 |       });
  228 | 
  229 |       // For each chip key with a known invariant message, verify the click
  230 |       // sends the invariant routing message (not the display label).
  231 |       for (const [key, invariantMessage] of Object.entries(INVARIANT_MESSAGES)) {
  232 |         const label = expectedLabels[key];
  233 |         if (!label) continue; // vertical doesn't define this chip key — skip
  234 | 
  235 |         test(`[${verticalId}] clicking "${label}" (key=${key}) sends invariant message "${invariantMessage}"`, async ({ page }) => {
  236 |           const nlRequests = [];
  237 | 
  238 |           await mockCustomerWithVertical(page, manifest);
  239 | 
  240 |           // Intercept NL calls — capture request body before fulfilling
  241 |           await page.route('**/api/demo-agent/nl', async (route) => {
  242 |             const body = route.request().postDataJSON();
  243 |             nlRequests.push(body);
  244 |             await route.fulfill({
  245 |               status: 200,
  246 |               contentType: 'application/json',
  247 |               body: JSON.stringify({
  248 |                 source: 'heuristic',
  249 |                 kind: 'banking',
  250 |                 action: 'get_my_accounts',
  251 |                 result: { accounts: [] },
  252 |                 executed: true,
  253 |                 tokenEvents: [],
  254 |               }),
  255 |             });
  256 |           });
  257 | 
  258 |           // Also stub MCP tool so any follow-up MCP call doesn't error
  259 |           await page.route('**/api/mcp/tool', (route) =>
  260 |             route.fulfill({ status: 200, contentType: 'application/json',
  261 |               body: JSON.stringify({ result: { accounts: [] } }) }),
  262 |           );
  263 | 
> 264 |           await page.goto('/dashboard');
      |                      ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/dashboard
  265 |           await ensureAgentReady(page);
  266 |           await openChipsPanel(page);
  267 | 
  268 |           const chipsSection = page.locator('.banking-chips-dropdown__section')
  269 |             .filter({ has: page.locator('.banking-chips-dropdown__label', { hasText: 'Quick Actions' }) });
  270 |           await expect(chipsSection).toBeVisible({ timeout: 15000 });
  271 | 
  272 |           const chipBtn = chipsSection.locator('.banking-chips-dropdown__button', { hasText: label }).first();
  273 |           await expect(chipBtn).toBeVisible({ timeout: 10000 });
  274 |           await chipBtn.click();
  275 | 
  276 |           // Wait for the NL request to arrive
  277 |           await page.waitForTimeout(2000);
  278 | 
  279 |           expect(
  280 |             nlRequests.length,
  281 |             `[${verticalId}] clicking chip "${label}" should POST to /api/demo-agent/nl`,
  282 |           ).toBeGreaterThan(0);
  283 | 
  284 |           const lastReq = nlRequests[nlRequests.length - 1];
  285 |           expect(
  286 |             lastReq.message,
  287 |             `[${verticalId}] chip key="${key}" must send invariant message (not display label)`,
  288 |           ).toBe(invariantMessage);
  289 |         });
  290 |       }
  291 |     });
  292 |   }
  293 | });
  294 | 
```