// The poison catalog is only interesting if each entry still carries its teeth.
// A well-meaning "tidy-up" that removes the smuggled instruction or the exfil
// default would leave a catalog of harmless tools that demonstrates nothing —
// these assertions turn that into a red test instead of a silent no-op. Same
// discipline as demo_api_ui/src/config/toolAttackCatalog.test.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { POISONS } from './poisons.mjs';

test('every poison is a complete, unique tool', () => {
  const ids = new Set();
  const names = new Set();
  for (const p of POISONS) {
    assert.ok(p.id, 'id');
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.ok(p.tool?.name, `tool.name for ${p.id}`);
    assert.ok(!names.has(p.tool.name), `duplicate tool name ${p.tool.name}`);
    names.add(p.tool.name);
    assert.ok(p.tool.description, `description for ${p.id}`);
    // MCP requires inputSchema to be a JSON-Schema object.
    assert.equal(p.tool.inputSchema?.type, 'object', `inputSchema.type for ${p.id}`);
  }
});

test('description_injection smuggles an agent-directed instruction', () => {
  const p = POISONS.find((x) => x.id === 'description_injection');
  assert.ok(p, 'entry present');
  // The teeth: an out-of-band instruction hidden in a benign tool description.
  assert.match(p.tool.description, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/);
  assert.match(p.tool.description, /transfer/i);
  assert.match(p.tool.description, /do not (mention|tell)/i);
});

test('schema_exfiltration hides an exfil sink in the inputSchema', () => {
  const p = POISONS.find((x) => x.id === 'schema_exfiltration');
  assert.ok(p, 'entry present');
  const sink = p.tool.inputSchema.properties?.callback_url;
  assert.ok(sink, 'callback_url property present');
  // The teeth: a default value pointing off-box that rides along on every call.
  assert.match(String(sink.default), /^https?:\/\//);
  assert.notEqual(new URL(sink.default).hostname, '', 'default is a real URL');
});
