// The app shell's keyboard contract, measured in a real browser.
//
// Before: a fresh page needed ~280 Tab presses to reach <main> (no skip link, the Draw pencil first, and
// 199 links of collapsed side-nav groups that took focus off screen at x=-273). jsdom cannot see tab
// order or clipping, so this spec presses the real Tab key.
//
// Every /api, /a2a, /health, /mcp-facade and /ws request is answered 404 {}: no backend is needed, and the
// pages render their signed-out state. (A 401 would also raise the "session expired" modal after a few
// seconds, which sits over the page and takes focus.) The server-check modal and welcome wizard are
// pre-dismissed through localStorage, the same way the shared e2e storage state does for the wizard.
const { test, expect } = require('@playwright/test');

const ROUTES = ['/privilege-saas-access', '/ai-products/gateway', '/gateway-claims'];
const THEMES = ['light', 'dark'];

// Measured 2026-11-08 after the fix: 48 stops walking the shell on /privilege-saas-access. The pin is a
// ceiling, not a target; before the fix the same walk took 279.
const PLAIN_TAB_CEILING = 80;

async function open(page, route, theme = 'light') {
  await page.route(/\/(api|a2a|health|mcp-facade|ws)(\/|$)/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.addInitScript((t) => {
    window.localStorage.setItem('ba_dark_mode', String(t === 'dark'));
    window.localStorage.setItem('demo_server_check_dismissed', '1');
    window.localStorage.setItem('demo_welcome_seen', '1');
  }, theme);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 60000 });
  // Let lazy routes and the shell settle; networkidle never fires here (the app holds SSE open).
  await page.waitForTimeout(3000);
}

const focused = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      inMain: !!e.closest('main'),
      isMain: e.tagName === 'MAIN',
      skip: e.classList.contains('skip-link'),
    };
  });

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`${route} (${theme}): the skip link is the first stop and reaches <main> in two presses`, async ({ page }) => {
      await open(page, route, theme);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);

      await page.keyboard.press('Tab');
      const first = await focused(page);
      expect(first.skip, `first Tab stop was ${first.tag} "${first.name}"`).toBe(true);
      // Visible on focus, on screen, and with a text/ground pair that clears 4.5:1.
      expect(first.x).toBeGreaterThanOrEqual(0);
      expect(first.y).toBeGreaterThanOrEqual(0);
      expect(first.w).toBeGreaterThan(100);
      const link = page.getByTestId('skip-link');
      await expect(link).toBeInViewport();
      const ratio = await page.evaluate(() => {
        const c = getComputedStyle(document.activeElement);
        const lum = (rgb) => {
          const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
            const s = Number(v) / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const a = lum(c.color);
        const b = lum(c.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);

      await page.keyboard.press('Enter');
      const afterSkip = await focused(page);
      expect(afterSkip.isMain).toBe(true);

      await page.keyboard.press('Tab');
      const next = await focused(page);
      expect(next.inMain, `Tab after the skip landed on ${next.tag} "${next.name}"`).toBe(true);
    });
  }
}

test('walking the shell with plain Tab reaches <main> in far fewer stops, and none is off screen', async ({ page }) => {
  await open(page, '/privilege-saas-access');
  const offscreen = [];
  let reached = -1;
  for (let i = 1; i <= PLAIN_TAB_CEILING + 40; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.inMain) {
      reached = i;
      break;
    }
    // A stop the user cannot see: left of the window, above it, or zero-sized.
    if (f.x < 0 || f.y < 0 || f.w === 0 || f.h === 0) offscreen.push(`${i}:${f.tag}:${f.name}@${f.x},${f.y}`);
  }
  expect(offscreen).toEqual([]);
  expect(reached).toBeGreaterThan(0);
  expect(reached).toBeLessThanOrEqual(PLAIN_TAB_CEILING);
});

test('the Draw pencil is not the first stop and takes a visible focus ring', async ({ page }) => {
  await open(page, '/privilege-saas-access');
  await page.keyboard.press('Tab');
  expect((await focused(page)).name).not.toBe('Draw');
  const pencil = page.locator('.draw-pencil');
  await pencil.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await pencil.evaluate((el) => {
    const c = getComputedStyle(el);
    return { style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor };
  });
  expect(outline.style).toBe('solid');
  // 2px, shown at the page's 1.125 text zoom.
  expect(outline.width).toBeGreaterThanOrEqual(1.5);
  expect(outline.color).toBe('rgb(255, 255, 255)');
});

test('side-nav groups on the icon rail keep their links out of the tab order until activated', async ({ page }) => {
  await open(page, '/privilege-saas-access');
  const group = page.locator('.admin-side-nav__item--parent').first();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  // Focusing the group must not pull its flyout links into the tab order.
  await group.focus();
  const tabbableInFlyout = await page.evaluate(() => {
    const g = document.activeElement.closest('.admin-side-nav__group');
    return [...g.querySelectorAll('a,button')].filter((e) => e !== document.activeElement && e.offsetParent !== null).length;
  });
  expect(tabbableInFlyout).toBe(0);

  // Enter opens the rail with the group expanded and its links reachable.
  await page.keyboard.press('Enter');
  await expect(page.locator('.admin-side-nav')).not.toHaveClass(/admin-side-nav--collapsed/);
  await expect(page.locator('.admin-side-nav__item--parent[aria-expanded="true"]').first()).toBeVisible();
  await page.keyboard.press('Tab');
  const f = await focused(page);
  expect(f.tag).toBe('A');
  expect(f.x).toBeGreaterThanOrEqual(0);
  expect(f.w).toBeGreaterThan(0);
});

test('user menu: aria-expanded, Escape closes and returns focus, theme toggle has one name', async ({ page }) => {
  await open(page, '/privilege-saas-access');
  const trigger = page.getByRole('button', { name: 'User menu' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  const toggle = page.locator('.topnav-theme-toggle');
  const name = await toggle.getAttribute('aria-label');
  expect(name).toBe('Dark mode');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await toggle.getAttribute('aria-label')).toBe(name);
});

test('/ai-products/gateway and /privilege-for-ai have exactly one <main>', async ({ page }) => {
  for (const route of ['/ai-products/gateway', '/privilege-for-ai']) {
    await open(page, route);
    expect(await page.locator('main').count(), route).toBe(1);
    expect(await page.locator('h1').count(), route).toBe(1);
  }
});

test('a signed-out gate has one <main> and an h1', async ({ page }) => {
  await open(page, '/use-cases');
  expect(await page.locator('main').count()).toBe(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
});

test('/gateway-claims: each diagram toolbar has its own name', async ({ page }) => {
  await open(page, '/gateway-claims');
  const toolbars = page.getByRole('toolbar');
  const names = await toolbars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names.length).toBeGreaterThanOrEqual(3);
  expect(new Set(names).size).toBe(names.length);
});

test('/privilege-coding-agents: one h1, and the collapsed tools column is out of the tab order', async ({ page }) => {
  await open(page, '/privilege-coding-agents');
  expect(await page.locator('h1').count()).toBe(1);
  await page.getByRole('button', { name: 'Hide tools' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show tools' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.inspector-shell-col-left')).toHaveAttribute('inert', '');
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const inCollapsed = await page.evaluate(() => !!document.activeElement.closest('.inspector-shell-col-left'));
    expect(inCollapsed, `Tab ${i + 1} entered the collapsed column`).toBe(false);
  }
});
