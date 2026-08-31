'use strict';

// Thin client for Brandfetch — given a domain, returns the raw ingredients
// { logoPath, primary, accent, fontName }.
// Deliberately does NOT derive a full cssVars map: zone→CSS-var palette
// derivation is the frontend's job (demo_api_ui/src/config/themeZones.js),
// same as every other palette in this theming system.
//
// Talks to Brandfetch's MCP door (get_brand), NOT the REST Brand API. The REST
// key that used to live here leaked into public git history and Brandfetch does
// not support rotating it, so the only fix available was to stop depending on
// it — see TECH_DEBT.md 2026-08-31. There is deliberately no fallback to
// BRANDFETCH_API_KEY: a fallback would silently put the compromised credential
// back on the wire.
//
// The MCP payload is field-for-field the same shape as the old REST v2 response
// (colors[].hex/type, logos[].formats[].src, fonts[].name/type), so everything
// below fetchBrand() is unchanged from the REST implementation.

const MCP_URL = 'https://mcp.brandfetch.io/mcp';

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

function badGateway(message) {
  const err = new Error(message);
  err.status = 502;
  return err;
}

// The MCP door frames its reply as Server-Sent Events ("event: message\ndata: {…}")
// rather than a bare JSON body, and the brand payload arrives double-encoded — a
// JSON string inside result.content[0].text. Unwrap both layers here so fetchBrand
// keeps handling a plain object, exactly as it did with the REST response.
// Exported for tests: this framing is the only genuinely new logic in the file.
function parseMcpBrandPayload(body) {
  const dataLines = String(body).split('\n').filter((l) => l.startsWith('data:'));
  const raw = dataLines.length
    ? dataLines.map((l) => l.slice('data:'.length).trim()).join('')
    : String(body).trim();

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw badGateway('Brandfetch MCP returned an unparseable response');
  }
  if (envelope.error) {
    throw badGateway(`Brandfetch MCP error: ${envelope.error.message || 'unknown'}`);
  }

  const result = envelope.result || {};
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') throw badGateway('Brandfetch MCP returned no brand content');

  // A tool-level failure comes back as isError with the message in the same text
  // field — it is NOT a non-200, so it has to be checked explicitly. An unknown
  // domain is the common case and must stay a 404 for the caller.
  if (result.isError) {
    const err = new Error(text);
    err.status = /not\sfound|no\sbrand|could\snot\sfind|no\sresults/i.test(text) ? 404 : 502;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw badGateway('Brandfetch MCP returned malformed brand JSON');
  }
}

async function fetchBrand(domain) {
  const token = process.env.BRANDFETCH_MCP_TOKEN;
  if (!token) {
    const err = new Error('BRANDFETCH_MCP_TOKEN not configured on the server');
    err.status = 501;
    throw err;
  }

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // The door replies with SSE framing; it rejects the request without this Accept.
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_brand', arguments: { identifier: domain } },
    }),
  });
  if (!res.ok) throw badGateway(`Brandfetch MCP lookup failed (${res.status})`);

  const data = parseMcpBrandPayload(await res.text());

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

module.exports = { fetchBrand, parseMcpBrandPayload };
