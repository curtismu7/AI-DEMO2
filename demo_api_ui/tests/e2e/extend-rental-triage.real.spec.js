/**
 * End-to-end triage test: extend_rental $300 (UC7 analog, sporting-goods).
 * Signs in as the demo customer via the real PingOne flow, sends the chip,
 * and captures the agent reply + token chain so the gateway DENY can be
 * diagnosed from the [triage] log line the BFF emits for this call.
 *
 * Run: cd demo_api_ui && npx playwright test tests/e2e/extend-rental-triage.real.spec.js --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { loginAsCustomer } = require('./helpers/realLogin');

test('extend_rental $300 — UC7 (sporting-goods) end to end', async ({ page }) => {
  await loginAsCustomer(page);
  await page.waitForTimeout(6000);

  // Close the Mission Control drawer if it is open (it covers the chat input).
  const close = page.locator('.ba-demo-steps-drawer__close');
  if (await close.isVisible().catch(() => false)) {
    await close.click({ force: true });
    await page.waitForTimeout(600);
  }

  // Send the phrase through the real chat input.
  const input = page.locator('input[placeholder*="Ask about"]').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.fill('extend my rental $300');
  await page.locator('button[aria-label="Send"]').click();

  // Wait for the agent reply to land in the transcript.
  const reply = page.locator('.banking-agent-message, [class*="assistant"], [class*="ba-msg"]').last();
  await page.waitForTimeout(25000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const denied = bodyText.includes("declined by the gateway's authorization policy")
    || bodyText.includes('policy denied')
    || bodyText.includes('insufficient_scope');
  const hitl = bodyText.includes('MFA') || bodyText.includes('consent') || bodyText.includes('approve');
  const completed = bodyText.includes('extended') || bodyText.includes('extension confirmed');

  console.log('[triage-spec] denied-card:', denied, '| hitl-prompt:', hitl, '| completed:', completed);
  await page.screenshot({ path: 'evidence/extend-rental-triage.png', fullPage: false });

  // The assertion is deliberately loose: this spec is a triage probe — its job
  // is to drive the call so the BFF [triage] log line fires, and to record what
  // the UI showed. Pass/fail of the step itself is judged from the logs.
  expect(true).toBe(true);
});
