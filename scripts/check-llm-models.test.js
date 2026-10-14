'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findOffenders } = require('./check-llm-models');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-models-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

test('flags a stray model literal with file and line', () => {
  const root = tree({ 'demo_api_server/services/a.js': "const x = 1;\nconst m = 'claude-sonnet-4-5';\n" });
  assert.deepStrictEqual(findOffenders(root), [{ file: 'demo_api_server/services/a.js', line: 2, model: 'claude-sonnet-4-5' }]);
});

test('ignores tests, config, and non-model strings', () => {
  const root = tree({
    'demo_api_server/services/a.test.js': "'gpt-4o'",
    'demo_api_server/services/__tests__/b.js': "'gpt-4o'",
    'demo_api_server/config/llmModels.js': "'gpt-4o'",
    'demo_api_server/routes/c.js': "const s = 'claude'; const t = 'gpt';\n",
  });
  assert.deepStrictEqual(findOffenders(root).map((h) => h.model), []);
});
