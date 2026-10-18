#!/usr/bin/env node
/**
 * Runtime contrast audit: renders every static route of the BUILT app (vite preview) as a mocked
 * signed-in admin, in light and dark themes, and checks every visible text element's colour
 * against the background it actually sits on (ancestor backgrounds composited, gradients judged
 * at their worst stop). This is the check the static CSS rule check cannot do: it sees colours
 * that are INHERITED into a container with a different background.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/audit-contrast-runtime.mjs [--base http://127.0.0.1:4173] [--out report.json] [--routes /a,/b]
 *
 * Exit 1 when violations exist outside the allowlist. Pages that fail to render without a backend
 * (error boundary, redirect to login) are reported as `unrendered` rather than silently passing.
 * Not run in CI: it needs a build, a browser and about a minute per hundred routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const BASE = arg('--base', 'http://127.0.0.1:4173');
const OUT = arg('--out', '');
const ONLY = arg('--routes', '');

function staticRoutes() {
  const files = [path.join(SRC, 'App.js'), ...fs.readdirSync(path.join(SRC, 'routes')).map((f) => path.join(SRC, 'routes', f))];
  const set = new Set();
  for (const f of files) {
    if (!f.endsWith('.js') && !f.endsWith('.jsx')) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/path=["'{`]+(\/[^"'`}]*)["'`}]/g)) {
      const p = m[1];
      if (!p.includes(':') && !p.includes('*') && p !== '/logout') set.add(p);
    }
  }
  return [...set].sort();
}

const ADMIN = { id: 'admin-id', username: 'admin', email: 'admin@test.com', role: 'admin' };
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page) {
  await page.route('**/api/**', (r) => r.fulfill(json({})));
  await page.route('**/api/auth/oauth/status', (r) => r.fulfill(json({ authenticated: true, user: ADMIN })));
  await page.route('**/api/auth/oauth/user/status', (r) => r.fulfill(json({ authenticated: false })));
  await page.route('**/api/auth/session**', (r) => r.fulfill(json({ authenticated: true, user: ADMIN })));
  await page.route('**/api/config/vertical**', (r) => r.fulfill(json({ manifest: null })));
  await page.route('**/api/admin/feature-flags**', (r) => r.fulfill(json({ flags: [] })));
  await page.route('**/api/admin/config**', (r) => r.fulfill(json({ config: {} })));
  await page.route('**/api/tokens/session-preview**', (r) => r.fulfill(json({ tokenEvents: [] })));
  // Block live-connection endpoints, but never a page navigation (e.g. the /mcp-inspector route).
  const blockBackground = (r) => (r.request().resourceType() === 'document' ? r.fallback() : r.abort());
  await page.route('**/ws**', blockBackground);
  await page.route('**/mcp**', blockBackground);
  await page.route('**/events**', blockBackground);
}

