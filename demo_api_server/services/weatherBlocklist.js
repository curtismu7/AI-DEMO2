'use strict';
/**
 * Blocked-city list for the weather-mcp gateway showcase.
 *
 * The Agent Gateway's tx-weather-scope.groovy denies a call when the location
 * is on this list. It is stored here rather than as a feature flag because the
 * flag registry only carries booleans and enums — there is no list type.
 *
 * WHY EACH ENTRY CARRIES COORDINATES
 * The gateway sees two different call shapes and a name-only block only stops
 * one of them:
 *   - demo chip      -> city_name: "Miami"        (nlIntentParser extracts it verbatim)
 *   - typed prompt   -> latitude/longitude        (the LLM calls weather-mcp's
 *                                                  search_location first, then
 *                                                  get_current_conditions)
 * That is observed, not theoretical: "what's the weather in Denver, CO" arrived
 * as coordinates, which is why it rendered a location list and no weather. So a
 * name-only list would pass every scripted chip and then fail the moment anyone
 * types a city — the worst possible place for a policy demo to break.
 *
 * Geocoding happens ONCE, when a city is added, not per request: a lookup in
 * the gateway's hot path would put an outbound third-party call inside the
 * policy decision.
 */

const configStore = require('./configStore');

const STORE_KEY = 'weather_mcp_blocked_cities';

/**
 * Half-width of the blocked box around a city's coordinates, in degrees.
 * ~0.2 deg is roughly 22 km N/S — a city plus its inner suburbs, and small
 * enough that neighbouring metros stay distinct (Miami at 25.77 does not
 * swallow Fort Lauderdale at 26.12).
 */
const BLOCK_RADIUS_DEG = 0.2;

/** Shipped default so the demo has a working deny before anyone configures one. */
const SEED = [{ label: 'Miami, FL', lat: 25.7743, lon: -80.1937 }];

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Entries that survive a round-trip through the store, shape-checked. */
function normalize(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const e of list) {
    if (!e || typeof e.label !== 'string' || !e.label.trim()) continue;
    if (!isFiniteNum(e.lat) || !isFiniteNum(e.lon)) continue;
    out.push({ label: e.label.trim(), lat: e.lat, lon: e.lon });
  }
  return out;
}

/**
 * Current blocklist. Falls back to the seed when unset — but NOT when the admin
 * has deliberately emptied it, or "remove the last city" would silently restore
 * Miami and the control would look broken.
 */
function getBlockedCities() {
  const raw = configStore.getEffective(STORE_KEY);
  if (raw === null || raw === undefined || raw === '') return SEED.slice();
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return SEED.slice();
    }
  }
  const clean = normalize(parsed);
  return clean === null ? SEED.slice() : clean;
}

// setRaw is the same persistence path the feature-flags PATCH uses, and it is
// async — the list must be durable before the response says it saved.
async function saveBlockedCities(list) {
  const clean = normalize(list) || [];
  await configStore.setRaw({ [STORE_KEY]: JSON.stringify(clean) });
  return clean;
}

/** Case/whitespace-insensitive identity — "miami, fl" and "Miami, FL" are one city. */
function sameLabel(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Resolve a free-text place to coordinates via Nominatim — the SAME geocoder
 * weather-mcp's own search_location uses, so the coordinates we block are the
 * coordinates the agent will send.
 *
 * @returns {Promise<{label: string, lat: number, lon: number}>}
 * @throws  {Error} with .status 404 when nothing matches, 502 when the lookup fails
 */
async function geocodeCity(query, { fetchImpl = fetch } = {}) {
  const q = String(query || '').trim();
  if (!q) {
    const err = new Error('city is required');
    err.status = 400;
    throw err;
  }
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(q);
  let res;
  try {
    res = await fetchImpl(url, {
      // Nominatim rejects requests without an identifying User-Agent.
      headers: { 'User-Agent': 'ai-demo-weather-blocklist/1.0' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const err = new Error(`geocode lookup failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`geocode lookup returned HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const body = await res.json();
  const hit = Array.isArray(body) ? body[0] : null;
  const lat = hit ? Number(hit.lat) : NaN;
  const lon = hit ? Number(hit.lon) : NaN;
  if (!isFiniteNum(lat) || !isFiniteNum(lon)) {
    const err = new Error(`no place found for "${q}"`);
    err.status = 404;
    throw err;
  }
  // Keep the admin's own wording as the label — the gateway matches the typed
  // city name against it, and Nominatim's display_name is a full postal address
  // ("Miami, Miami-Dade County, Florida, United States") that would never match.
  return { label: q, lat, lon };
}

async function addCity(query, opts) {
  const entry = await geocodeCity(query, opts);
  const current = getBlockedCities();
  if (current.some((c) => sameLabel(c.label, entry.label))) {
    return { list: current, added: null };
  }
  const next = await saveBlockedCities(current.concat(entry));
  return { list: next, added: entry };
}

async function removeCity(label) {
  const current = getBlockedCities();
  const next = current.filter((c) => !sameLabel(c.label, label));
  if (next.length === current.length) return { list: current, removed: false };
  return { list: await saveBlockedCities(next), removed: true };
}

module.exports = {
  STORE_KEY,
  BLOCK_RADIUS_DEG,
  SEED,
  getBlockedCities,
  saveBlockedCities,
  geocodeCity,
  addCity,
  removeCity,
};
