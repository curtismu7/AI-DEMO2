import { describe, expect, it } from 'vitest';
import { ATTACK_CATEGORIES, GUARDRAIL_ATTACKS } from './guardrailAttackCatalog';

describe('guardrailAttackCatalog', () => {
  it('has the seven chat-content threats', () => {
    expect(GUARDRAIL_ATTACKS).toHaveLength(7);
  });

  it('every entry is complete and non-empty', () => {
    for (const a of GUARDRAIL_ATTACKS) {
      expect(a.id, 'id').toBeTruthy();
      expect(a.label, `label for ${a.id}`).toBeTruthy();
      expect(a.payload, `payload for ${a.id}`).toBeTruthy();
      expect(a.payload.trim().length, `payload for ${a.id} non-blank`).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = GUARDRAIL_ATTACKS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry sits in a declared category', () => {
    for (const a of GUARDRAIL_ATTACKS) {
      expect(ATTACK_CATEGORIES, `category for ${a.id}`).toContain(a.category);
    }
  });
});
