/**
 * @file snapshots/authorizeSnapshotExtraAudience.test.js
 *
 * PINGONE_EXTRA_MCP_AUDIENCES adds exact audiences to HasValidMcpAudience for a second caller path
 * (an Agent Privilege app in front of the gateway: its tokens carry the audience Privilege generated for
 * the caller's identity). Unset it must change nothing: the committed snapshot stays byte-identical.
 *
 * Run: node --test snapshots/authorizeSnapshotExtraAudience.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { reconcile, loadSot, ATTR, COND, STMT, SNAP } = require('./gen-authorize-snapshot.js');

const AUD = 'priv-nhi-test-audience-0123456789';

function build(value) {
  const prev = process.env.PINGONE_EXTRA_MCP_AUDIENCES;
  if (value === undefined) delete process.env.PINGONE_EXTRA_MCP_AUDIENCES;
  else process.env.PINGONE_EXTRA_MCP_AUDIENCES = value;
  try {
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    reconcile(snap, loadSot());
    return snap;
  } finally {
    if (prev === undefined) delete process.env.PINGONE_EXTRA_MCP_AUDIENCES;
    else process.env.PINGONE_EXTRA_MCP_AUDIENCES = prev;
  }
}
const find = (snap, id) => snap.find((o) => o.id === id);
const audiences = (snap) => find(snap, COND.HasValidMcpAudience).condition.or.conditions
  .filter((c) => c.comparison && c.comparison.left.attribute.id === ATTR.TokenAudience)
  .map((c) => c.comparison.right.constant.value);

test('unset: the audience condition and its deny message are exactly what is committed', () => {
  const committed = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const snap = build(undefined);
  assert.deepStrictEqual(find(snap, COND.HasValidMcpAudience), find(committed, COND.HasValidMcpAudience));
  assert.deepStrictEqual(find(snap, STMT.invalidAudience), find(committed, STMT.invalidAudience));
  assert.ok(!audiences(snap).includes(AUD));
});

test('set: the extra audience is accepted by exact match, listed in the deny message, and the object version changes', () => {
  const base = build(undefined);
  const snap = build(AUD);
  assert.ok(audiences(snap).includes(AUD), 'extra audience is an accepted TokenAudience');
  assert.deepStrictEqual(audiences(snap).filter((a) => a !== AUD), audiences(base), 'the existing audiences are untouched');
  assert.match(find(snap, STMT.invalidAudience).payload, new RegExp(AUD));
  assert.notStrictEqual(find(snap, COND.HasValidMcpAudience).version, find(base, COND.HasValidMcpAudience).version,
    'a changed condition needs a new version or PingOne skips it on import');
});

test('blank and padded entries are ignored; several audiences are all accepted', () => {
  const snap = build(` ${AUD} , ,second-audience,`);
  assert.deepStrictEqual(audiences(snap).filter((a) => a === AUD || a === 'second-audience'), [AUD, 'second-audience']);
  assert.ok(!audiences(snap).includes(''));
});
