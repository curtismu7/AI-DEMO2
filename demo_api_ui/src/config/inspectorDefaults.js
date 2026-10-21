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
