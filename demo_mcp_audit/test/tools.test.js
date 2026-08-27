'use strict';

// Runs with plain `node test/tools.test.js` — no framework, matching the other
// small direct MCP servers. Covers only the logic that can silently go wrong:
// the retention clamp, the response shaping, and the tool surface itself.

const assert = require('node:assert');
const { TOOLS, callTool, sinceIso, slim, MAX_DAYS } = require('../server');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}

test('exposes exactly the three audit tools', () => {
  assert.deepStrictEqual(
    TOOLS.map((t) => t.name).sort(),
    ['audit_summary', 'get_audit_activity', 'search_audit_activities'],
  );
});

test('every tool declares an input schema the gateway can forward', () => {
  for (const t of TOOLS) {
    assert.ok(t.description, `${t.name} has no description`);
    assert.strictEqual(t.inputSchema.type, 'object', `${t.name} schema is not an object`);
  }
});

test('clamps the window to PingOne retention instead of returning empty', () => {
  // 30 days looks like it works and quietly returns nothing — the whole reason
  // this clamp exists. Asking for 30 must behave as MAX_DAYS, not as 30.
  assert.strictEqual(sinceIso(30).days, MAX_DAYS);
  assert.strictEqual(sinceIso(0).days, MAX_DAYS, 'zero should fall back to the default, not 0 days');
  assert.strictEqual(sinceIso(3).days, 3, 'a valid window must be honoured');
});

test('sinceIso produces a filter-safe UTC stamp', () => {
  // PingOne's SCIM filter rejects millisecond precision on recordedat.
  assert.match(sinceIso(1).iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('slim keeps the fields an agent needs and drops the rest', () => {
  const out = slim({
    id: 'a1',
    recordedAt: '2026-08-27T00:00:00Z',
    action: { type: 'APPLICATION.UPDATED', description: 'updated' },
    actors: { client: { name: 'someClient' }, user: { name: 'someUser' } },
    resources: [{ type: 'APPLICATION', name: 'MyApp' }],
    _links: { self: { href: 'https://example.test' } },
  });
  assert.strictEqual(out.type, 'APPLICATION.UPDATED');
  assert.strictEqual(out.client, 'someClient');
  assert.strictEqual(out.user, 'someUser');
  assert.deepStrictEqual(out.resources, [{ type: 'APPLICATION', name: 'MyApp' }]);
  assert.strictEqual(out._links, undefined, 'HAL links must not reach the agent');
});

test('slim tolerates an event with no actors', () => {
  // Real payloads include system events with neither client nor user.
  const out = slim({ id: 'a2', action: { type: 'TICKER.TICK' } });
  assert.strictEqual(out.client, null);
  assert.strictEqual(out.user, null);
  assert.deepStrictEqual(out.resources, []);
});

test('an unknown tool is refused, not silently ignored', async () => {
  await assert.rejects(() => callTool('drop_all_users', {}), /unknown tool/);
});

(async () => {
  // The async assertion above returns a promise; give it a tick to settle.
  await new Promise((r) => setTimeout(r, 50));
  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall tests passed');
  process.exit(0);
})();
