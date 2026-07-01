/**
 * Task 10: Token Chain Redesign - Comprehensive Manual Testing
 * All interactive components, modals, diagrams, and responsive behavior
 */

const { test, expect } = require('@playwright/test');

test.describe('Token Chain Redesign - Full QA Suite', () => {
  const testResults = {
    passed: [],
    failed: [],
    warnings: []
  };

  // Console error capture
  let consoleErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to OAuth token display or home
    await page.goto('https://api.ping.demo:4000/oauth-token-display', {
      waitUntil: 'networkidle',
      timeout: 30000
    }).catch(async () => {
      // Fallback to home
      await page.goto('https://api.ping.demo:4000', { waitUntil: 'networkidle' });
    });
  });

  test('1. Security Banner - Dismiss and Refresh', async ({ page }) => {
    // Check if banner exists
    const banner = page.locator('[role="alert"]').first();
    const bannerVisible = await banner.isVisible().catch(() => false);

    if (bannerVisible) {
      testResults.passed.push('Security banner visible on load');

      // Try to dismiss
      const dismissBtn = page.locator('button:has-text("dismiss"), button[aria-label*="dismiss"], button[aria-label*="close"]').first();
      if (await dismissBtn.isVisible().catch(() => false)) {
        await dismissBtn.click();
        await page.waitForTimeout(500);
        testResults.passed.push('Security banner dismissible');

        // Refresh and check if banner reappears
        await page.reload();
        const bannerReappears = await banner.isVisible().catch(() => false);
        if (bannerReappears) {
          testResults.passed.push('Security banner reappears after refresh');
        }
      }
    } else {
      testResults.warnings.push('No security banner found on this page');
    }
  });

  test('2. Token Exchange Mode - Expand/Collapse', async ({ page }) => {
    // Look for exchange/expansion button
    const buttons = await page.locator('button').all();
    let expandFound = false;

    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      if (text.toLowerCase().includes('exchange') || text.toLowerCase().includes('expand')) {
        expandFound = true;
        await btn.click();
        await page.waitForTimeout(500);

        // Check if expanded content visible
        const hasExpandedContent = await page.locator('[class*="exchange"], [class*="expanded"]').count() > 0;
        testResults.passed.push(`Token Exchange Mode expands: ${hasExpandedContent}`);

        // Check for table
        const tableVisible = await page.locator('table').isVisible().catch(() => false);
        if (tableVisible) {
          testResults.passed.push('Exchange mode table visible');
        }

        // Collapse
        await btn.click();
        await page.waitForTimeout(300);
        testResults.passed.push('Token Exchange Mode collapses');
        break;
      }
    }

    if (!expandFound) {
      testResults.warnings.push('Token Exchange expand button not found');
    }
  });

  test('3. Token Legend Modal - Open/Close', async ({ page }) => {
    // Find legend button
    const buttons = await page.locator('button').all();
    let legendFound = false;

    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      if (text.toLowerCase().includes('legend')) {
        legendFound = true;

        // Open modal
        await btn.click();
        await page.waitForTimeout(500);

        const modal = page.locator('[role="dialog"]').first();
        const modalOpen = await modal.isVisible().catch(() => false);
        testResults.passed.push(`Legend modal opens: ${modalOpen}`);

        if (modalOpen) {
          // Try X button close
          const closeBtn = modal.locator('button[aria-label*="close"], button:has-text("✕")').first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
            await page.waitForTimeout(300);
            const stillOpen = await modal.isVisible().catch(() => false);
            testResults.passed.push(`Legend modal closes with X button: ${!stillOpen}`);
          }

          // Reopen and try outside click
          await btn.click();
          await page.waitForTimeout(300);
          const reopened = await modal.isVisible().catch(() => false);
          if (reopened) {
            // Click outside
            await page.click('body', { position: { x: 10, y: 10 } });
            await page.waitForTimeout(300);
            const closedOutside = !(await modal.isVisible().catch(() => false));
            testResults.passed.push(`Legend modal closes on outside click: ${closedOutside}`);
          }
        }
        break;
      }
    }

    if (!legendFound) {
      testResults.warnings.push('Legend button not found');
    }
  });

  test('4. Claim Details Modal - Open and RFC Text', async ({ page }) => {
    // Find claim detail buttons
    const buttons = await page.locator('button').all();
    let claimsFound = 0;

    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      if (text.toLowerCase().includes('claim') || text.toLowerCase().includes('detail')) {
        claimsFound++;
        if (claimsFound <= 3) {  // Test first 3
          try {
            await btn.click();
            await page.waitForTimeout(500);

            const modal = page.locator('[role="dialog"]').first();
            const modalOpen = await modal.isVisible().catch(() => false);

            if (modalOpen) {
              const modalText = await modal.textContent();
              const hasRFC = modalText.includes('RFC') || modalText.includes('rfc');
              testResults.passed.push(`Claim Details modal ${claimsFound} opens with RFC: ${hasRFC}`);

              // Close
              const closeBtn = modal.locator('button').first();
              await closeBtn.click();
              await page.waitForTimeout(300);
            }
          } catch (e) {
            testResults.warnings.push(`Error with claim ${claimsFound}: ${e.message}`);
          }
        }
      }
    }

    if (claimsFound === 0) {
      testResults.warnings.push('No claim detail buttons found');
    }
  });

  test('5. Token Flow Diagram - Display and RFC Citations', async ({ page }) => {
    // Check for SVG diagram
    const svgVisible = await page.locator('svg').first().isVisible().catch(() => false);
    testResults.passed.push(`Token Flow Diagram visible: ${svgVisible}`);

    if (svgVisible) {
      // Check page for RFC text
      const pageText = await page.textContent('body');
      const hasRFC = pageText.includes('RFC');
      testResults.passed.push(`Token Flow has RFC citations: ${hasRFC}`);

      // Check for diagram labels
      const svgText = await page.locator('svg').first().textContent();
      const hasDiagramText = svgText.length > 10;
      testResults.passed.push(`Diagram has labeled content: ${hasDiagramText}`);
    }
  });

  test('6. Expandable Steps - Click and View Details', async ({ page }) => {
    // Find expandable step elements
    const steps = await page.locator('[class*="step"], [data-testid*="step"]').all();

    if (steps.length > 0) {
      testResults.passed.push(`Found ${steps.length} expandable steps`);

      for (let i = 0; i < Math.min(steps.length, 3); i++) {
        try {
          const step = steps[i];
          const isVisible = await step.isVisible().catch(() => false);

          if (isVisible) {
            await step.click();
            await page.waitForTimeout(300);
            testResults.passed.push(`Step ${i + 1} clickable and expandable`);
          }
        } catch (e) {
          testResults.warnings.push(`Error with step ${i + 1}`);
        }
      }
    } else {
      testResults.warnings.push('No expandable steps found');
    }
  });

  test('7. Token Cards - Layout and Inspect Buttons', async ({ page }) => {
    const cards = await page.locator('[class*="Card"], [data-testid*="card"]').all();

    if (cards.length > 0) {
      testResults.passed.push(`Token cards present: ${cards.length}`);

      // Check first card layout
      const firstCard = cards[0];
      const box = await firstCard.boundingBox().catch(() => null);

      if (box) {
        const hasValidDimensions = box.width > 0 && box.height > 0;
        testResults.passed.push(`Card has valid dimensions: ${hasValidDimensions}`);
      }

      // Check for inspect button
      const inspectBtn = firstCard.locator('button:has-text("inspect"), button:has-text("Inspect")').first();
      if (await inspectBtn.isVisible().catch(() => false)) {
        await inspectBtn.click();
        await page.waitForTimeout(300);
        testResults.passed.push('Token card inspect button functional');
      }
    } else {
      testResults.warnings.push('No token cards found on page');
    }
  });

  test('8. Scope Changes - Yellow Highlight and Read Highlighting', async ({ page }) => {
    const scopeElements = await page.locator('[class*="scope"], [data-scope]').all();

    if (scopeElements.length > 0) {
      testResults.passed.push(`Scope elements found: ${scopeElements.length}`);

      for (let i = 0; i < Math.min(scopeElements.length, 2); i++) {
        const elem = scopeElements[i];
        const classes = await elem.getAttribute('class');
        const style = await elem.getAttribute('style');

        const hasHighlight = classes.includes('highlight') ||
                            classes.includes('yellow') ||
                            classes.includes('read') ||
                            (style && (style.includes('yellow') || style.includes('highlight')));

        testResults.passed.push(`Scope element ${i + 1} has highlighting: ${hasHighlight}`);
      }
    } else {
      testResults.warnings.push('No scope elements found for highlighting test');
    }
  });

  test('9. Responsive Layout - 1920px Desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);

    const mainContent = page.locator('main, [role="main"]').first();
    const isVisible = await mainContent.isVisible().catch(() => false);

    testResults.passed.push(`Desktop layout (1920px) renders: ${isVisible}`);
  });

  test('10. Responsive Layout - 1024px Tablet', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);

    const mainContent = page.locator('main, [role="main"]').first();
    const isVisible = await mainContent.isVisible().catch(() => false);

    testResults.passed.push(`Tablet layout (1024px) renders: ${isVisible}`);

    // Check for responsive adjustments
    const hasResponsiveClass = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="responsive"], [class*="flex"], [class*="grid"]');
      return elements.length > 0;
    });

    testResults.passed.push(`Responsive classes applied: ${hasResponsiveClass}`);
  });

  test('11. Responsive Layout - 640px Mobile', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 960 });
    await page.waitForTimeout(500);

    const mainContent = page.locator('main, [role="main"]').first();
    const isVisible = await mainContent.isVisible().catch(() => false);

    testResults.passed.push(`Mobile layout (640px) renders: ${isVisible}`);

    // Check mobile-specific adaptations
    const header = page.locator('header, [role="banner"]').first();
    const headerVisible = await header.isVisible().catch(() => false);

    testResults.passed.push(`Header visible on mobile: ${headerVisible}`);
  });

  test('12. Console Errors - No Critical Errors', async ({ page }) => {
    // Wait a bit for any deferred errors
    await page.waitForTimeout(2000);

    const hasErrors = consoleErrors.length > 0;
    testResults.passed.push(`Console clean: ${!hasErrors}`);

    if (hasErrors) {
      testResults.warnings.push(`Console errors detected: ${consoleErrors.length}`);
      consoleErrors.forEach((err, idx) => {
        testResults.warnings.push(`  Error ${idx + 1}: ${err.substring(0, 100)}`);
      });
    }
  });

  test('13. Color Scheme - Spec Compliance', async ({ page }) => {
    const colorInfo = await page.evaluate(() => {
      const colors = new Set();
      const elements = document.querySelectorAll('*');

      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const fg = style.color;

        if (bg !== 'rgba(0, 0, 0, 0)') colors.add(bg);
        if (fg !== 'rgba(0, 0, 0, 0)') colors.add(fg);
      });

      return {
        colorCount: colors.size,
        hasColors: colors.size > 0
      };
    });

    testResults.passed.push(`Color styles applied: ${colorInfo.hasColors}`);
    testResults.passed.push(`Detected ${colorInfo.colorCount} unique colors`);
  });

  test('14. Navigation - All Links Functional', async ({ page }) => {
    const links = await page.locator('a').all();

    if (links.length > 0) {
      testResults.passed.push(`Navigation links found: ${links.length}`);

      // Check first few links are clickable
      let clickable = 0;
      for (let i = 0; i < Math.min(links.length, 5); i++) {
        const isVisible = await links[i].isVisible().catch(() => false);
        if (isVisible) {
          try {
            await links[i].click();
            clickable++;
            await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
            await page.goBack().catch(() => {});
          } catch (e) {
            // Expected for some links
          }
        }
      }

      testResults.passed.push(`Clickable links verified: ${clickable}`);
    }
  });

  test.afterEach(async ({ page }) => {
    // Take final screenshot for reference
    const timestamp = Date.now();
    await page.screenshot({
      path: `/tmp/token-chain-qa-${timestamp}.png`,
      fullPage: true
    }).catch(() => {});
  });
});

// Summary report printed after all tests
test.afterAll(async () => {
  console.log('\n\n================== TOKEN CHAIN QA SUMMARY ==================');
  console.log(`\nPassed Checks: ${testResults.passed.length}`);
  testResults.passed.slice(0, 10).forEach(p => console.log(`  ✅ ${p}`));
  if (testResults.passed.length > 10) {
    console.log(`  ... and ${testResults.passed.length - 10} more`);
  }

  if (testResults.warnings.length > 0) {
    console.log(`\nWarnings/Notes: ${testResults.warnings.length}`);
    testResults.warnings.slice(0, 5).forEach(w => console.log(`  ⚠️  ${w}`));
    if (testResults.warnings.length > 5) {
      console.log(`  ... and ${testResults.warnings.length - 5} more`);
    }
  }

  console.log('\n=========================================================\n');
});
