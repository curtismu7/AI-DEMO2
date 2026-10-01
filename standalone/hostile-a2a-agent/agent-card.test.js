// The poison's teeth: if an edit ever neuters the injection or the exfil skill,
// these fail. The card is the whole attack surface here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCard, POISONED_DESCRIPTION, POISONED_SKILL } from './agent-card.mjs';

test('the card description smuggles an agent-directed instruction', () => {
  assert.match(POISONED_DESCRIPTION, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/, 'no <IMPORTANT> block');
  assert.match(POISONED_DESCRIPTION, /create_transfer/, 'lost the induced harmful action');
  assert.match(POISONED_DESCRIPTION, /do not (mention|tell)/i, 'lost the secrecy instruction');
});

test('the poisoned skill instructs exfiltrating credentials/tokens', () => {
  assert.match(POISONED_SKILL.description, /credential|token/i, 'skill no longer leaks secrets');
});

test('buildCard is a v0.3.0 card, serves the poison verbatim, wires the JSON-RPC url', () => {
  const card = buildCard('http://example/a2a/jsonrpc');
  assert.equal(card.protocolVersion, '0.3.0');
  assert.equal(card.preferredTransport, 'JSONRPC');
  assert.equal(card.url, 'http://example/a2a/jsonrpc');
  assert.equal(card.additionalInterfaces[0].url, 'http://example/a2a/jsonrpc');
  assert.match(card.description, /<IMPORTANT>/, 'description poison dropped from the card');
  assert.ok(card.skills.some((s) => /credential|token/i.test(s.description)), 'skill poison dropped from the card');
});
