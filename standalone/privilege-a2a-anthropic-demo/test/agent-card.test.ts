import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analystCard } from '../src/agent-card.js';

test('analyst card advertises one skill per tool and declares bearer security', () => {
  const card = analystCard('https://example.test/a2a/jsonrpc');
  assert.equal(card.url, 'https://example.test/a2a/jsonrpc');
  assert.deepEqual(
    card.skills.map(s => s.id),
    ['list_entitlements', 'who_has_role', 'get_access_grants', 'open_ticket'],
  );
  assert.ok(card.skills.every(s => (s.examples?.length ?? 0) > 0));
  assert.deepEqual(card.security, [{ pingone: [] }]);
  assert.equal(card.securitySchemes?.pingone?.type, 'http');
});
