// demo_api_ui/src/config/inspectorDefaults.js
//
// Defaults that make a bare "Send" work in the MCP Inspector: which tool is
// pre-selected for each source, and what a tool's parameters are pre-filled with.
// Everything here is a safe read; nothing that changes data is ever pre-selected.

/**
 * Pre-filled parameter values, keyed by parameter name. Only a parameter the picked
 * tool actually declares is filled, and a vertical's own sample args win over these.
 * Texas: the weather tool takes a city (not a state), and "Austin, TX" is both the
 * capital and the example in its own schema.
 */
export const PARAM_DEFAULTS = { city_name: 'Austin, TX' };

/** The defaults that apply to a tool's declared input properties. */
export function defaultParamsFor(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [name, value] of Object.entries(PARAM_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(props, name)) out[name] = value;
  }
  return out;
}

/** Per source: tool names to try in order (a RegExp matches by pattern), first one the server offers wins. */
export const DEFAULT_TOOLS = {
  banking: ['get_my_accounts'],
  custom: ['get_my_accounts'],
  gateway: ['get_weather_summary', 'get_current_conditions', 'get_weather', /weather|forecast|conditions/i],
  pingone: ['listApplications', 'listApplicationCatalog'],
  protocol: ['server/discover', 'resources/list'],
};

/** The tool to pre-select for a source, or null when none of the preferred ones is offered. */
export function pickDefaultTool(sourceKey, tools, toolKey = 'name') {
  const prefs = DEFAULT_TOOLS[sourceKey];
  if (!prefs || !Array.isArray(tools)) return null;
  for (const pref of prefs) {
    const hit = tools.find((t) => (pref instanceof RegExp ? pref.test(String(t?.[toolKey] ?? '')) : t?.[toolKey] === pref));
    if (hit) return hit;
  }
  return null;
}

/**
 * Parameters that are alternatives to each other: the tool takes ONE of them, so the form offers a choice
 * instead of N independent fields. The weather tool takes a city, coordinates, or a saved location, and the
 * gateway's demo policy treats them differently (see demo_mcp_gateway/src/scopePolicies.ts), which is worth
 * showing. A group applies only to a tool that declares every field it names.
 */
export const PARAM_CHOICES = [
  {
    id: 'location',
    label: 'Location by',
    requires: ['city_name', 'latitude', 'longitude', 'location_name'],
    options: [
      { id: 'city', label: 'City', fields: ['city_name'], defaults: { city_name: PARAM_DEFAULTS.city_name }, hint: 'A city outside the demo\'s allowed state is denied by policy.' },
      { id: 'coords', label: 'Coordinates', fields: ['latitude', 'longitude'], defaults: { latitude: '30.2672', longitude: '-97.7431' }, hint: 'Coordinates outside the demo\'s allowed state are denied by policy. These are Austin.' },
      { id: 'saved', label: 'Saved location', fields: ['location_name'], defaults: {}, hint: 'A saved location is always denied by the demo policy: it cannot verify where it is.' },
    ],
  },
];

/** The choice group a tool's declared properties call for, or null. */
export function choiceGroupFor(props) {
  if (!props || typeof props !== 'object') return null;
  return PARAM_CHOICES.find((g) => g.requires.every((f) => Object.prototype.hasOwnProperty.call(props, f))) ?? null;
}

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * Which option the current values point at: the one option with a value in any of its fields; the first
 * when nothing is filled; null when more than one is (ambiguous, so the caller shows every field instead
 * of hiding a value that would still be sent).
 */
export function inferOption(group, values) {
  const hits = group.options.filter((o) => o.fields.some((f) => filled(values?.[f])));
  if (hits.length === 1) return hits[0].id;
  return hits.length === 0 ? group.options[0].id : null;
}

/** Values after switching to an option: every field of the group cleared, then that option's defaults. */
export function applyOption(group, optionId, values) {
  const next = { ...(values || {}) };
  for (const o of group.options) for (const f of o.fields) delete next[f];
  const option = group.options.find((o) => o.id === optionId);
  return { ...next, ...(option?.defaults || {}) };
}

