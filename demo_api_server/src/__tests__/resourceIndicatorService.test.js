/**
 * @file resourceIndicatorService.test.js
 *
 * Regression test for validateResourceFormat's allow-list regex.
 * BUGS.md #33: the regex matched pingdemo.com / pingone.com domains that
 * RESOURCE_DEFINITIONS never uses (it uses ping.demo), so every legitimate
 * resource was silently rejected and RFC 8707 resource indicators were
 * dropped from every token exchange, regardless of feature-flag state.
 */

const {
  validateResourceFormat,
  RESOURCE_DEFINITIONS,
} = require('../../services/resourceIndicatorService');

describe('validateResourceFormat', () => {
  it.each(Object.keys(RESOURCE_DEFINITIONS))(
    'accepts the real RESOURCE_DEFINITIONS entry %s',
    (resourceUri) => {
      expect(validateResourceFormat(resourceUri)).toBe(true);
    }
  );

  it('rejects an unrelated/invalid resource URI', () => {
    expect(validateResourceFormat('https://evil.com/')).toBe(false);
  });

  it('rejects the old (never-used) pingdemo.com / pingone.com domains', () => {
    expect(validateResourceFormat('https://foo.pingdemo.com/')).toBe(false);
    expect(validateResourceFormat('https://pingone.com/foo/')).toBe(false);
  });

  it('rejects http (non-https) scheme', () => {
    expect(validateResourceFormat('http://enduser.ping.demo/')).toBe(false);
  });

  it('rejects a resource missing the trailing slash', () => {
    expect(validateResourceFormat('enduser.ping.demo')).toBe(false);
  });

  it('rejects non-string / empty input', () => {
    expect(validateResourceFormat('')).toBe(false);
    expect(validateResourceFormat(null)).toBe(false);
    expect(validateResourceFormat(undefined)).toBe(false);
  });
});
