/**
 * DraggableModal's body is `var(--modal-body-bg, #ffffff)` and has no
 * prefers-color-scheme rule, so the modal surface is white in every scheme.
 * Lightening text that sits directly on it — with no dark background of its
 * own — renders near-white on white and the text vanishes. That is
 * REGRESSION_PLAN §0's "no muted modal text".
 *
 * This locks the two rules that had the bug. It is deliberately NOT a general
 * "no light text in a dark block" linter: an ancestor often supplies the dark
 * background (`.mcm-guidance` sets one for its title and list, `.gmt-panel`
 * for the page facts), and a static check cannot resolve that. A broader
 * version flagged five such rules as false positives, and a guard that cries
 * wolf gets switched off.
 */
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = path.resolve(__dirname, '..');

function darkBlock(file) {
  const css = fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
  const start = css.search(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/);
  if (start === -1) return '';
  let depth = 0;
  let i = css.indexOf('{', start);
  const from = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  // Strip comments first: the explanatory notes left where these rules used
  // to live mention the very selectors being asserted against, and would
  // otherwise match.
  return css.slice(from, i).replace(/\/\*[\s\S]*?\*\//g, '');
}

it('the group-membership modal keeps dark body text in dark mode', () => {
  const block = darkBlock('GroupMembershipToggle.css');
  // The modal sits on DraggableModal's white surface; these must not be
  // lightened. `.gmt-facts dd` may be, since it lives in the dark `.gmt-panel`.
  expect(block).not.toMatch(/\.gmt-modal-body[^{}]*\{[^{}]*color/);
  expect(block).not.toMatch(/\.gmt-modal-tier[^{}]*\{[^{}]*color/);
  expect(block).not.toMatch(/\.gmt-modal\s*,[^{}]*\{[^{}]*color/);
});

it('the missing-credentials modal keeps dark field labels in dark mode', () => {
  const block = darkBlock('MissingCredentialsModal.css');
  expect(block).not.toMatch(/\.mcm-field label[^{}]*\{[^{}]*color/);
});

it('DraggableModal still has no dark-scheme surface, which is why the above holds', () => {
  const css = fs.readFileSync(path.join(COMPONENTS, 'DraggableModal.css'), 'utf8');
  expect(css).toMatch(/--modal-body-bg,\s*#ffffff/);
  // If this ever gains a dark surface, the two assertions above should be
  // revisited rather than deleted — the text would then need lightening.
  expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
});
