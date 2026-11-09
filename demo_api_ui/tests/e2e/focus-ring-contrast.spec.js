/**
 * @file focus-ring-contrast.spec.js
 * Real-keyboard checks of keyboard focus visibility on shared pieces, in light AND dark theme (WCAG 2.4.7, 1.4.11):
 * the computed outline of the focused control must be at least 3:1 against the ground it sits on (the nearest painted
 * ancestor background; a gradient band is checked against every colour stop). API is stubbed — no server, no sign-in.
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4000 npx playwright test tests/e2e/focus-ring-contrast.spec.js
 */
const { test, expect } = require('@playwright/test');

const THEMES = ['light', 'dark'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"stub"}' }));
  await page.route('**/ws**', (route) => route.abort());
});

async function openPage(page, route, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('demo_welcome_seen', '1');
      localStorage.setItem('ba_dark_mode', t === 'dark' ? 'true' : 'false');
    } catch (_) {}
  }, theme);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root *', { timeout: 30_000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  // A key press first, so a programmatic focus() afterwards matches :focus-visible exactly as a Tab landing does.
  await page.keyboard.press('Shift');
}

/** Contrast of the ring on `selectorOrEl` (the focused element, or `ringHost` when the ring is on a wrapper). */
async function ringContrast(page, { ringHost } = {}) {
  return page.evaluate((host) => {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const rgbs = (s) => [...String(s).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)].filter((m) => m[4] === undefined || Number(m[4]) > 0.95).map((m) => [+m[1], +m[2], +m[3]]);
    const focused = document.activeElement;
    if (!focused || focused === document.body) return { error: 'focus fell to the body' };
    const ringEl = (host && focused.closest(host)) || focused;
    const cs = getComputedStyle(ringEl);
    // a two-tone ring (outline + a solid 0-blur shadow) is as good as its better tone against a given ground
    const tones = [...rgbs(cs.outlineColor), ...(/ 0px 0px 0px /.test(cs.boxShadow) ? rgbs(cs.boxShadow).slice(0, 1) : [])];
    // the app scales CSS px (page zoom), so a 2px ring computes to about 1.8px
    const painted = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1.5;
    // ground: first ancestor (starting at the ring host) with a painted background; a gradient contributes every stop
    let grounds = [];
    for (let el = ringEl.parentElement; el && !grounds.length; el = el.parentElement) {
      const s = getComputedStyle(el);
      const stops = s.backgroundImage !== 'none' ? rgbs(s.backgroundImage) : [];
      grounds = stops.length ? stops : rgbs(s.backgroundColor);
    }
    if (!grounds.length) grounds = [[255, 255, 255]];
    const worst = tones.length && grounds.length ? Math.min(...grounds.map((g) => Math.max(...tones.map((t) => ratio(t, g))))) : 0;
    const name = (focused.getAttribute('aria-label') || focused.textContent || '').trim().slice(0, 50);
    return { painted, fv: focused.matches(':focus-visible'), ring: cs.outlineColor, name, worst: Math.round(worst * 100) / 100 };
  }, ringHost);
}

/** Focus an element and make sure it keeps focus: the stubbed-401 page settles (re-renders) for a moment after load. */
async function focusAndHold(page, locator) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await target.focus();
    await page.waitForTimeout(300);
    const held = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (held) return;
  }
}

async function expectRing(page, locator, opts) {
  await focusAndHold(page, locator);
  const r = await ringContrast(page, opts);
  expect(r.error, r.error).toBeUndefined();
  expect(r.fv, `${r.name} is not :focus-visible`).toBe(true);
  expect(r.painted, `${r.name}: no painted outline`).toBe(true);
  expect(r.worst, `${r.name}: ring ${r.ring} is ${r.worst}:1 on its ground`).toBeGreaterThanOrEqual(3);
}

