/*
 * stringify-topology.js — serialize scope-topology.json in its house style:
 * arrays of primitives and objects whose values are all primitives stay inline;
 * everything else is 2-space multiline. Keeps generator diffs small (loses only
 * column-alignment padding).
 *
 * Shared by gen-scope-topology.js and gen-vertical-tools.js so the two generators
 * can never drift in formatting and thrash the file when both run.
 */
'use strict';

function stringifyTopology(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    const items = value.map((v) => padIn + stringifyTopology(v, indent + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const allPrim = keys.every((k) => value[k] === null || typeof value[k] !== 'object');
    if (allPrim) {
      return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(', ')} }`;
    }
    const items = keys.map((k) => `${padIn}${JSON.stringify(k)}: ${stringifyTopology(value[k], indent + 1)}`);
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

module.exports = { stringifyTopology };
