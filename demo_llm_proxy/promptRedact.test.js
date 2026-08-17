// demo_llm_proxy/promptRedact.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { redactText, MAX_REDACTED_CHARS } = require('./promptRedact');

describe('redactText', () => {
  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'; // gitleaks:allow — synthetic fixture, not a real credential
    const result = redactText(`here is my token: ${jwt} — use it`);
    assert.ok(result.includes('[REDACTED_JWT]'));
    assert.ok(!result.includes(jwt));
  });

  it('redacts a bearer token', () => {
    const result = redactText('Authorization: Bearer abc123.def456-ghi');
    assert.equal(result, 'Authorization: Bearer [REDACTED_TOKEN]');
  });

  it('redacts an SSN', () => {
    const result = redactText('my SSN is 123-45-6789, please confirm');
    assert.ok(result.includes('[REDACTED_SSN]'));
    assert.ok(!result.includes('123-45-6789'));
  });

  it('redacts a card number', () => {
    const result = redactText('card on file: 4111 1111 1111 1111 exp 12/29');
    assert.ok(result.includes('[REDACTED_CARD]'));
    assert.ok(!result.includes('4111 1111 1111 1111'));
  });

  it('redacts an email address', () => {
    const result = redactText('contact me at jane.doe@example.com about this');
    assert.equal(result, 'contact me at [REDACTED_EMAIL] about this');
  });

  it('leaves ordinary text untouched', () => {
    assert.equal(redactText('What is the transfer limit for Super Sports?'), 'What is the transfer limit for Super Sports?');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(redactText(null), '');
    assert.equal(redactText(undefined), '');
  });

  it('caps redacted content at MAX_REDACTED_CHARS with a truncation suffix', () => {
    const huge = 'a'.repeat(MAX_REDACTED_CHARS + 500);
    const result = redactText(huge);
    const suffix = '…[truncated]';
    assert.ok(result.endsWith(suffix));
    assert.equal(result.length, MAX_REDACTED_CHARS + suffix.length);
  });

  it('returns the redaction-error placeholder instead of raw content when coercion fails', () => {
    const poison = { toString() { throw new Error('boom'); } };
    assert.equal(redactText(poison), '[redaction-error, content omitted]');
  });
});
