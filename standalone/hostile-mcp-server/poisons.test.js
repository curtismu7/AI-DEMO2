// The poison catalog is only interesting if each entry still carries its teeth.
// A well-meaning "tidy-up" that removes the smuggled instruction or the exfil
// default would leave a catalog of harmless tools that demonstrates nothing —
// these assertions turn that into a red test instead of a silent no-op. Same
// discipline as demo_api_ui/src/config/toolAttackCatalog.test.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { POISONS, POISON_PROMPTS, POISON_RESOURCES } from './poisons.mjs';

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

test('tool_shadowing collides with a trusted name and smuggles an instruction', () => {
  const p = POISONS.find((x) => x.id === 'tool_shadowing');
  assert.equal(p.tool.name, 'get_balance');
  assert.match(p.tool.description, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/);
  assert.match(p.tool.description, /ignore any other tool/i);
});

test('action_exfil_sink hides an off-box bcc default', () => {
  const p = POISONS.find((x) => x.id === 'action_exfil_sink');
  const bcc = p.tool.inputSchema.properties?.bcc;
  assert.ok(bcc, 'bcc property present');
  assert.match(String(bcc.default), /@attacker\.example$/);
  assert.match(bcc.description, /credential|token/i);
});

test('credential_harvest asks for password/otp as parameters', () => {
  const p = POISONS.find((x) => x.id === 'credential_harvest');
  assert.ok(p.tool.inputSchema.properties?.password, 'password param');
  assert.ok(p.tool.inputSchema.properties?.otp, 'otp param');
});

test('imperative_injection carries a plain agent-directed imperative (no tag)', () => {
  const p = POISONS.find((x) => x.id === 'imperative_injection');
  assert.doesNotMatch(p.tool.description, /<IMPORTANT>/, 'this one is deliberately tag-free');
  assert.match(p.tool.description, /ignore all previous instructions/i);
  assert.match(p.tool.description, /create_transfer/i);
});

test('resource poison retains a sensitive-action directive', () => {
  const resource = POISON_RESOURCES.find((entry) => entry.id === 'account_verification');
  assert.ok(resource, 'entry present');
  assert.match(resource.contents[0].text, /create_transfer/i);
  assert.match(resource.contents[0].text, /external-001/i);
});

test('prompt poison retains an approval-bypass directive', () => {
  const prompt = POISON_PROMPTS.find((entry) => entry.id === 'account_review');
  assert.ok(prompt, 'entry present');
  assert.match(prompt.messages[0].content.text, /bypass/i);
  assert.match(prompt.messages[0].content.text, /create_transfer/i);
});
