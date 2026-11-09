// Phone-width layout lock (375x800, 320x568 and the app's A+ text zoom).
//
// Real viewports, not CSS zoom or a resized desktop: the top bar, the simulation banners, the shared Ping UI text
// classes, the flow diagram fit and the signed-out gate all behaved differently only at phone width, and every one of
// them passed its jsdom test. Measured before the fixes (375x800): the sticky top bar was 243-447px tall (30-79% of the
// screen) and never scrolled away; the banners were 41-80% of the screen; a 100-character id ran 100-400px past the
// card; the flow diagram's labels were 3px; the signed-out /agent-builder painted two top bars.
//
// The API is stubbed (nothing here needs a stack): signed out answers 401, signed in answers a user.
const { test, expect } = require('@playwright/test');

const USERS = {
  customer: { id: 'u1', username: 'testuser', email: 't@example.com', firstName: 'Test', lastName: 'User', name: 'Test User', role: 'customer' },
  admin: { id: 'a1', username: 'admin', email: 'a@example.com', firstName: 'Ad', lastName: 'Min', name: 'Ad Min', role: 'admin' },
};

async function stub(page, who, scale) {
  const user = who ? USERS[who] : null;
  if (scale) {
    await page.addInitScript((s) => {
      try {
        window.localStorage.setItem('ba_font_scale', String(s));
      } catch {
        /* private mode */
      }
    }, scale);
  }
  await page.route('**/api/**', (route) => {
    if (/oauth\/(user\/)?status/.test(route.request().url())) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(user ? { authenticated: true, user } : { authenticated: false, user: null }),
      });
    }
    return route.fulfill({ status: user ? 200 : 401, contentType: 'application/json', body: '{}' });
  });
}

