/**
 * clientAuthMethod — human label for BFF→PingOne client auth methods.
 */
import { describe, it, expect } from 'vitest';
import { clientAuthMethodLabel } from '../clientAuthMethod';

describe('clientAuthMethodLabel', () => {
  it('maps private_key_jwt to "private_key_jwt · JWKS"', () => {
    expect(clientAuthMethodLabel('private_key_jwt')).toBe('private_key_jwt · JWKS');
  });

  it('maps basic to "client_secret_basic"', () => {
    expect(clientAuthMethodLabel('basic')).toBe('client_secret_basic');
  });

  it('maps post to "client_secret_post"', () => {
    expect(clientAuthMethodLabel('post')).toBe('client_secret_post');
  });

  it('returns the raw value for an unknown method', () => {
    expect(clientAuthMethodLabel('tls_client_auth')).toBe('tls_client_auth');
  });

  it('returns empty string for null', () => {
    expect(clientAuthMethodLabel(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(clientAuthMethodLabel(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(clientAuthMethodLabel('')).toBe('');
  });
});
