import fs from "node:fs";
import path from "node:path";

const topNavCss = fs.readFileSync(path.resolve(__dirname, "../TopNav.css"), "utf8");
const heroCss = fs.readFileSync(path.resolve(__dirname, "../AgentGreetingHero.module.css"), "utf8");
const verticalsRoot = path.resolve(__dirname, "../../../../demo_api_server/config/verticals");
const verticalThemes = fs.readdirSync(verticalsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const manifestPath = path.join(verticalsRoot, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { id: manifest.id || entry.name, cssVars: manifest.theme?.cssVars || {} };
  })
  .filter(Boolean);

const rgb = (hex) => hex.match(/[\da-f]{2}/gi).map((part) => Number.parseInt(part, 16));
const luminance = ([r, g, b]) => {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("dashboard text contrast", () => {
  it("uses theme text and keeps the session pill readable across vertical headers", () => {
    const label = topNavCss.match(/\.topnav-token-pill__session-label\s*\{([^}]+)\}/)?.[1] || "";
    const viewButton = topNavCss.match(/\.topnav-token-pill__view-btn\s*\{([^}]+)\}/)?.[1] || "";
    const viewButtonHover = topNavCss.match(/\.topnav-token-pill__view-btn:hover\s*\{([^}]+)\}/)?.[1] || "";
    const tokenPill = topNavCss.match(/\.topnav-token-pill\s*\{([^}]+)\}/)?.[1] || "";
    const pillOpacity = Number(tokenPill.match(/background:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/)?.[1]);
    const compositePillBackground = (hex) => rgb(hex).map((channel) => channel * (1 - pillOpacity));
    const declaration = (rule) => rule.match(/color:\s*([^;]+)/i)?.[1]?.trim();
    const resolveHeaderColor = (value, cssVars) => {
      if (/^#[\da-f]{6}$/i.test(value || "")) return value.slice(1);
      if (value === "var(--brand-navy)") return (cssVars["--theme-accent"] || "#1d4ed8").slice(1);
      return null;
    };

    expect(Number.isFinite(pillOpacity)).toBe(true);
    expect(declaration(label)).toMatch(/^var\(--brand-topnav-text/);
    expect(declaration(viewButton)).toMatch(/^var\(--brand-topnav-text/);
    expect(declaration(viewButtonHover)).toMatch(/^var\(--brand-topnav-text/);
    expect(verticalThemes.length).toBeGreaterThan(0);
    for (const { id, cssVars } of verticalThemes) {
      const foregroundColor = cssVars["--brand-topnav-text"] || cssVars["--brand-dashboard-header-text"] || "#ffffff";
      const foregroundRgb = rgb(foregroundColor);
      for (const headerValue of [cssVars["--brand-dashboard-header-start"], cssVars["--brand-dashboard-header-end"]]) {
        const background = resolveHeaderColor(headerValue, cssVars);
        if (!background) continue;
        expect(
          contrast(foregroundRgb, compositePillBackground(background)),
          `${id} header ${headerValue} needs readable token-pill text`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the white hero headline readable over the brightest possible image pixel", () => {
    const overlay = heroCss.match(/\.heroOverlay\s*\{([^}]+)\}/)?.[1] || "";
    const text = heroCss.match(/\.heroText\s*\{([^}]+)\}/)?.[1] || "";
    const foreground = text.match(/color:\s*(#[\da-f]{6})/i)?.[1];
    const opacities = [...overlay.matchAll(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g)]
      .map((match) => Number(match[1]));
    const worstBrightPixel = (opacity) => [255 * (1 - opacity), 255 * (1 - opacity), 255 * (1 - opacity)];

    expect(foreground).toBeTruthy();
    expect(opacities.length).toBeGreaterThan(0);
    expect(Math.min(...opacities.map((opacity) => contrast(rgb(foreground), worstBrightPixel(opacity)))))
      .toBeGreaterThanOrEqual(3);
  });
});
