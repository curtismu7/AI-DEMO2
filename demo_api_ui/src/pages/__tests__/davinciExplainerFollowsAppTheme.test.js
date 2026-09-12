import fs from 'node:fs';
import path from 'node:path';

// This page used to own its light/dark state: a private palette, its own
// sun/moon toggle, and a `data-theme` attribute on its own wrapper seeded from
// `prefers-color-scheme`. Flipping the app's theme did nothing here.
//
// Nothing app-wide would have caught it. themingRatchet counts light-only
// stylesheets, and this page had no stylesheet at all — 270 lines of CSS lived
// in a template literal, invisible to every CSS gate. modalDarkSchemeContrast
// bans prefers-color-scheme, but only inside the modal shell.
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

// Both files EXPLAIN the old behaviour in comments, naming the very strings
// asserted against below. Strip comments first so the documentation can stay.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('/davinci-orchestration follows the app theme', () => {
  const jsx = stripComments(read('../DavinciExplainerPage.jsx'));
  const css = stripComments(read('../DavinciExplainerPage.css'));

  it('keeps its CSS in a stylesheet, not an inline <style> blob', () => {
    // REGRESSION_PLAN §0 H3. An inline blob is also why no CSS gate saw it.
    expect(jsx).not.toMatch(/<style>/);
    expect(jsx).toMatch(/import ["']\.\/DavinciExplainerPage\.css["']/);
  });

  it('sets no data-theme of its own', () => {
    // The app writes data-theme on :root (ThemeContext). A second one here
    // shadows it for this subtree, which is how the page got stranded.
    expect(jsx).not.toMatch(/data-theme=/);
    expect(css).not.toMatch(/\.davinci-explainer\[data-theme/);
  });

  it('is not keyed to the OS colour scheme', () => {
    // THEMING.md: dark is :root[data-theme="dark"] only, never
    // prefers-color-scheme.
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(jsx).not.toMatch(/prefers-color-scheme/);
  });

  it('does not borrow the global .btn-primary class for its CTA', () => {
    // .btn-primary is a claimed global button class that App.css skins with
    // `color: var(--th-text-invert) !important`. Borrowing it forces white ink
    // on whatever ground this page sets — which measured 1.8:1 in dark mode
    // once --accent became a theme token. The CTA is dvx-cta and styles itself.
    expect(jsx).not.toMatch(/className=["']btn-primary["']/);
    expect(jsx).toMatch(/className=["']dvx-cta["']/);
  });

  it('resolves its private palette from --th-* tokens', () => {
    // The ~210 rules below the mapping block reference no colour literal at
    // all, so this block is the page's entire relationship with the theme.
    for (const v of ['--bg', '--surface', '--text', '--accent', '--accent-ink']) {
      expect(css, `${v} must map to a --th-* token`).toMatch(
        new RegExp(`${v}:\\s*var\\(--th-`),
      );
    }
  });
});
