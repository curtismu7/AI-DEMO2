// demo_api_ui/src/__tests__/indexHtmlBoot.test.js
//
// index.html paints before any JS bundle loads. It used to paint a solid light
// block for every full reload, so a user in dark mode got a bright flash on each
// return from a sign-in redirect: ThemeContext only sets data-theme after React
// mounts. These checks pin the two fixes: the saved theme is applied in <head>
// before first paint, and the boot screen has a dark variant keyed to
// data-theme (never prefers-color-scheme) plus a shell skeleton.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_STORAGE_KEY } from '../context/ThemeContext';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function bootThemeScript() {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no inline <script> found in index.html');
  return match[1];
}

function runBootScript({ stored, throws = false }) {
  const attrs = {};
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  const storage = {
    getItem: (key) => {
      if (throws) throw new Error('storage disabled');
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('localStorage', 'document', bootThemeScript())(storage, doc);
  return attrs;
}

describe('index.html boot screen', () => {
  it('applies the saved dark theme before React mounts', () => {
    expect(runBootScript({ stored: 'true' })).toEqual({ 'data-theme': 'dark' });
  });

  it('leaves light mode alone', () => {
    expect(runBootScript({ stored: 'false' })).toEqual({});
    expect(runBootScript({ stored: null })).toEqual({});
  });

  it('survives storage being unavailable', () => {
    expect(() => runBootScript({ stored: 'true', throws: true })).not.toThrow();
  });

  it('runs before the stylesheet so first paint already has the right theme', () => {
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<style>'));
  });

  it('has a dark boot variant keyed to data-theme, never to the OS setting', () => {
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).not.toMatch(/prefers-color-scheme/);
  });

  it('shares the skeleton rules with the React loading screen (.boot-skeleton)', () => {
    // AuthLoadingScreen draws the same skeleton while the sign-in check runs. If these
    // selectors drift apart, a refresh swaps two different screens and flashes again.
    expect(html).toMatch(/#boot-spinner,\s*\.boot-skeleton\s*\{[^}]*position:\s*fixed/);
    expect(html).toMatch(/:root\[data-theme="dark"\] #boot-spinner,\s*:root\[data-theme="dark"\] \.boot-skeleton\s*\{[^}]*background-color/);
    expect(html).toMatch(/@media \(max-width: 768px\)\s*\{\s*#boot-spinner,\s*\.boot-skeleton\s*\{/);
  });

  it('keeps the CSS ring on the HTML boot screen only (React draws the Ping spinner)', () => {
    expect(html).toContain('#boot-spinner::after');
    expect(html).not.toMatch(/\.boot-skeleton::after/);
  });

  it('draws a shell skeleton, not a bare blank block', () => {
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*\n/);
    expect(root).not.toBeNull();
    for (const part of ['boot-bar', 'boot-nav', 'boot-main']) {
      expect(html).toContain(`class="${part}"`);
    }
  });
});
