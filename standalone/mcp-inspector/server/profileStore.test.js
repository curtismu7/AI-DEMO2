'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the store in a throwaway directory before requiring the module —
// it resolves PROFILE_STORE_DIR at load time.
process.env.PROFILE_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-inspector-test-'));
const profileStore = require('./lib/profileStore');

test('createProfile requires a url for http transport', () => {
  assert.throws(() => profileStore.createProfile({ transport: 'http', label: 'x' }));
});

test('createProfile requires a command for stdio transport', () => {
  assert.throws(() => profileStore.createProfile({ transport: 'stdio', label: 'x' }));
});

test('create, list, get, delete round-trip; secrets never leak to listProfiles', () => {
  const created = profileStore.createProfile({
    transport: 'http',
    label: 'Test server',
    url: 'https://example.com/mcp',
    authHeader: 'Authorization',
    authValue: 'Bearer secret-token',
  });
  assert.equal(created.label, 'Test server');
  assert.equal(created.hasAuthValue, true);
  assert.equal(created.authValue, undefined);

  const listed = profileStore.listProfiles().find((p) => p.id === created.id);
  assert.ok(listed);
  assert.equal(listed.authValue, undefined);

  const full = profileStore.getProfile(created.id);
  assert.equal(full.authValue, 'Bearer secret-token');

  profileStore.deleteProfile(created.id);
  assert.equal(profileStore.getProfile(created.id), null);
});

test('deleteProfile throws profile_not_found for an unknown id', () => {
  assert.throws(() => profileStore.deleteProfile('does-not-exist'), { code: 'profile_not_found' });
});
