import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The real colour tokens from src/index.css, so a contrast test measures the ground the app paints and not a
 * hex copied into the test (which stays green when the token changes).
 */
const INDEX_CSS = readFileSync(resolve(__dirname, '..', '..', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Value of a custom property in `theme` ('light' = :root, 'dark' = :root[data-theme="dark"] over :root). The last declaration wins, as in the cascade. */
export function themeToken(name, theme = 'light') {
  const blocks = (selector) => [...INDEX_CSS.matchAll(new RegExp(`(?:^|[}\\s])${selector}\\s*\\{([^{}]*)\\}`, 'g'))].map((m) => m[1]);
  const lookup = (bodies) => {
    let found = null;
    for (const body of bodies) for (const m of body.matchAll(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`, 'g'))) found = m[1].trim();
    return found;
  };
  const light = lookup(blocks(':root'));
  const value = theme === 'dark' ? lookup(blocks(':root\\[data-theme="dark"\\]')) ?? light : light;
  const alias = value && /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? themeToken(alias[1], theme) : value;
}

/** '#rrggbb' -> [r, g, b]; throws on anything else so a changed token format fails loudly instead of measuring NaN. */
export function hexRgb(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) throw new Error(`expected a #rrggbb token, got ${JSON.stringify(value)}`);
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
}
