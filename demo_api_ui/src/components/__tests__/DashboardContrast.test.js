import fs from "node:fs";
import path from "node:path";
import { INDUSTRY_PRESETS } from "../../config/industryPresets";

const topNavCss = fs.readFileSync(path.resolve(__dirname, "../TopNav.css"), "utf8");
const heroCss = fs.readFileSync(path.resolve(__dirname, "../AgentGreetingHero.module.css"), "utf8");

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
  it("keeps the customer session label and token action readable across branded navigation colors", () => {
    const label = topNavCss.match(/\.topnav-token-pill__session-label\s*\{([^}]+)\}/)?.[1] || "";
    const viewButton = topNavCss.match(/\.topnav-token-pill__view-btn\s*\{([^}]+)\}/)?.[1] || "";
    const viewButtonHover = topNavCss.match(/\.topnav-token-pill__view-btn:hover\s*\{([^}]+)\}/)?.[1] || "";
    const tokenPill = topNavCss.match(/\.topnav-token-pill\s*\{([^}]+)\}/)?.[1] || "";
    const pillOpacity = Number(tokenPill.match(/background:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/)?.[1]);
    const navBackgrounds = ["1d4ed8", ...INDUSTRY_PRESETS.flatMap(({ cssVars }) => [
      cssVars["--brand-dashboard-header-start"],
      cssVars["--brand-dashboard-header-end"],
    ].filter((value) => /^#[\da-f]{6}$/i.test(value)).map((value) => value.slice(1)))];
    const compositePillBackground = (hex) => rgb(hex).map((channel) => channel * (1 - pillOpacity));
    const foreground = (rule) => rule.match(/color:\s*(#[\da-f]{6})/i)?.[1];

    expect(Number.isFinite(pillOpacity)).toBe(true);
    expect(foreground(label)).toBeTruthy();
    expect(foreground(viewButton)).toBeTruthy();
    expect(foreground(viewButtonHover)).toBeTruthy();
    for (const background of navBackgrounds) {
      const renderedBackground = compositePillBackground(background);
      expect(contrast(rgb(foreground(label)), renderedBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(foreground(viewButton)), renderedBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(foreground(viewButtonHover)), renderedBackground)).toBeGreaterThanOrEqual(4.5);
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
