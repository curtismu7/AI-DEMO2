import { describe, it, expect, vi } from 'vitest';
import { parseWwwAuthenticate, extractRfc9470Challenge } from '../wwwAuthenticate';

const HEADER =
  'Bearer error="insufficient_user_authentication", error_description="A different authentication level is required", acr_values="Multi_Factor", max_age="300"';

describe('parseWwwAuthenticate', () => {
  it('parses an RFC 9470 challenge', () => {
    expect(parseWwwAuthenticate(HEADER)).toEqual({
      scheme: 'Bearer',
      error: 'insufficient_user_authentication',
      error_description: 'A different authentication level is required',
      acr_values: ['Multi_Factor'],
      max_age: 300,
    });
  });

  it('splits multiple acr_values on spaces', () => {
    const parsed = parseWwwAuthenticate(
      'Bearer error="insufficient_user_authentication", acr_values="urn:a urn:b"'
    );
    expect(parsed.acr_values).toEqual(['urn:a', 'urn:b']);
  });

  it('returns null for non-Bearer or empty values', () => {
    expect(parseWwwAuthenticate('Basic realm="x"')).toBeNull();
    expect(parseWwwAuthenticate('')).toBeNull();
    expect(parseWwwAuthenticate(undefined)).toBeNull();
  });

  it('unescapes quoted characters', () => {
    expect(
      parseWwwAuthenticate(
        'Bearer error="insufficient_user_authentication", error_description="say \\"hi\\""'
      ).error_description
    ).toBe('say "hi"');
  });
});

describe('extractRfc9470Challenge', () => {
  const body = {
    error: 'step_up_required',
    step_up_method: 'email',
    step_up_url: '/api/auth/oauth/user/stepup',
    step_up_acr: 'Multi_Factor',
  };

  it('normalizes a 401 challenge into the legacy 428 shape', () => {
    const out = extractRfc9470Challenge({
      status: 401,
      headers: { 'www-authenticate': HEADER },
      data: body,
    });
    expect(out.error).toBe('step_up_required');
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.step_up_method).toBe('email');
    expect(out.step_up_url).toBe('/api/auth/oauth/user/stepup');
    expect(out.rfc9470.raw).toBe(HEADER);
    expect(out.rfc9470.max_age).toBe(300);
  });

  it('prefers the header acr over the body field (header is normative)', () => {
    const out = extractRfc9470Challenge({
      status: 401,
      headers: {
        'www-authenticate':
          'Bearer error="insufficient_user_authentication", acr_values="urn:header:acr"',
      },
      data: { ...body, step_up_acr: 'BodyAcr' },
    });
    expect(out.step_up_acr).toBe('urn:header:acr');
  });

  it('falls back to body fields when the header is missing/unparseable (with a warning)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = extractRfc9470Challenge({ status: 401, headers: {}, data: body });
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.rfc9470).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null for ordinary 401s and non-401s', () => {
    expect(
      extractRfc9470Challenge({ status: 401, headers: {}, data: { error: 'session_expired' } })
    ).toBeNull();
    expect(extractRfc9470Challenge({ status: 428, headers: {}, data: body })).toBeNull();
    expect(extractRfc9470Challenge(undefined)).toBeNull();
    expect(extractRfc9470Challenge(null)).toBeNull();
  });

  it('falls back to body fields when the header is present but unparseable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = extractRfc9470Challenge({
      status: 401,
      headers: { 'www-authenticate': 'Bearer error=oops-unquoted' },
      data: body,
    });
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.rfc9470).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
