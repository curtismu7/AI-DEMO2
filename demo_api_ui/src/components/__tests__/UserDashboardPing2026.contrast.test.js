/**
 * Contrast pins for the two things the /dashboard conversion recoloured, measured from the real tokens (index.css)
 * and the real rules, in both themes:
 *  - the middle resize handle's grip, which sits on the always-dark band the customer skin gives the handle
 *    (customerSkinPing2026.css, #263746 in both themes): 3:1 or better at rest, on hover and on focus (WCAG 1.4.11);
 *  - the four transaction-type icons of the recent-activity feed: 4.5:1 or better for the glyph on its fill.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Top-level `selector { body }` blocks whose selector is exactly `sel`. */
function blocks(css, sel) {
  const out = [];
  const re = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth && i < css.length) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

function tokenMap(css, sel, base = {}) {
  const map = { ...base };
  for (const body of blocks(css, sel)) for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}

const index = read("index.css");
const LIGHT = tokenMap(index, ":root");
const DARK = tokenMap(index, ':root[data-theme="dark"]', LIGHT);

const resolve = (map, value, depth = 0) => {
  const v = value.trim();
  const m = /^var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)$/.exec(v);
  if (!m) return v;
  if (depth > 8) throw new Error(`token loop at ${v}`);
  if (map[m[1]] !== undefined) return resolve(map, map[m[1]], depth + 1);
  if (m[2]) return resolve(map, m[2], depth + 1);
  throw new Error(`unresolved ${v}`);
};

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** color-mix(in srgb, a p%, b): channel-wise in gamma-encoded sRGB, as the spec does. */
const mix = (a, p, b) => a.map((c, i) => c * p + b[i] * (1 - p));

const themes = { light: LIGHT, dark: DARK };

describe("resize handle grip contrast on its real band", () => {
  const skin = read("components/customerSkinPing2026.css");
  const bandRule = /\.customer-skin-p1 \.ud-middle-resize-handle\s*\{([^}]*)\}/.exec(skin);
  const band = rgb(/background:\s*(#[0-9a-f]{6})/i.exec(bandRule[1])[1]);
  const css = read("components/UserDashboard.css");

  const bar = /\.ud-middle-resize-handle__bar\s*\{([^}]*)\}/.exec(css)[1];
  const hover = /\.ud-middle-resize-handle:hover \.ud-middle-resize-handle__bar,\s*\.ud-middle-resize-handle:focus-visible \.ud-middle-resize-handle__bar\s*\{([^}]*)\}/.exec(css)[1];

  it("the band is a literal dark colour, the same in both themes (so the grip needs a light tone)", () => {
    expect(bandRule).not.toBeNull();
    expect(lum(band)).toBeLessThan(0.05);
  });

  for (const [name, map] of Object.entries(themes)) {
    it(`${name}: the grip at rest is 3:1 or better on the band`, () => {
      const m = /color:\s*color-mix\(in srgb,\s*(var\([^)]+\))\s+(\d+)%,\s*(var\([^)]+\))\)/.exec(bar);
      expect(m, "the grip's resting colour is a color-mix of two tokens").not.toBeNull();
      const colour = mix(rgb(resolve(map, m[1])), Number(m[2]) / 100, rgb(resolve(map, m[3])));
      expect(/background:\s*currentColor/.test(bar)).toBe(true);
      expect(ratio(colour, band)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: the grip on hover and focus is 3:1 or better on the band`, () => {
      const m = /color:\s*(var\([^)]+\))/.exec(hover);
      expect(m).not.toBeNull();
      expect(/background:\s*currentColor/.test(hover)).toBe(true);
      expect(ratio(rgb(resolve(map, m[1])), band)).toBeGreaterThanOrEqual(3);
    });
  }

  it("the focus outline stays 2px in the focus-ring token", () => {
    expect(css).toMatch(/\.ud-middle-resize-handle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--th-focus-ring\)/);
  });
});

describe("transaction-type icons in the recent-activity feed", () => {
  const css = read("components/UserDashboardPing2026.pingUi.css");
  const kinds = ["withdrawal", "deposit", "transfer", "other"];

  for (const kind of kinds) {
    const body = new RegExp(`\\.udp-page \\.tx-row__icon--${kind}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
    for (const [name, map] of Object.entries(themes)) {
      it(`${kind} (${name}): glyph on fill is 4.5:1 or better`, () => {
        expect(body, `.tx-row__icon--${kind} rule`).toBeTruthy();
        const fg = resolve(map, /(?:^|[\s;])color:\s*([^;]+);/.exec(body)[1]);
        const bg = resolve(map, /background:\s*([^;]+);/.exec(body)[1]);
        expect(ratio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("the four looks are distinct (four different fills in light and in dark)", () => {
    for (const map of Object.values(themes)) {
      const fills = kinds.map((kind) => {
        const body = new RegExp(`\\.udp-page \\.tx-row__icon--${kind}\\s*\\{([^}]*)\\}`).exec(css)[1];
        return resolve(map, /background:\s*([^;]+);/.exec(body)[1]);
      });
      expect(new Set(fills).size).toBe(4);
    }
  });

  it("the page file carries no colour literal for them", () => {
    const jsx = read("components/DashboardBankingMain.jsx");
    expect(jsx).not.toMatch(/#(?:fff1f2|be123c|f0fdf4|15803d|eff6ff|1d4ed8|f9fafb|6b7280)/i);
    expect(jsx).not.toMatch(/style=\{\{\s*background:\s*ts\./);
  });
});
