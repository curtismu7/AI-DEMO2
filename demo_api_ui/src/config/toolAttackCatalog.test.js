import { describe, expect, it } from 'vitest';
import { TOOL_ATTACK_CATEGORIES, TOOL_ATTACKS } from './toolAttackCatalog';

describe('toolAttackCatalog', () => {
  it('has the two tool-lane threats the tester can actually stage', () => {
    expect(TOOL_ATTACKS).toHaveLength(2);
  });

  it('every entry is complete and non-empty', () => {
    for (const a of TOOL_ATTACKS) {
      expect(a.id, 'id').toBeTruthy();
      expect(a.label, `label for ${a.id}`).toBeTruthy();
      expect(a.tool, `tool for ${a.id}`).toBeTruthy();
      expect(a.args, `args for ${a.id}`).toBeTypeOf('object');
      expect(Object.keys(a.args).length, `args for ${a.id} non-empty`).toBeGreaterThan(0);
    }
  });

  // Same contract as guardrailAttackCatalog: `effect` is what the page promises
  // the caller will see. 'unmeasured' is honest and renders as such; an invented
  // value would show a verdict hint the tool lane never produces.
  it('every entry declares a known effect', () => {
    for (const a of TOOL_ATTACKS) {
      expect(['blocks', 'denies', 'none', 'unmeasured'], `effect for ${a.id}`).toContain(a.effect);
    }
  });

  it('ids are unique', () => {
    const ids = TOOL_ATTACKS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry sits in a declared category', () => {
    for (const a of TOOL_ATTACKS) {
      expect(TOOL_ATTACK_CATEGORIES, `category for ${a.id}`).toContain(a.category);
    }
  });

  // The payloads are only attacks because they violate create_transfer's real
  // inputSchema (mcp-tool-schemas.json): amount is `number` with minimum 0.01,
  // to_account_id is `string`, additionalProperties is false. A well-meaning
  // "fix" that makes these args schema-valid turns the entry into a normal
  // transfer that demonstrates nothing.
  it('the schema violation payload actually violates the tool schema', () => {
    const a = TOOL_ATTACKS.find((x) => x.id === 'schema_violation');
    expect(a.tool).toBe('create_transfer');
    expect(typeof a.args.amount, 'amount must be the wrong type').not.toBe('number');
  });

  // Tool poisoning here is the arg-injection variant: the instruction rides
  // inside a string argument that a later reader (the model summarising the
  // transfer) will treat as text. It must stay within description's maxLength
  // 255 or the gateway rejects it as a schema error and the poisoning never
  // reaches anything.
  it('the tool poisoning payload hides an instruction in a string arg', () => {
    const a = TOOL_ATTACKS.find((x) => x.id === 'tool_poisoning');
    expect(a.args.description, 'description carries the payload').toMatch(/SYSTEM:/);
    expect(a.args.description.length, 'description within maxLength 255').toBeLessThanOrEqual(255);
    expect(typeof a.args.amount, 'amount stays valid so the schema is not what fires').toBe('number');
  });
});
