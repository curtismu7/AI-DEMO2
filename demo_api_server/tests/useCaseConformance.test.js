/**
 * Conformance mapper — the rule this encodes is "HITL must not satisfy STEP_UP".
 *
 * The whole point of the panel is to tell four controls apart that the existing
 * evidence-based verdict cannot. If outcomeConforms() ever grows a tolerance
 * between gate kinds, the checker silently goes back to passing the exact bug it
 * was built to catch (UC6/UC7/UC22 all returning HITL_REQUIRED and rendering
 * green).
 */
const {
  outcomeFromAgentResponse,
  outcomeConforms,
  conformanceSubjects,
  summarize,
} = require('../services/useCaseConformance');
const { VERTICALS } = require('../config/useCases.js');

describe('outcomeFromAgentResponse — the agent reports gates as an error on a 200', () => {
  test.each([
    [{ reply: 'Your balances: …' }, 'PERMIT'],
    [{ error: 'hitl_required' }, 'HITL_REQUIRED'],
    [{ error: 'step_up_required' }, 'STEP_UP'],
    [{ error: 'authorization_denied' }, 'DENY'],
    [{ error: 'gateway_policy_denied' }, 'DENY'],
    [{ error: 'TOKEN_INACTIVE' }, 'DENY_401'],
  ])('%j -> %s', (response, expected) => {
    expect(outcomeFromAgentResponse(response)).toBe(expected);
  });

  test('no error means the tool ran — a gate always names itself', () => {
    expect(outcomeFromAgentResponse({ reply: 'done', success: true })).toBe('PERMIT');
  });
});

describe('outcomeConforms — gates never satisfy each other', () => {
  test('exact match conforms', () => {
    expect(outcomeConforms('STEP_UP', 'STEP_UP')).toBe(true);
  });

  // The regression this file exists for.
  test.each([
    ['DENY', 'HITL_REQUIRED'],
    ['STEP_UP', 'HITL_REQUIRED'],
    ['PERMIT', 'HITL_REQUIRED'],
    ['HITL_REQUIRED', 'STEP_UP'],
    ['DENY', 'PERMIT'],
  ])('declared %s is NOT satisfied by %s', (expected, actual) => {
    expect(outcomeConforms(expected, actual)).toBe(false);
  });

  test('the ONE sanctioned allowance: a completed delegation reads as PERMIT', () => {
    expect(outcomeConforms('DELEGATE_AND_EXECUTE', 'PERMIT')).toBe(true);
    // …and it does not work in reverse, or for anything else.
    expect(outcomeConforms('PERMIT', 'DELEGATE_AND_EXECUTE')).toBe(false);
  });
});

describe('conformanceSubjects', () => {
  test.each(VERTICALS)('%s yields comparable subjects with a declared outcome', (vertical) => {
    const subjects = conformanceSubjects(vertical);
    expect(subjects.length).toBeGreaterThan(0);
    for (const s of subjects) {
      expect(typeof s.trigger).toBe('string');
      expect(s.trigger.length).toBeGreaterThan(0);
      expect(s.expected).toBeTruthy();
    }
  });

  test('banking covers the four amount bands — the case that motivated this', () => {
    const ids = conformanceSubjects('banking').map((s) => s.id);
    for (const id of ['UC6', 'UC7', 'UC8', 'UC22']) expect(ids).toContain(id);
  });

  test('A2A handoff chips are excluded — they need the specialist path', () => {
    for (const s of conformanceSubjects('banking')) {
      expect(s.trigger).not.toMatch(/specialist/i);
    }
  });
});

describe('summarize — a uniform column is the failure that looks like success', () => {
  test('flags a collapse when every row returned the same control', () => {
    const rows = [
      { ok: false, actual: 'HITL_REQUIRED' },
      { ok: true, actual: 'HITL_REQUIRED' },
      { ok: false, actual: 'HITL_REQUIRED' },
    ];
    expect(summarize(rows)).toMatchObject({ total: 3, passed: 1, failed: 2, collapsed: 'HITL_REQUIRED' });
  });

  test('does not cry collapse when outcomes genuinely differ', () => {
    const rows = [
      { ok: true, actual: 'DENY' },
      { ok: true, actual: 'STEP_UP' },
      { ok: true, actual: 'HITL_REQUIRED' },
    ];
    expect(summarize(rows).collapsed).toBeNull();
  });

  test('a single row is never a collapse — there is nothing to collapse onto', () => {
    expect(summarize([{ ok: true, actual: 'PERMIT' }]).collapsed).toBeNull();
  });
});
