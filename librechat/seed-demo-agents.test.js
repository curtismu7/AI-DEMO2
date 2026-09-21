const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('LibreChat UI agent filter includes Privilege Aggregate', () => {
  const source = fs.readFileSync(path.join(__dirname, 'seed-demo-agents.js'), 'utf8');
  assert.match(source, /UI_AGENT_NAME\s*=\s*\/\^\(OpenSearch\|Privilege Aggregate\|/);
});
