// demo_api_ui/src/components/shared/__tests__/LoadingOverlay.darkCard.test.js
//
// .lo-card--dark is dark whatever the app theme is: its ground is a literal.
// Its text used to take var(--th-text), which is near-black in the light theme,
// so the loading message was dark ink on a dark card and could not be read
// (REGRESSION_PLAN §0 H1: never mix a literal ground with a tokenised ink).
// Text on that card must be a literal too.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../LoadingOverlay.css'), 'utf8');

/** Declarations of the first rule whose selector list is exactly `selector`. */
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[1] : null;
}

describe('LoadingOverlay always-dark card', () => {
  it('keeps a literal ground', () => {
    expect(declarations('.lo-card--dark')).toMatch(/background:\s*#[0-9a-f]{6}/i);
  });

  it.each(['.lo-card--dark .ping-spinner__label', '.lo-card--dark .lo-message'])(
    '%s uses literal white ink, not a theme token',
    (selector) => {
      const body = declarations(selector);
      expect(body).not.toBeNull();
      expect(body).toMatch(/color:\s*#ffffff/i);
      expect(body).not.toMatch(/var\(--th-/);
    },
  );
});
