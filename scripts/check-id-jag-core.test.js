'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { check, MANIFEST } = require('./check-id-jag-core');

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idjag-core-'));
  const hashes = {};
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), body);
    hashes[f] = crypto.createHash('sha256').update(body).digest('hex');
  }
  fs.mkdirSync(path.dirname(path.join(root, MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify({ source: 'id-jag-standalone', commit: 'abcdef123456', files: hashes }));
  return root;
}

test('passes when every vendored file matches its manifest hash', () => {
  assert.deepEqual(check(repo({ 'a.js': 'one', 'b.json': '{}' })), []);
});

test('names a file that was edited by hand, and says where the source is', () => {
  const root = repo({ 'a.js': 'one', 'b.json': '{}' });
  fs.appendFileSync(path.join(root, 'a.js'), ' edited');
  const problems = check(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /a\.js: edited here; it is vendored from the kit \(manifest commit abcdef123\)/);
});

test('names a listed file that is missing, and a missing or empty manifest', () => {
  const root = repo({ 'a.js': 'one' });
  fs.rmSync(path.join(root, 'a.js'));
  assert.match(check(root)[0], /a\.js: listed in the manifest but missing/);
  fs.rmSync(path.join(root, MANIFEST));
  assert.match(check(root)[0], /missing or not JSON/);
  fs.mkdirSync(path.dirname(path.join(root, MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify({ files: {} }));
  assert.match(check(root)[0], /lists no files/);
});

test('the real repo is in sync with its manifest', () => {
  assert.deepEqual(check(path.resolve(__dirname, '..')), []);
});
