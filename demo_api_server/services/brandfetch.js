'use strict';

// Thin client for Brandfetch's Brand API (https://docs.brandfetch.com) — given a
// domain, returns the raw ingredients { logoPath, primary, accent, fontName }.
// Deliberately does NOT derive a full cssVars map: zone→CSS-var palette
// derivation is the frontend's job (demo_api_ui/src/config/themeZones.js),
// same as every other palette in this theming system. Requires
// BRANDFETCH_API_KEY (a REST API key from the Brandfetch developer dashboard —
// separate from the MCP OAuth token).

const API_BASE = 'https://api.brandfetch.io/v2';

// ponytail: priority order for "the" brand color when Brandfetch returns
// several: dark > brand > accent > light. A fuller perceptual-contrast pick
// isn't worth it for a demo rebrand tool.
const COLOR_PRIORITY = ['dark', 'brand', 'accent', 'light'];

function pickColor(colors, type) {
  return colors.find((c) => c.type === type)?.hex || null;
}

function bestLogoUrl(logos) {
  const svgLogo = logos.find((l) => l.type === 'logo' && l.formats?.some((f) => f.format === 'svg'));
  const pick = svgLogo || logos.find((l) => l.formats?.some((f) => f.format === 'svg')) || logos[0];
  const format = pick?.formats?.find((f) => f.format === 'svg') || pick?.formats?.[0];
  return format?.src || null;
}

async function fetchBrand(domain) {
  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) {
    const err = new Error('BRANDFETCH_API_KEY not configured on the server');
    err.status = 501;
    throw err;
  }

  const res = await fetch(`${API_BASE}/brands/domain/${encodeURIComponent(domain)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const err = new Error(res.status === 404 ? `No brand found for "${domain}"` : `Brandfetch lookup failed (${res.status})`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  const data = await res.json();

  const colors = data.colors || [];
  const primary = COLOR_PRIORITY.map((t) => pickColor(colors, t)).find(Boolean) || '#111111';
  const accent = pickColor(colors, 'accent') || pickColor(colors, 'light') || primary;
  const logoPath = bestLogoUrl(data.logos || []);
  // "title" font (headings/wordmark) over "body" — closer to what a brand's
  // primary typeface usually is.
  const fontName = (data.fonts || []).find((f) => f.type === 'title')?.name
    || (data.fonts || [])[0]?.name
    || null;

  return { logoPath, primary, accent, fontName };
}

module.exports = { fetchBrand };
