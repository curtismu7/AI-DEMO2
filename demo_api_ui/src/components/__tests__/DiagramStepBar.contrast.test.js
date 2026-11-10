// The Reset button on the shared DiagramStepBar. Idle (no walkthrough running) it is disabled, which is the state a
// page loads in, and it was painted with `opacity: .5`: the label measured 3.46:1 and the edge 1.89:1 in the light theme.
// Every colour here is read from the real tokens and the real stylesheet, in both themes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hexRgb, themeToken } from "../../__tests__/helpers/themeTokens";

const CSS = readFileSync(resolve(__dirname, "..", "DiagramStepBar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(CSS);
  return m ? m[1] : "";
};
const prop = (body, name) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
// var(--x) -> theme token; only a single bare var() is accepted, anything else fails loudly
const colour = (value, theme) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value || "");
  if (!m) throw new Error(`expected a single var(--token), got ${JSON.stringify(value)}`);
  return hexRgb(themeToken(m[1], theme));
};
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// opacity composites the whole button (label and edge) over what is behind it
const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));

describe("DiagramStepBar Reset contrast", () => {
  const base = rule(".dstep-reset");
  const disabled = rule(".dstep-reset:disabled");
  // the bar paints --th-bg-card; the idle (disabled) button paints its own --th-bg-inset
  const states = [
    ["enabled", base, base],
    ["disabled", disabled, base],
  ];

  it("never fades the button with opacity (alpha is what took it to 3.46:1)", () => {
    expect(base).not.toMatch(/opacity/);
    expect(disabled).not.toMatch(/opacity/);
  });

  for (const theme of ["light", "dark"]) {
    for (const [name, own, fallback] of states) {
      it(`${name}: label >= 4.5:1 and edge >= 3:1 against its ground in the ${theme} theme`, () => {
        const ground = colour(prop(own, "background") ?? prop(fallback, "background"), theme);
        // the edge is also checked against the bar behind the button, since that is what outlines it
        const bar = colour(prop(rule(".dstep-bar"), "background"), theme);
        const alpha = parseFloat(prop(own, "opacity") ?? prop(fallback, "opacity") ?? "1");
        const inkRaw = colour(prop(own, "color") ?? prop(fallback, "color"), theme);
        const edgeRaw = colour(prop(own, "border-color") ?? prop(fallback, "border")?.split(/\s+/).find((t) => t.startsWith("var(")), theme);
        const ink = over(inkRaw, alpha, bar);
        const edge = over(edgeRaw, alpha, bar);
        // measured numbers, printed so a failure (and the PR) shows the real ratios
        const measured = { label: ratio(ink, ground), edgeOnButton: ratio(edge, ground), edgeOnBar: ratio(edge, bar) };
        const say = JSON.stringify(measured);
        expect(measured.label, say).toBeGreaterThanOrEqual(4.5);
        expect(measured.edgeOnButton, say).toBeGreaterThanOrEqual(3);
        expect(measured.edgeOnBar, say).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