async function visit(page, path, who = 'admin', scale = null) {
  await stub(page, who, scale);
  await page.goto(path);
  // Never networkidle: the app holds SSE open.
  await page.waitForSelector('main, header.topnav', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

const PHONES = [
  { width: 375, height: 800 },
  { width: 320, height: 568 },
];

for (const vp of PHONES) {
  test.describe(`top bar at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    for (const who of [null, 'customer', 'admin']) {
      test(`is one compact, non-sticky row (${who || 'signed out'}) with every control behind Menu`, async ({ page }) => {
        await visit(page, '/ungoverned-agent', who);
        const bar = page.locator('header.topnav');
        const box = await bar.boundingBox();
        // Was 243-447px (30-79% of the screen). One row plus the Menu button.
        expect(box.height).toBeLessThanOrEqual(vp.height * 0.2);
        expect(await bar.evaluate((e) => getComputedStyle(e).position)).not.toBe('sticky');
        // Scrolling the page takes the bar with it.
        await page.evaluate(() => window.scrollTo(0, 400));
        expect((await bar.boundingBox()).y).toBeLessThan(0);
        await page.evaluate(() => window.scrollTo(0, 0));

        const toggle = page.getByRole('button', { name: 'Menu', exact: true });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#topnav-menu')).toBeHidden();
        // Keyboard: focus, Enter.
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const menu = page.locator('#topnav-menu');
        await expect(menu).toBeVisible();
        // Every control is reachable: the menu's buttons all sit inside the viewport width.
        const rights = await menu.locator('button:visible, a:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
        expect(rights.length).toBeGreaterThan(3);
        for (const r of rights) expect(r).toBeLessThanOrEqual(vp.width + 1);
        await expect(menu.getByRole('button', { name: 'Use Cases' })).toBeVisible();
        await expect(menu.getByTestId('topnav-font-size-btn')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
      });
    }
  });
}

test.describe('top bar above the phone breakpoint', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('keeps the sticky bar and shows the controls without a Menu button', async ({ page }) => {
    await visit(page, '/ungoverned-agent', 'customer');
    const bar = page.locator('header.topnav');
    expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Use Cases' })).toBeVisible();
  });
});

test.describe('simulation banner at phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('is held to a few lines, keeps all its text, and More opens it', async ({ page }) => {
    await visit(page, '/gateway-claims');
    const banner = page.locator('.pu-banner').first();
    await expect(banner).toHaveAttribute('role', 'note');
    const closed = await banner.boundingBox();
    // Was 41-80% of the screen on about 25 routes.
    expect(closed.height).toBeLessThanOrEqual(800 * 0.15);
    // The honest text is all still there for a screen reader and find-in-page.
    const text = await banner.evaluate((e) => e.textContent);
    expect(text).toContain('SIMULATED, NO LIVE CALL.');
    expect(text).toContain('Only statements labelled VERIFIED were seen on a real system.');

    const more = page.getByRole('button', { name: 'More', exact: true });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Less', exact: true })).toHaveAttribute('aria-expanded', 'true');
    const open = await banner.boundingBox();
    expect(open.height).toBeGreaterThan(closed.height * 1.5);
    // The whole text is visible once open: nothing clipped.
    expect(await banner.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  });
});

test.describe('fluid grids and the gate at phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('personal-agent client cards stay inside the viewport at 375 and 320', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await visit(page, '/personal-agent', 'customer');
      const rights = await page.locator('.personal-agent-client-cards__group').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
      expect(rights.length).toBe(3);
      for (const r of rights) expect(r).toBeLessThanOrEqual(width);
    }
  });

  test('signed-out /agent-builder renders one top bar and the sign-in prompt', async ({ page }) => {
    await visit(page, '/agent-builder', null);
    await expect(page.locator('header.topnav')).toHaveCount(1);
    await expect(page.getByText('Sign in required')).toBeVisible();
    const right = await page.locator('main.main-content').last().evaluate((e) => e.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(375);
  });

  test('token chain tabs and toolbar wrap inside the card', async ({ page }) => {
    await visit(page, '/delegated-commerce', 'admin');
    const card = page.locator('.tctr').first();
    await expect(card).toBeVisible({ timeout: 20000 });
    const cardRight = await card.evaluate((e) => e.getBoundingClientRect().right);
    const rights = await card.locator('.tctr-chain-tabs button, .tctr-head button').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.getBoundingClientRect().right]));
    expect(rights.map((r) => r[0])).toEqual(expect.arrayContaining(['Sequence', 'More']));
    for (const [name, r] of rights) expect(r, name).toBeLessThanOrEqual(cardRight + 1);
  });

  test('flow diagram labels stay legible (>= 10px) and a pan hint is shown', async ({ page }) => {
    await visit(page, '/delegation-chain-value', 'admin');
    const sfd = page.locator('.sfd').first();
    await expect(sfd).toBeVisible({ timeout: 20000 });
    await expect(sfd).toHaveAttribute('data-pannable', 'true');
    await expect(sfd.locator('.sfd-pan-hint')).toBeVisible();
    const px = await sfd.evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el.querySelector('.react-flow__viewport')).transform);
      const label = el.querySelector('.sfd-node-label');
      return parseFloat(getComputedStyle(label).fontSize) * m.a;
    });
    // Was 3px (the 0.2 minimum zoom).
    expect(px).toBeGreaterThanOrEqual(10);
  });
});

// 100-character unbroken strings (an agent id, an audience, a URL) appended to each shared text class on ten routes.
// Every injected element must end inside the viewport.
const LONG = 'A'.repeat(100);
const ROUTES = [
  '/privilege-saas-access',
  '/privilege-gateway-topologies',
  '/gateway-claims',
  '/ungoverned-agent',
  '/privilege-shelf',
  '/privilege-for-ai',
  '/pingfederate-config',
  '/privilege-a2a',
  '/delegation-chain-value',
  '/personal-agent',
];
const SELECTORS = ['.pu-note', '.pu-h3', '.pu-lede', '.pu-kicker', '.pu-label', '.pu-chip', '.pu-btn', '.pu-kv dd', '.pu-kv dt', '.plc__hint'];

test.describe('long unbroken text at 375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  for (const route of ROUTES) {
    test(`${route}: nothing injected runs past the right edge`, async ({ page }) => {
      await visit(page, route, 'admin');
      const result = await page.evaluate(
        ({ selectors, long }) => {
          const bad = [];
          let injected = 0;
          for (const sel of selectors) {
            const el = [...document.querySelectorAll(`.pu-page ${sel}`)].find((e) => e.getBoundingClientRect().width > 0);
            if (!el) continue;
            injected += 1;
            el.append(` ${long}`);
            const r = el.getBoundingClientRect().right;
            if (r > window.innerWidth + 1) bad.push(`${sel}@${Math.round(r)}`);
          }
          return { bad, injected };
        },
        { selectors: SELECTORS, long: LONG },
      );
      expect(result.injected, 'no .pu-* element to inject into on this route').toBeGreaterThan(0);
      expect(result.bad).toEqual([]);
    });
  }
});

test.describe('A+ 125% text zoom at 375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  for (const route of ['/privilege-a2a', '/delegation-chain-value', '/gateway-claims', '/personal-agent', '/privilege-gateway-topologies']) {
    test(`${route}: controls and diagram frames end inside the viewport`, async ({ page }) => {
      await visit(page, route, 'admin', 1.25);
      const bad = await page.evaluate(() => {
        const iw = window.innerWidth;
        const out = [];
        for (const e of document.querySelectorAll('main *')) {
          if (e.closest('.react-flow')) continue; // the diagram's own pannable canvas
          const cs = getComputedStyle(e);
          if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
          const q = e.getBoundingClientRect();
          if (q.width === 0 || q.height === 0 || q.right <= iw + 1) continue;
          let a = e.parentElement;
          let scrolls = false;
          while (a && a !== document.body) {
            if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= iw + 1) {
              scrolls = true;
              break;
            }
            a = a.parentElement;
          }
          if (!scrolls) out.push(`${e.tagName}.${String(e.className).slice(0, 30)}@${Math.round(q.right)}`);
        }
        return out.slice(0, 10);
      });
      expect(bad).toEqual([]);
    });
  }
});