/** Runs in the page. Returns offenders for the current theme. */
function auditInPage() {
  const parse = (s) => {
    const c = s.match(/color\(srgb ([^)]+)\)/); // Chrome serialises gradient stops / color-mix this way
    if (c) {
      const q = c[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 };
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  /** Possible backgrounds (>1 for gradients): walk ancestors until an opaque one is found. */
  let lastOwner = null;
  const backgrounds = (el) => {
    let stack = []; // translucent layers, nearest first
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const img = cs.backgroundImage;
      if (img && img !== 'none' && /gradient/.test(img)) {
        const stops = [...img.matchAll(/(?:rgba?|color)\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean);
        if (stops.length && stops.every((s) => s.a > 0.99)) {
          lastOwner = e;
          return stops.map((s) => stack.reduceRight((acc, layer) => over(layer, acc), s));
        }
      }
      if (img && img !== 'none' && /url\(/.test(img)) return null; // photo/texture: cannot judge
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        if (bg.a > 0.99) { lastOwner = e; return [stack.reduceRight((acc, layer) => over(layer, acc), bg)]; }
        stack.push(bg);
      }
    }
    lastOwner = null;
    const root = { r: 255, g: 255, b: 255, a: 1 };
    return [stack.reduceRight((acc, layer) => over(layer, acc), root)];
  };
  const sig = (e) => {
    const cls = [...e.classList].slice(0, 2).join('.');
    return e.tagName.toLowerCase() + (cls ? `.${cls}` : '');
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.trim();
    if (text.length < 2 || !/[A-Za-z0-9]/.test(text)) continue; // emoji/icon glyphs carry their own colour
    const el = n.parentElement;
    // Exempt on purpose: third-party attribution and per-vertical brand colour badges.
    if (el && el.closest('.react-flow__attribution, .vops__icon')) continue;
    if (!el || seen.has(el) || el.closest('script,style,noscript,svg,option,[aria-hidden="true"],[disabled],:disabled,[inert]')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fgc = parse(cs.color);
    if (!fgc || fgc.a === 0) continue;
    const fill = parse(cs.webkitTextFillColor || '');
    if (fill && fill.a === 0) continue; // gradient-clipped text (background-clip: text) paints its own fill
    lastOwner = null;
    const bgs = backgrounds(el);
    if (!bgs) continue;
    const size = Number.parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    let worst = Infinity;
    for (const bg of bgs) worst = Math.min(worst, ratio(over(fgc, bg), bg));
    if (worst < need) {
      out.push({
        owner: lastOwner ? [...lastOwner.classList].join('.') : '',
        sel: sig(el),
        parent: el.parentElement ? sig(el.parentElement) : '',
        text: text.slice(0, 40),
        fg: cs.color,
        bg: bgs.map((b) => `rgb(${Math.round(b.r)},${Math.round(b.g)},${Math.round(b.b)})`).join(' → '),
        ratio: Math.round(worst * 100) / 100,
        need,
      });
    }
  }
  return out;
}

const routes = ONLY ? ONLY.split(',') : staticRoutes();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, storageState: path.resolve(here, '../tests/e2e/helpers/e2e-storage-state.json') });
const page = await ctx.newPage();
await mock(page);

const found = new Map(); // key -> { ...violation, routes:Set, themes:Set }
const unrendered = [];
let rendered = 0;
for (const route of routes) {
  try {
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      // Pages that redirect mid-load interrupt goto; audit whatever settled.
      if (!/interrupted/i.test(String(e.message))) throw e;
    }
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    await page.waitForTimeout(900);
    const textLen = await page.evaluate(() => document.body.innerText.trim().length);
    const url = new URL(page.url());
    if (textLen < 40 || url.pathname !== route.split('#')[0].split('?')[0] && /login|logout|sign/i.test(url.pathname)) {
      unrendered.push(route);
      continue;
    }
    rendered++;
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(120);
      for (const v of await page.evaluate(auditInPage)) {
        const key = `${v.sel}|${v.parent}|${v.fg}|${v.bg}|${theme}`;
        const cur = found.get(key) ?? { ...v, theme, routes: new Set() };
        cur.routes.add(route);
        found.set(key, cur);
      }
    }
  } catch (e) {
    unrendered.push(`${route} (${String(e.message).split('\n')[0].slice(0, 60)})`);
  }
}
await browser.close();

const list = [...found.values()].map((v) => ({ ...v, routes: [...v.routes] })).sort((a, b) => b.routes.length - a.routes.length || a.ratio - b.ratio);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rendered, unrendered, violations: list }, null, 1));
console.log(`routes: ${routes.length}  rendered: ${rendered}  unrendered: ${unrendered.length}  unique violations: ${list.length}`);
for (const v of list.slice(0, 40)) {
  console.log(`${v.ratio}:1 [${v.theme}] ${v.parent} > ${v.sel}  "${v.text}"  ${v.fg} on ${v.bg}  (${v.routes.length} route${v.routes.length > 1 ? 's' : ''}: ${v.routes.slice(0, 2).join(', ')})`);
}
process.exit(list.length ? 1 : 0);
