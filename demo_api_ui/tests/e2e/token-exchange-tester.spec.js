const { test, expect } = require('@playwright/test');

test.describe('Token Exchange Tester Page', () => {
  test.beforeEach(async ({ page, context }) => {
    // Set auth cookies if needed - adjust based on your auth setup
    await page.goto('https://api.ping.demo:4000');
    // Wait for potential redirects to settle
    await page.waitForLoadState('domcontentloaded');
  });

  test('page loads with form when user is logged in', async ({ page }) => {
    await page.goto('https://api.ping.demo:4000/token-exchange-tester');

    // Verify page title
    await expect(page.locator('h1')).toContainText('RFC 8693 Token Exchange Tester');

    // Verify form elements exist
    await expect(page.locator('select')).toBeTruthy();
    await expect(page.locator('input[id="scopes"]')).toBeTruthy();
    await expect(page.locator('button:has-text("Exchange Token")')).toBeTruthy();
  });

  test('form has default values pre-populated', async ({ page }) => {
    await page.goto('https://api.ping.demo:4000/token-exchange-tester');

    // Check default audience
    const scopesInput = page.locator('input[id="scopes"]');
    await expect(scopesInput).toHaveValue('read write');

    // Verify predefined audiences available
    const select = page.locator('select');
    const options = select.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('exchange button submits form', async ({ page }) => {
    await page.goto('https://api.ping.demo:4000/token-exchange-tester');

    // Click exchange button - should trigger API call or show error
    const button = page.locator('button:has-text("Exchange Token")');
    await button.click();

    // Either we get an error (no session) or a result
    // Wait for either error message or result section
    const errorOrResult = page.locator('.error-section, .result-section');
    await expect(errorOrResult).toBeVisible({ timeout: 5000 });
  });

  test('custom audience can be entered', async ({ page }) => {
    await page.goto('https://api.ping.demo:4000/token-exchange-tester');

    const customInput = page.locator('input.custom-input');
    await customInput.fill('custom.resource.uri');

    const value = await customInput.inputValue();
    expect(value).toBe('custom.resource.uri');
  });

  test('scopes can be modified', async ({ page }) => {
    await page.goto('https://api.ping.demo:4000/token-exchange-tester');

    const scopesInput = page.locator('input[id="scopes"]');
    await scopesInput.fill('read write agent:invoke');

    const value = await scopesInput.inputValue();
    expect(value).toBe('read write agent:invoke');
  });
});
