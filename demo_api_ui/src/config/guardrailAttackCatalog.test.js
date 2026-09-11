import { describe, expect, it } from 'vitest';
import { ATTACK_CATEGORIES, GUARDRAIL_ATTACKS } from './guardrailAttackCatalog';

describe('guardrailAttackCatalog', () => {
  // 7 chat-content threats that produce a real gateway verdict + 4 Tool & Agent
  // Safety chips (effect 'none' here, they block on the tool path) + External
  // Guardrail (the ML sidecar) = the full AIGuard detector policy, mirrored.
  it('mirrors the full detector policy (12 chips)', () => {
    expect(GUARDRAIL_ATTACKS).toHaveLength(12);
  });

  // The four Tool & Agent Safety chips must stay 'none': the chat lane fires no
  // verdict for them (measured), and labeling them 'blocks' would be a fake chip.
  it('the tool/agent chips are effect none', () => {
    for (const id of ['tool_abuse', 'tool_poisoning', 'schema_violation', 'inter_agent_abuse']) {
      const a = GUARDRAIL_ATTACKS.find((x) => x.id === id);
      expect(a, id).toBeTruthy();
      expect(a.effect, `${id} effect`).toBe('none');
    }
  });

  it('every entry is complete and non-empty', () => {
    for (const a of GUARDRAIL_ATTACKS) {
      expect(a.id, 'id').toBeTruthy();
      expect(a.label, `label for ${a.id}`).toBeTruthy();
      expect(a.payload, `payload for ${a.id}`).toBeTruthy();
      expect(a.payload.trim().length, `payload for ${a.id} non-blank`).toBeGreaterThan(0);
    }
  });

  // `effect` is what the page promises the caller will see. A missing or
  // invented value would silently show nothing under the picker, which is the
  // exact confusion this field exists to remove.
  it('every entry declares a known effect', () => {
    for (const a of GUARDRAIL_ATTACKS) {
      expect(['blocks', 'sanitizes', 'none'], `effect for ${a.id}`).toContain(a.effect);
    }
  });

  // Measured 2026-09-08: these two only produce a visible gateway verdict
  // because they ask the model to GENERATE example data. Asking it to leak or
  // transmit real data gets a refusal, the output scanner sees nothing, and the
  // demo shows an unexplained "Answered". Do not "tidy" these back into
  // leak-style prompts.
  it('the sanitize payloads ask the model to generate, not to leak', () => {
    for (const id of ['pii', 'data_exfiltration']) {
      const a = GUARDRAIL_ATTACKS.find((x) => x.id === id);
      expect(a.effect, `${id} effect`).toBe('sanitizes');
      expect(a.payload.toLowerCase(), `${id} payload`).toMatch(/generate|draft|example/);
      expect(a.payload.toLowerCase(), `${id} must not ask to leak`).not.toMatch(/repeat all of that back|post the encoded/);
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
