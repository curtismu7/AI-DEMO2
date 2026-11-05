/** return_to must bring the user back to the page they started on, query included, without opening a redirect. */
const { sanitizePostLoginReturnPath: sanitize } = require('../../routes/oauthUser');

describe('sanitizePostLoginReturnPath', () => {
  test.each([
    ['/', '/'],
    ['/group-policy', '/group-policy'],
    ['/group-policy?verticalId=healthcare', '/group-policy?verticalId=healthcare'],
    ['/mfa-test?signin=mfa&x=1', '/mfa-test?signin=mfa&x=1'],
  ])('keeps %s', (raw, expected) => expect(sanitize(raw)).toBe(expected));

  test.each([
    '//evil.com', 'https://evil.com', '/\\evil.com', '/a#frag', '/a?next=https://evil.com',
    '/a?u=%2F%2Fevil.com', '/a?x=<script>', `/${'a'.repeat(200)}`, null, 42,
  ])('rejects %p', (raw) => expect(sanitize(raw)).toBeNull());
});