for (const theme of THEMES) {
  test.describe(`focus rings (${theme})`, () => {
    test('a button inside the dark page-header band (/owasp)', async ({ page }) => {
      await openPage(page, '/owasp', theme);
      await expectRing(page, page.locator('.ping-page-header button'));
    });

    test('a movie-reel card and the diagram toolbar (/delegation-chain-value)', async ({ page }) => {
      await openPage(page, '/delegation-chain-value', theme);
      await expectRing(page, page.locator('.dreel-card'));
      await expectRing(page, page.locator('.dc-toolbar .dc-ctrl-btn--simulate'));
    });

    test('the product nav on the /ai-products band, and a body link', async ({ page }) => {
      await openPage(page, '/ai-products/gateway', theme);
      await expectRing(page, page.locator('.pai-product-nav__link:not(.pai-product-nav__link--active)'));
      await expectRing(page, page.locator('.pai-next a'));
    });

    test('a diagram participant box is a named stop with a visible ring (/gateway-claims)', async ({ page }) => {
      await openPage(page, '/gateway-claims', theme);
      await expectRing(page, page.locator('.react-flow__node-part[tabindex="0"]'));
    });

    test('the personal-agent message field rings its wrapper and the send button is named (/personal-agent)', async ({ page }) => {
      await openPage(page, '/personal-agent', theme);
      const input = page.getByRole('textbox', { name: 'Message' }).first();
      await expectRing(page, input, { ringHost: '.acs-field' });
      await expect(page.getByRole('button', { name: 'Send message' }).first()).toBeVisible();
      // the token-chain strip's trigger sits on a navy header bar in both themes (its ring was the browser default)
      await expectRing(page, page.locator('.cvm-trigger, .tcfs-more-trigger'));
    });

    test('React Flow zoom controls read in this theme (/gateway-claims)', async ({ page }) => {
      await openPage(page, '/gateway-claims', theme);
      const worst = await page.evaluate(() => {
        const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
        return Math.min(...[...document.querySelectorAll('.react-flow__controls-button')].map((b) => {
          const cs = getComputedStyle(b);
          const [hi, lo] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((a, c) => c - a);
          return (hi + 0.05) / (lo + 0.05);
        }));
      });
      expect(worst, `controls icon on button = ${worst}:1`).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe('diagram keyboard path', () => {
  test('Tab from the toolbar never lands on an unnamed or hidden diagram stop (/delegation-chain-value)', async ({ page }) => {
    await openPage(page, '/delegation-chain-value', 'light');
    await page.getByRole('button', { name: /^simulate/i }).first().focus();
    const stops = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const el = document.activeElement;
        const inFlow = !!el.closest('.react-flow__renderer, .react-flow__node, .react-flow__edge');
        const r = el.getBoundingClientRect();
        return { inFlow, tag: el.tagName, cls: String(el.getAttribute('class') || ''), name: (el.getAttribute('aria-label') || el.textContent || '').trim(), w: r.width, h: r.height };
      }));
    }
    const flow = stops.filter((s) => s.inFlow && /react-flow__(node|edge)/.test(s.cls));
    expect(flow.length).toBeGreaterThan(0);
    for (const s of flow) {
      expect(s.name, `unnamed diagram stop ${s.cls}`).not.toBe('');
      expect(s.cls).not.toMatch(/node-(anchor|lifeline|payload|note)|react-flow__edge/);
      expect(Math.min(s.w, s.h), `${s.cls} is a sliver`).toBeGreaterThan(8);
    }
  });

  test('closing the reel details puts focus on a card, not the body (/delegation-chain-value)', async ({ page }) => {
    await openPage(page, '/delegation-chain-value', 'light');
    await focusAndHold(page, page.locator('.dreel-card').nth(1));
    await page.keyboard.press('Enter');
    const close = page.getByRole('button', { name: 'Close details' }).first();
    await focusAndHold(page, close);
    await page.keyboard.press('Enter');
    await expect(page.locator('.dreel-detail')).toHaveCount(0);
    const onCard = await page.evaluate(() => document.activeElement?.classList.contains('dreel-card'));
    expect(onCard, 'focus fell off the card').toBe(true);
  });
});
