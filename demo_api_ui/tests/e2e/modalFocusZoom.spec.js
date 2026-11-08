/**
 * @file modalFocusZoom.spec.js
 * Shared modals in a real browser, signed out, every /api call stubbed with 200 {} (no server needed):
 *  - the panel and its close / primary buttons stay inside the window at app zoom 1, 1.125 (the shipped default) and 1.25
 *    on 375, 768 and 1280 wide, and it is centred in the zoomed page;
 *  - keyboard: focus moves into the dialog, Tab stays inside, Escape closes, focus returns to the opener;
 *  - the CIBA drawer's .edu-code blocks are styled on first open.
 */
const { test, expect } = require('@playwright/test');

async function stubApi(page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

const describeActive = () => {
  const a = document.activeElement;
  return {
    tag: a.tagName,
    label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40),
    dialog: a.closest('[role=dialog]')?.getAttribute('aria-label') || null,
  };
};

test.describe('modal width and offset under app zoom', () => {
  for (const zoom of [1, 1.125, 1.25]) {
    for (const width of [375, 768, 1280]) {
      test(`admin gate at zoom ${zoom}, ${width}px wide stays inside the window`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.addInitScript((z) => {
          try { localStorage.setItem('ba_font_scale', String(z)); } catch (_) {}
        }, zoom);
        await stubApi(page);
        await page.goto('/delegated-commerce');
        const panel = page.locator('.dm-panel').first();
        await expect(panel).toBeVisible({ timeout: 30000 });
        // let the 180ms enter animation finish before measuring
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.dm-panel');
          const r = p.getBoundingClientRect();
          const inside = (el) => {
            const b = el.getBoundingClientRect();
            return b.left >= 0 && b.right <= window.innerWidth && b.width > 0;
          };
          const close = p.querySelector('.dm-btn[aria-label="Close"]');
          const primary = [...p.querySelectorAll('.dm-footer button')].find((b) => /Log in as admin/.test(b.textContent));
          return {
            iw: window.innerWidth,
            zoom: parseFloat(getComputedStyle(document.documentElement).zoom),
            left: r.left,
            right: r.right,
            closeInside: inside(close),
            primaryInside: inside(primary),
            scrollW: document.documentElement.scrollWidth,
          };
        });
        expect(m.zoom).toBeCloseTo(zoom, 3);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.iw);
        expect(m.closeInside).toBe(true);
        expect(m.primaryInside).toBe(true);
        expect(m.scrollW).toBeLessThanOrEqual(m.iw);
        if (width >= 768) {
          // centred in the page, not pushed right by the zoom factor (within the 30px the -30 y-nudge-free x maths allows)
          expect(Math.abs((m.left + m.right) / 2 - m.iw / 2)).toBeLessThanOrEqual(2);
        }
      });
    }
  }
});

test.describe('modal keyboard focus', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('the admin gate takes focus, holds Tab, and cannot be tabbed out to the page behind', async ({ page }) => {
    await page.goto('/delegated-commerce');
    await expect(page.locator('.dm-panel')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('.dm-panel'))).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.dm-panel'))).toBe(true);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.dm-panel'))).toBe(true);
    }
  });

  test('a page-guide modal: Escape closes it and focus goes back to the Guide button', async ({ page }) => {
    await page.goto('/demo-track');
    const guide = page.locator('button.topnav-guide-btn');
    await expect(guide).toBeVisible({ timeout: 30000 });
    await guide.focus();
    await page.keyboard.press('Enter');
    const panel = page.locator('.dm-panel');
    await expect(panel).toBeVisible();
    expect((await page.evaluate(describeActive)).dialog).not.toBeNull();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.dm-panel'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement.classList.contains('topnav-guide-btn'))).toBe(true);
  });

  test('the Welcome wizard takes focus, holds Tab, closes on Escape and returns focus to the Welcome button', async ({ page }) => {
    await page.goto('/demo-track');
    const welcome = page.locator('button.topnav-use-cases-btn', { hasText: 'Welcome' });
    await expect(welcome).toBeVisible({ timeout: 30000 });
    await welcome.focus();
    await page.keyboard.press('Enter');
    const wizard = page.locator('.ww-backdrop');
    await expect(wizard).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement.closest('.ww-backdrop'))).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.ww-backdrop'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(wizard).toHaveCount(0);
    expect((await page.evaluate(describeActive)).label).toBe('Welcome');
  });
});

test.describe('CIBA drawer education code blocks', () => {
  test('are styled on first open (padding and background, not bare <pre>)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/weather-mcp');
    await page.waitForTimeout(4000);
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } })),
    );
    const pre = page.locator('pre.edu-code').first();
    await expect(pre).toBeAttached({ timeout: 15000 });
    const css = await pre.evaluate((el) => {
      const s = getComputedStyle(el);
      return { padding: s.paddingTop, bg: s.backgroundColor };
    });
    expect(css.padding).not.toBe('0px');
    expect(css.bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});
