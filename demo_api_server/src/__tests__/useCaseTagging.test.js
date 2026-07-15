'use strict';

const {deriveUseCaseId, isValidUseCaseId, resolveChipUseCaseId} = require('../../config/useCases');

describe('deriveUseCaseId (organic reverse-map)', () => {
  test('transfer amounts map to the authorize bands', () => {
    expect(deriveUseCaseId('create_transfer', { amount: 600 })).toBe('step-up-required');   // UC7
    expect(deriveUseCaseId('create_transfer', { amount: 300 })).toBe('hitl-consent');         // UC8
    expect(deriveUseCaseId('create_transfer', { amount: 2500 })).toBe('authz-denied');        // UC6
    // Phase 170: all transfers are consent-gated — $100 is HITL, not UC1
    expect(deriveUseCaseId('create_transfer', { amount: 100 })).toBe('hitl-consent');         // UC8
  });

  test('a read tool maps to the delegated-access foundation', () => {
    expect(deriveUseCaseId('get_balance', {})).toBe('delegated-access-with-proof');           // UC1
  });

  test('an unmapped tool returns undefined', () => {
    expect(deriveUseCaseId('list_branches', {})).toBeUndefined();
  });

  test('string amounts are coerced', () => {
    expect(deriveUseCaseId('create_transfer', { amount: '600' })).toBe('step-up-required');
  });
});

describe('isValidUseCaseId (catalog guard)', () => {
  test('returns true for a known slug', () => {
    expect(isValidUseCaseId('step-up-required')).toBe(true);
  });

  test('returns false for an arbitrary/injected string', () => {
    expect(isValidUseCaseId('injected-junk')).toBe(false);
  });

  test('returns false for falsy values', () => {
    expect(isValidUseCaseId(undefined)).toBe(false);
    expect(isValidUseCaseId(null)).toBe(false);
    expect(isValidUseCaseId('')).toBe(false);
  });

  test('returns false for a non-string', () => {
    expect(isValidUseCaseId(42)).toBe(false);
  });

  test('rejects the numeric id form (UC7) — only slugs are valid', () => {
    expect(isValidUseCaseId('UC7')).toBe(false);
  });
});

describe('resolveChipUseCaseId (client-supplied wins, else organic derivation)', () => {
  test('a valid client-supplied id wins outright', () => {
    expect(resolveChipUseCaseId('step-up-required', 'get_balance', {}, 'banking')).toBe('step-up-required');
  });

  test('an invalid client-supplied id is ignored in favor of derivation', () => {
    expect(resolveChipUseCaseId('not-a-real-slug', 'get_balance', {}, 'banking')).toBe('delegated-access-with-proof');
  });

  test('no client-supplied id falls back to organic derivation', () => {
    expect(resolveChipUseCaseId('', 'create_transfer', { amount: 600 }, 'banking')).toBe('step-up-required');
  });

  test('empty/undefined client id and an unmapped tool returns undefined', () => {
    expect(resolveChipUseCaseId(undefined, 'list_branches', {}, 'banking')).toBeUndefined();
  });
});

const { stampUseCaseId, stampVertical } = require('../../services/useCaseTagging');

describe('stampUseCaseId', () => {
  test('stamps events that lack a useCaseId', () => {
    const events = [{ id: 'a' }, { id: 'b' }];
    stampUseCaseId(events, 'step-up-required');
    expect(events.every((e) => e.useCaseId === 'step-up-required')).toBe(true);
  });

  test('does not overwrite an existing useCaseId', () => {
    const events = [{ id: 'a', useCaseId: 'launcher-set' }];
    stampUseCaseId(events, 'derived');
    expect(events[0].useCaseId).toBe('launcher-set');
  });

  test('no-op when useCaseId is falsy or events is not an array', () => {
    const events = [{ id: 'a' }];
    stampUseCaseId(events, undefined);
    expect(events[0].useCaseId).toBeUndefined();
    expect(() => stampUseCaseId(null, 'x')).not.toThrow();
  });
});

describe('stampVertical', () => {
  test('stamps events that lack a vertical', () => {
    const events = [{ id: 'a' }, { id: 'b' }];
    stampVertical(events, 'banking');
    expect(events.every((e) => e.vertical === 'banking')).toBe(true);
  });

  test('does not overwrite an existing vertical', () => {
    const events = [{ id: 'a', vertical: 'launcher-set' }];
    stampVertical(events, 'healthcare');
    expect(events[0].vertical).toBe('launcher-set');
  });

  test('no-op when vertical is falsy or events is not an array', () => {
    const events = [{ id: 'a' }];
    stampVertical(events, undefined);
    expect(events[0].vertical).toBeUndefined();
    expect(() => stampVertical(null, 'x')).not.toThrow();
  });
});
