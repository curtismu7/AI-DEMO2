import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every sign-in surface must resolve to the SAME accent, and a CSS custom
 * property that is never defined fails silently — the declaration is simply
 * dropped and the element renders with no background at all.
 *
 * That is exactly what shipped in PR #2519: `.signin-strip` used
 * `--th-primary-bg` / `--th-primary-border`, which are defined nowhere in the
 * app. Nothing failed; the strip just had no colour.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : cssFiles(full);
    return e.name.endsWith('.css') ? [full] : [];
  });
}

const FILES = cssFiles(SRC);
const ALL_CSS = FILES.map((f) => fs.readFileSync(f, 'utf8'));

/** Names defined anywhere as `--foo: value;` */
const defined = new Set(
  ALL_CSS.flatMap((t) => [...t.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])),
);

/** Selectors that style a sign-in surface. */
const SIGNIN =
  /^\.(signin-prompt|signin-strip|signin-modal|ba-left-auth|session-reauth-banner)/;

describe('sign-in surfaces use one defined accent', () => {
  it('references no custom property that is never defined', () => {
    const missing = [];

    FILES.forEach((file, i) => {
      for (const block of ALL_CSS[i].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = block[1].trim().split('\n').pop().trim();
        if (!SIGNIN.test(selector)) continue;

        // `var(--x)` with no comma has no fallback — undefined means no style.
        for (const use of block[2].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
          if (use[2] === ')' && !defined.has(use[1])) {
            missing.push(`${path.relative(SRC, file)} ${selector} ${use[1]}`);
          }
        }
      }
    });

    expect(missing).toEqual([]);
  });

  it('defines the shared accent in both themes, with the same value', () => {
    const index = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
    const values = [...index.matchAll(/--signin-accent:\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );

    // One for :root, one for :root[data-theme="dark"].
    expect(values).toHaveLength(2);
    // Deliberately identical — "sign in" must read the same in either theme.
    expect(values[0]).toBe(values[1]);
  });

  it('gives every sign-in button an explicit font-family', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.css'), 'utf8');

    // Buttons do not inherit font-family from body; without this the only
    // control on the surface renders in the browser's UI font.
    for (const sel of ['.signin-prompt__btn', '.session-reauth-banner__btn']) {
      const rule = app.match(
        new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`),
      );
      expect(rule?.[1], `${sel} must set font-family`).toMatch(/font-family:/);
    }
  });

  it('references no undefined custom property anywhere in the app CSS', () => {
    // Widened from the sign-in surfaces to every stylesheet: the same silent
    // failure was found in the modal shell's neighbours (--p1-mono,
    // --rsi-accent) during the pop-out audit.
    const missing = [];

    FILES.forEach((file, i) => {
      for (const use of ALL_CSS[i].matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
        if (use[2] === ')' && !defined.has(use[1])) {
          missing.push(`${path.relative(SRC, file)} ${use[1]}`);
        }
      }
    });

    expect([...new Set(missing)]).toEqual([]);
  });

  it('gives the modal shell dark-mode surfaces', () => {
    const index = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
    const dark = index.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? '';

    // Defined for light only, every pop-out modal kept a white body in dark mode.
    for (const token of ['--modal-body-bg', '--modal-footer-bg']) {
      expect(dark, `${token} needs a dark value`).toContain(token);
    }
  });

  it('leaves no amber left over from the old HITL palette', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.css'), 'utf8');
    const banner = app.match(
      /\.session-reauth-banner[\s\S]*?(?=\n\/\* ═|\n\.otp-step-up)/,
    )?.[0];

    // #b45309 / #92400e / #f59e0b / #fef3c7 / #78350f were the amber set the
    // session-expiry modal used to borrow from this banner.
    expect(banner).not.toMatch(/#(b45309|92400e|f59e0b|fef3c7|fde68a|78350f)/i);
  });
});
