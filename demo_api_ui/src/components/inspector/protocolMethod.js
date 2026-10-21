/**
 * Raw JSON-RPC calls (the "Raw JSON-RPC" source) run MCP protocol methods, not tools.
 * Their results get the same readable card, worded for a server, and the three
 * list methods render as a short list instead of a flat Key Values dump.
 */

/** resources/list, prompts/list, server/discover, ... — and the two bare handshake methods. */
export const isProtocolMethod = (name) =>
  typeof name === 'string' && (/^[a-z]+\/[A-Za-z/]+$/.test(name) || name === 'initialize' || name === 'ping');

const LISTS = [
  { key: 'tools', noun: 'tool' },
  { key: 'resources', noun: 'resource' },
  { key: 'resourceTemplates', noun: 'resource template' },
  { key: 'prompts', noun: 'prompt' },
];

const str = (v) => (typeof v === 'string' && v.trim() ? v : '');

/**
 * `{ noun, items:[{ title, subtitle, description }] }` for a *list result such as
 * { resources: [...] }, or null when the value is not one (so the caller falls back).
 */
export function listOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const spec = LISTS.find((l) => Array.isArray(value[l.key]));
  if (!spec) return null;
  const items = value[spec.key]
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const id = str(x.uri) || str(x.uriTemplate);
      const title = str(x.name) || id || '(unnamed)';
      return { title, subtitle: id && id !== title ? id : '', description: str(x.description) };
    });
  return { noun: spec.noun, items };
}
