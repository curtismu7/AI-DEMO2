import { describe, it, expect } from 'vitest';
import { pickFunAvatar } from './funAvatar';

describe('pickFunAvatar', () => {
  it('returns the same face for the same seed', () => {
    expect(pickFunAvatar('curtis@coachcurtis.org')).toEqual(pickFunAvatar('curtis@coachcurtis.org'));
  });

  it('returns different faces for different seeds', () => {
    expect(pickFunAvatar('alice@example.com')).not.toEqual(pickFunAvatar('bob@example.com'));
  });

  it('falls back to a stable face when seed is missing', () => {
    expect(pickFunAvatar(undefined)).toEqual(pickFunAvatar(null));
  });
});
