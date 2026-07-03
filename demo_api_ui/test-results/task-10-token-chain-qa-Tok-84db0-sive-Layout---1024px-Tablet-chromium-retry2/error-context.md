# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: task-10-token-chain-qa.spec.js >> Token Chain Redesign - Full QA Suite >> 10. Responsive Layout - 1024px Tablet
- Location: tests/e2e/task-10-token-chain-qa.spec.js:290:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at https://api.ping.demo:4000/
Call log:
  - navigating to "https://api.ping.demo:4000/", waiting until "networkidle"

```

```
ReferenceError: testResults is not defined
```

# Test source

```ts
  302 |       return elements.length > 0;
  303 |     });
  304 | 
  305 |     testResults.passed.push(`Responsive classes applied: ${hasResponsiveClass}`);
  306 |   });
  307 | 
  308 |   test('11. Responsive Layout - 640px Mobile', async ({ page }) => {
  309 |     await page.setViewportSize({ width: 640, height: 960 });
  310 |     await page.waitForTimeout(500);
  311 | 
  312 |     const mainContent = page.locator('main, [role="main"]').first();
  313 |     const isVisible = await mainContent.isVisible().catch(() => false);
  314 | 
  315 |     testResults.passed.push(`Mobile layout (640px) renders: ${isVisible}`);
  316 | 
  317 |     // Check mobile-specific adaptations
  318 |     const header = page.locator('header, [role="banner"]').first();
  319 |     const headerVisible = await header.isVisible().catch(() => false);
  320 | 
  321 |     testResults.passed.push(`Header visible on mobile: ${headerVisible}`);
  322 |   });
  323 | 
  324 |   test('12. Console Errors - No Critical Errors', async ({ page }) => {
  325 |     // Wait a bit for any deferred errors
  326 |     await page.waitForTimeout(2000);
  327 | 
  328 |     const hasErrors = consoleErrors.length > 0;
  329 |     testResults.passed.push(`Console clean: ${!hasErrors}`);
  330 | 
  331 |     if (hasErrors) {
  332 |       testResults.warnings.push(`Console errors detected: ${consoleErrors.length}`);
  333 |       consoleErrors.forEach((err, idx) => {
  334 |         testResults.warnings.push(`  Error ${idx + 1}: ${err.substring(0, 100)}`);
  335 |       });
  336 |     }
  337 |   });
  338 | 
  339 |   test('13. Color Scheme - Spec Compliance', async ({ page }) => {
  340 |     const colorInfo = await page.evaluate(() => {
  341 |       const colors = new Set();
  342 |       const elements = document.querySelectorAll('*');
  343 | 
  344 |       elements.forEach(el => {
  345 |         const style = window.getComputedStyle(el);
  346 |         const bg = style.backgroundColor;
  347 |         const fg = style.color;
  348 | 
  349 |         if (bg !== 'rgba(0, 0, 0, 0)') colors.add(bg);
  350 |         if (fg !== 'rgba(0, 0, 0, 0)') colors.add(fg);
  351 |       });
  352 | 
  353 |       return {
  354 |         colorCount: colors.size,
  355 |         hasColors: colors.size > 0
  356 |       };
  357 |     });
  358 | 
  359 |     testResults.passed.push(`Color styles applied: ${colorInfo.hasColors}`);
  360 |     testResults.passed.push(`Detected ${colorInfo.colorCount} unique colors`);
  361 |   });
  362 | 
  363 |   test('14. Navigation - All Links Functional', async ({ page }) => {
  364 |     const links = await page.locator('a').all();
  365 | 
  366 |     if (links.length > 0) {
  367 |       testResults.passed.push(`Navigation links found: ${links.length}`);
  368 | 
  369 |       // Check first few links are clickable
  370 |       let clickable = 0;
  371 |       for (let i = 0; i < Math.min(links.length, 5); i++) {
  372 |         const isVisible = await links[i].isVisible().catch(() => false);
  373 |         if (isVisible) {
  374 |           try {
  375 |             await links[i].click();
  376 |             clickable++;
  377 |             await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
  378 |             await page.goBack().catch(() => {});
  379 |           } catch (e) {
  380 |             // Expected for some links
  381 |           }
  382 |         }
  383 |       }
  384 | 
  385 |       testResults.passed.push(`Clickable links verified: ${clickable}`);
  386 |     }
  387 |   });
  388 | 
  389 |   test.afterEach(async ({ page }) => {
  390 |     // Take final screenshot for reference
  391 |     const timestamp = Date.now();
  392 |     await page.screenshot({
  393 |       path: `/tmp/token-chain-qa-${timestamp}.png`,
  394 |       fullPage: true
  395 |     }).catch(() => {});
  396 |   });
  397 | });
  398 | 
  399 | // Summary report printed after all tests
  400 | test.afterAll(async () => {
  401 |   console.log('\n\n================== TOKEN CHAIN QA SUMMARY ==================');
> 402 |   console.log(`\nPassed Checks: ${testResults.passed.length}`);
      |                                   ^ ReferenceError: testResults is not defined
  403 |   testResults.passed.slice(0, 10).forEach(p => console.log(`  ✅ ${p}`));
  404 |   if (testResults.passed.length > 10) {
  405 |     console.log(`  ... and ${testResults.passed.length - 10} more`);
  406 |   }
  407 | 
  408 |   if (testResults.warnings.length > 0) {
  409 |     console.log(`\nWarnings/Notes: ${testResults.warnings.length}`);
  410 |     testResults.warnings.slice(0, 5).forEach(w => console.log(`  ⚠️  ${w}`));
  411 |     if (testResults.warnings.length > 5) {
  412 |       console.log(`  ... and ${testResults.warnings.length - 5} more`);
  413 |     }
  414 |   }
  415 | 
  416 |   console.log('\n=========================================================\n');
  417 | });
  418 | 
```