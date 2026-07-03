# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: token-exchange-tester.spec.js >> Token Exchange Tester Page >> custom audience can be entered
- Location: tests/e2e/token-exchange-tester.spec.js:50:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/
Call log:
  - navigating to "https://api.ping.demo:4000/", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | 
  3  | test.describe('Token Exchange Tester Page', () => {
  4  |   test.beforeEach(async ({ page, context }) => {
  5  |     // Set auth cookies if needed - adjust based on your auth setup
> 6  |     await page.goto('https://api.ping.demo:4000');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/
  7  |     // Wait for potential redirects to settle
  8  |     await page.waitForLoadState('domcontentloaded');
  9  |   });
  10 | 
  11 |   test('page loads with form when user is logged in', async ({ page }) => {
  12 |     await page.goto('https://api.ping.demo:4000/token-exchange-tester');
  13 | 
  14 |     // Verify page title
  15 |     await expect(page.locator('h1')).toContainText('RFC 8693 Token Exchange Tester');
  16 | 
  17 |     // Verify form elements exist
  18 |     await expect(page.locator('select')).toBeTruthy();
  19 |     await expect(page.locator('input[id="scopes"]')).toBeTruthy();
  20 |     await expect(page.locator('button:has-text("Exchange Token")')).toBeTruthy();
  21 |   });
  22 | 
  23 |   test('form has default values pre-populated', async ({ page }) => {
  24 |     await page.goto('https://api.ping.demo:4000/token-exchange-tester');
  25 | 
  26 |     // Check default audience
  27 |     const scopesInput = page.locator('input[id="scopes"]');
  28 |     await expect(scopesInput).toHaveValue('read write');
  29 | 
  30 |     // Verify predefined audiences available
  31 |     const select = page.locator('select');
  32 |     const options = select.locator('option');
  33 |     const count = await options.count();
  34 |     expect(count).toBeGreaterThanOrEqual(3);
  35 |   });
  36 | 
  37 |   test('exchange button submits form', async ({ page }) => {
  38 |     await page.goto('https://api.ping.demo:4000/token-exchange-tester');
  39 | 
  40 |     // Click exchange button - should trigger API call or show error
  41 |     const button = page.locator('button:has-text("Exchange Token")');
  42 |     await button.click();
  43 | 
  44 |     // Either we get an error (no session) or a result
  45 |     // Wait for either error message or result section
  46 |     const errorOrResult = page.locator('.error-section, .result-section');
  47 |     await expect(errorOrResult).toBeVisible({ timeout: 5000 });
  48 |   });
  49 | 
  50 |   test('custom audience can be entered', async ({ page }) => {
  51 |     await page.goto('https://api.ping.demo:4000/token-exchange-tester');
  52 | 
  53 |     const customInput = page.locator('input.custom-input');
  54 |     await customInput.fill('custom.resource.uri');
  55 | 
  56 |     const value = await customInput.inputValue();
  57 |     expect(value).toBe('custom.resource.uri');
  58 |   });
  59 | 
  60 |   test('scopes can be modified', async ({ page }) => {
  61 |     await page.goto('https://api.ping.demo:4000/token-exchange-tester');
  62 | 
  63 |     const scopesInput = page.locator('input[id="scopes"]');
  64 |     await scopesInput.fill('read write agent:invoke');
  65 | 
  66 |     const value = await scopesInput.inputValue();
  67 |     expect(value).toBe('read write agent:invoke');
  68 |   });
  69 | });
  70 | 
```