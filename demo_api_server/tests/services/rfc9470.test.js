/**
 * @file rfc9470.test.js
 * @description Unit tests for the RFC 9470 WWW-Authenticate challenge builder/parser.
 */

const {
  buildChallengeHeader,
  parseChallengeHeader,
  INSUFFICIENT_USER_AUTHENTICATION,
} = require('../../services/rfc9470');

describe('rfc9470 challenge header', () => {
  it('exports the RFC 9470 error code', () => {
    expect(INSUFFICIENT_USER_AUTHENTICATION).toBe('insufficient_user_authentication');
  });

  it('builds the spec-exact header', () => {
    expect(
      buildChallengeHeader({
        acrValues: ['Multi_Factor'],
        maxAge: 300,
        errorDescription: 'A different authentication level is required',
      })
    ).toBe(
      'Bearer error="insufficient_user_authentication", error_description="A different authentication level is required", acr_values="Multi_Factor", max_age="300"'
    );
  });

  it('space-separates multiple acr values', () => {
    expect(buildChallengeHeader({ acrValues: ['urn:a', 'urn:b'] })).toBe(
      'Bearer error="insufficient_user_authentication", acr_values="urn:a urn:b"'
    );
  });

  it('omits acr_values when empty and max_age when not provided', () => {
    expect(buildChallengeHeader({})).toBe('Bearer error="insufficient_user_authentication"');
  });

  it('includes max_age=0 explicitly (0 is a meaningful value: force fresh auth)', () => {
    expect(buildChallengeHeader({ maxAge: 0 })).toBe(
      'Bearer error="insufficient_user_authentication", max_age="0"'
    );
  });

  it('escapes quotes in error_description', () => {
    expect(buildChallengeHeader({ errorDescription: 'say "hi"' })).toContain(
      'error_description="say \\"hi\\""'
    );
  });

  it('round-trips through parseChallengeHeader', () => {
    const header = buildChallengeHeader({
      acrValues: ['Multi_Factor', 'urn:x'],
      maxAge: 0,
      errorDescription: 'Step up',
    });
    expect(parseChallengeHeader(header)).toEqual({
      scheme: 'Bearer',
      error: 'insufficient_user_authentication',
      error_description: 'Step up',
      acr_values: ['Multi_Factor', 'urn:x'],
      max_age: 0,
    });
  });

  it('returns null for non-Bearer and error-less values', () => {
    expect(parseChallengeHeader('Basic realm="x"')).toBeNull();
    expect(parseChallengeHeader('Bearer realm="x"')).toBeNull();
    expect(parseChallengeHeader(undefined)).toBeNull();
    expect(parseChallengeHeader('')).toBeNull();
  });

  it('strips control characters from admin-settable values (no header-injection 500s)', () => {
    expect(buildChallengeHeader({ acrValues: ['Multi\r\nFactor'] })).toBe(
      'Bearer error="insufficient_user_authentication", acr_values="Multi  Factor"'
    );
  });
});
