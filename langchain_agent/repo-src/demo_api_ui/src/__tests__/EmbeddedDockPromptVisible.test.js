/**
 * @file EmbeddedDockPromptVisible.test.js
 *
 * Guard test locking REGRESSION_PLAN §1 #45/#68:
 * The prompt input must remain present in bottom-dock render.
 *
 * Uses static source assertions (fs.readFileSync) because the repo's
 * JSDOM/JSX transform for component renders is environmentally broken.
 * This test MUST pass before and after Tasks 2-3 (dock identity rail + skin).
 */

const fs = require('fs');
const path = require('path');

const agentJsPath = path.resolve(
  __dirname,
  '../components/AIAgent.js',
);
const agentSource = fs.readFileSync(agentJsPath, 'utf8');

describe('REGRESSION_PLAN §1 #45/#68 — Bottom-dock prompt input visibility', () => {
  it('AIAgent.js renders the prompt input row (.ba-input-row .ba-input)', () => {
    // The prompt input must be in the JSX render tree.
    // Look for the combined pattern: input with className "ba-input" inside element with "ba-input-row".
    expect(agentSource).toMatch(
      /className=["']ba-input-row["'][\s\S]*?className=["']ba-input["']/,
    );
  });

  it('refinedDashboardV2.css does NOT set forbidden layout on .ba-body/.ba-left-col/.ba-right-col', () => {
    const cssPath = path.resolve(
      __dirname,
      '../theme/refinedDashboardV2.css',
    );
    const cssSource = fs.readFileSync(cssPath, 'utf8');

    // These selectors are locked by §1 #68 and can ONLY be set by AIAgent.css.
    // Check that our v2 stylesheet does not touch them.
    const forbiddenPatterns = [
      /\.ba-body\s*{[\s\S]*?flex-direction/,
      /\.ba-body\s*{[\s\S]*?overflow/,
      /\.ba-body\s*{[\s\S]*?display/,
      /\.ba-left-col\s*{[\s\S]*?flex-direction/,
      /\.ba-left-col\s*{[\s\S]*?overflow/,
      /\.ba-left-col\s*{[\s\S]*?display/,
      /\.ba-right-col\s*{[\s\S]*?flex-direction/,
      /\.ba-right-col\s*{[\s\S]*?overflow/,
      /\.ba-right-col\s*{[\s\S]*?display/,
    ];

    forbiddenPatterns.forEach((pattern) => {
      expect(cssSource).not.toMatch(pattern);
    });
  });
});
