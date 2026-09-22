import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
// reuse the real logged-in session cookie from the running stack if present
const cookies = JSON.parse(fs.readFileSync('/tmp/bff-cookies.json', 'utf8'));
await ctx.addCookies(cookies);
const p = await ctx.newPage();
await p.goto('https://local.ping-devops.com:4000/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(10000);
const signedIn = await p.evaluate(() => !document.body.textContent.includes('Sign in with your customer account'));
console.log('signedIn:', signedIn);
if (signedIn) {
  const input = p.locator('input[placeholder*="Ask about"]').first();
  await input.fill('extend my rental $300');
  await p.locator('button[aria-label="Send"]').click();
  await p.waitForTimeout(25000);
}
await b.close();
