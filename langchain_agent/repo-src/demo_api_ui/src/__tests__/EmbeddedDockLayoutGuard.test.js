/**
 * @file EmbeddedDockLayoutGuard.test.js
 *
 * Static guard for REGRESSION_PLAN §1 #45/#68 — the bottom-dock layout
 * invariants that keep the agent's prompt input visible.
 *
 * Render-based assertions are not viable here: the repo's JSDOM/JSX transform
 * for component renders of <BankingAgent> is environmentally broken (the
 * src/components/__tests__ render suites fail to parse JSX). So we guard the
 * invariant the same way App.structure.test.js does — static source assertions
 * via fs.readFileSync.
 *
 * What we lock:
 *  1. Our v2 stylesheet (refinedDashboardV2.css) must NOT set the forbidden
 *     layout properties (flex-direction / overflow / max-width / max-height /
 *     display) on the load-bearing selectors .ba-body / .ba-left-col /
 *     .ba-right-col. Those belong to AIAgent.css (§1 #68).
 *  2. AIAgent.js must still render the prompt input row (.ba-input-row
 *     containing .ba-input) — i.e. the input markup is present in source.
 */

const fs = require("fs");
const path = require("path");

const cssPath = path.resolve(
  __dirname,
  "../theme/refinedDashboardV2.css"
);
const agentJsPath = path.resolve(
  __dirname,
  "../components/AIAgent.js"
);

// Properties that AIAgent.css owns for the bottom dock (§1 #68).
const FORBIDDEN_PROPS = [
  "flex-direction",
  "overflow",
  "overflow-x",
  "overflow-y",
  "max-width",
  "max-height",
  "display",
];

// Load-bearing selectors our v2 CSS must never re-layout.
const LOCKED_SELECTORS = [".ba-body", ".ba-left-col", ".ba-right-col"];

/**
 * Extract CSS rule blocks ({ ... }) whose selector list contains `selector`,
 * then return the declarations inside. Naive but sufficient for our flat file.
 */
function declarationsForSelector(css, selector) {
  const blocks = [];
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorList = m[1];
    const body = m[2];
    if (selectorList.includes(selector)) {
      blocks.push(body);
    }
  }
  return blocks;
}

describe("Embedded bottom-dock layout guard (§1 #45/#68)", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  LOCKED_SELECTORS.forEach((selector) => {
    test(`refinedDashboardV2.css does not set layout props on ${selector}`, () => {
      const blocks = declarationsForSelector(css, selector);
      blocks.forEach((body) => {
        FORBIDDEN_PROPS.forEach((prop) => {
          // Match the property at the start of a declaration: "  prop:"
          const propRe = new RegExp(`(^|;|\\{)\\s*${prop}\\s*:`, "i");
          expect(propRe.test(body)).toBe(false);
        });
      });
    });
  });

  test("AIAgent.js still renders the prompt input row (.ba-input-row / .ba-input)", () => {
    const src = fs.readFileSync(agentJsPath, "utf8");
    expect(src.includes('className="ba-input-row"')).toBe(true);
    // The input itself carries the ba-input class (template or plain).
    expect(/className=("ba-input"|`ba-input)/.test(src)).toBe(true);
  });
});
