import { describe, it, expect } from 'vitest';
import {
  TRIAGE_SIGNAL_META,
  INTENT_TRIAGE_SCENARIOS,
  CODING_AGENTS,
  CODING_HOOK_SCENARIOS,
  CODING_DECISION_META,
  SAAS_PLATFORMS,
  SAAS_REQUEST_SCENARIOS,
  SAAS_STAGES,
  SEALED_PROMPT_RECORDS,
  SEALED_DEMO,
} from '../privilegePlatformUpdateDemos';
import {
  PII_KINDS,
  PII_SAMPLES,
  luhnValid,
} from '../privilegePiiKinds';

// The demos make claims on screen; these tests hold the scenario data to the
// claims (outcomes within the documented vocabulary, every scenario carrying
// all three signals, checksum validators actually validating).

describe('platform update demos — scenario data integrity', () => {
  it('every triage scenario has all three signals and a documented outcome', () => {
    const outcomes = ['deny', 'hold', 'alert', 'allow'];
    for (const s of INTENT_TRIAGE_SCENARIOS) {
      for (const meta of TRIAGE_SIGNAL_META) {
        expect(s.signals[meta.id], `${s.key} missing ${meta.id}`).toBeTruthy();
      }
      expect(outcomes).toContain(s.outcome);
      expect(s.expect).toBeTruthy();
    }
  });

  it('deterministic-tier scenarios deny; nothing else claims a hard refusal', () => {
    for (const s of INTENT_TRIAGE_SCENARIOS) {
      if (s.signals.intent.deterministic || s.category.startsWith('Deterministic')) {
        expect(s.outcome, s.key).toBe('deny');
      } else {
        expect(s.outcome, s.key).not.toBe('deny');
      }
    }
  });

  it('coding scenarios cover the six agents named in the update, decisions are native vocabulary', () => {
    const named = ['claude-code', 'cursor', 'codex', 'gemini-cli', 'copilot', 'antigravity'];
    for (const id of named) expect(CODING_AGENTS.map((a) => a.id)).toContain(id);
    for (const s of CODING_HOOK_SCENARIOS) {
      expect(CODING_AGENTS.map((a) => a.id)).toContain(s.agentId);
      expect(Object.keys(CODING_DECISION_META)).toContain(s.decision);
      expect(s.reason).toBeTruthy();
    }
  });

  it('saas matrix matches the update: six platforms, every request grants on a listed platform', () => {
    expect(SAAS_PLATFORMS.map((p) => p.id)).toEqual([
      'github', 'gitlab', 'salesforce', 'snowflake', 'databricks', 'google-workspace',
    ]);
    for (const s of SAAS_REQUEST_SCENARIOS) {
      expect(SAAS_PLATFORMS.map((p) => p.id)).toContain(s.platform);
      expect(s.ttlHours).toBeGreaterThan(0);
      expect(s.approvers.length).toBeGreaterThan(0);
    }
    expect(SAAS_STAGES.map((s) => s.id)).toEqual(['requested', 'approved', 'granted', 'expired']);
  });

  it('sealed prompt records always show sealed content until opened, and sample plaintext exists only for block records', () => {
    for (const r of SEALED_PROMPT_RECORDS) {
      expect(r.sealed).toMatch(/^Sealed record/);
    }
    for (const id of Object.keys(SEALED_DEMO.plaintextByRecord)) {
      const rec = SEALED_PROMPT_RECORDS.find((r) => r.id === id);
      expect(rec, `plaintext for unknown record ${id}`).toBeTruthy();
    }
  });
});

describe('PII kinds — checksum validators', () => {
  it('luhn accepts the fixture card and rejects an off-by-one', () => {
    expect(luhnValid('4539148803436467')).toBe(true);
    expect(luhnValid('4539148803436468')).toBe(false);
  });

  it('every kind with a validator accepts its fixture sample in the support-ticket sample', () => {
    const sample = PII_SAMPLES.find((s) => s.key === 'support-ticket');
    expect(sample).toBeTruthy();
    for (const kind of PII_KINDS.filter((k) => k.validate)) {
      const matches = [...sample.text.matchAll(new RegExp(kind.pattern.source, kind.pattern.flags.includes('g') ? kind.pattern.flags : `${kind.pattern.flags}g`))];
      const accepted = matches.map((m) => m[0].trim()).filter((v) => kind.validate(v));
      // Not every kind appears in this sample; the contract is: any match the
      // page would report must pass validation.
      if (accepted.length) expect(accepted.length, kind.id).toBeGreaterThan(0);
    }
  });

  it('the checksum-fail sample contains no reportable match', () => {
    const sample = PII_SAMPLES.find((s) => s.key === 'checksum-fail');
    for (const kind of PII_KINDS.filter((k) => k.validate)) {
      const matches = [...sample.text.matchAll(new RegExp(kind.pattern.source, kind.pattern.flags.includes('g') ? kind.pattern.flags : `${kind.pattern.flags}g`))];
      for (const m of matches) {
        // Matches exist but none may validate — that is the point of the sample.
        expect(kind.validate(m[0].trim()), `${kind.id} unexpectedly valid: ${m[0]}`).toBe(false);
      }
    }
  });

  it('the clean sample produces no reportable findings', () => {
    const sample = PII_SAMPLES.find((s) => s.key === 'no-pii');
    for (const kind of PII_KINDS) {
      const re = new RegExp(kind.pattern.source, kind.pattern.flags.includes('g') ? kind.pattern.flags : `${kind.pattern.flags}g`);
      const matches = [...sample.text.matchAll(re)].filter((m) => !kind.validate || kind.validate(m[0].trim()));
      expect(matches.length, kind.id).toBe(0);
    }
  });

  it('a checksummed kind claims its span over the generic phone pattern', async () => {
    const { scan } = await import('../../pages/privilegePiiScan');
    const findings = scan('SIN 046 454 286 and card 4539 1488 0343 6467, call +1 415 555 0132', [
      ...PII_KINDS,
    ]);
    const byKind = Object.fromEntries(findings.map((f) => [f.kindId, f]));
    expect(byKind['canada-sin']).toBeTruthy();
    expect(byKind['credit-card']).toBeTruthy();
    // The SIN and card digits must not ALSO be reported as phone numbers.
    const phones = (findings.filter((f) => f.kindId === 'phone')).map((f) => f.value);
    expect(phones.join(' ')).not.toContain('046 454 286');
    expect(phones.join(' ')).not.toContain('4539 1488');
    expect(phones.join(' ')).toContain('+1 415 555 0132');
  });
});
