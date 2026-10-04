import { describe, it, expect } from 'vitest';
import {
  DEMO_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_USE_CASE_LABEL,
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_USE_CASE_SEARCH_TERMS,
  DEMO_MATURITY_GROUPS,
  DEMO_MISSION_GROUPS,
  DEMO_JOURNEY_GROUPS,
  PRIVILEGE_USE_CASE_IDS,
} from '../demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('keeps the presenter Demo script order', () => {
    expect(DEMO_USE_CASE_IDS).toEqual([
      'UC24',
      'UC1',
      'UC8',
      'UC7',
      'UC14b',
      'UC14',
      'UC12',
      'UC6',
      'UC2',
      'UC2.5',
      'UC2.7',
      'UC22',
      'UC5',
      'UC10',
      'UC13',
      'UC11',
      'UC20',
      'UC18',
      'UC30',
      'UC31',
      'UC32',
      'UC40',
      'UC38',
      'UC-TOOL1',
      'UC46',
      'UC47',
    ]);
  });

  it('exports the Demo section label', () => {
    expect(DEMO_USE_CASE_LABEL).toMatch(/Demo/i);
  });

  it('exports the curated CIAM agent-type group in demo order', () => {
    expect(CIAM_AGENT_TYPE_USE_CASE_IDS).toEqual(['UC43', 'UC44', 'UC45', 'UC2', 'UC2.6']);
  });

  it('exports presenter-friendly aliases for the live lanes', () => {
    expect(DEMO_USE_CASE_IDS).not.toContain('UC36');
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC7).toEqual(
      expect.arrayContaining(['mfa', 'step-up']),
    );
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC43).toEqual(
      expect.arrayContaining(['cimd', 'agent registration']),
    );
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC44).toEqual(
      expect.arrayContaining(['obo', 'digital assistant']),
    );
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC45).toEqual(
      expect.arrayContaining(['saas embedded', 'website worker', 'embedded agent', 'customer tenant']),
    );
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC46).toEqual(
      expect.arrayContaining(['privilege', 'a2a', 'access review', 'worker agent']),
    );
  });

  it('partitions the scripted demo across the maturity-model groups', () => {
    const groupedIds = DEMO_MATURITY_GROUPS.flatMap((group) => group.useCaseIds);
    expect(new Set(groupedIds)).toEqual(new Set(DEMO_USE_CASE_IDS));
    expect(groupedIds).toHaveLength(DEMO_USE_CASE_IDS.length);
  });

  it('keeps all 12 Mission Control shortcuts visible in the agreed order without the SaaS lane', () => {
    expect(DEMO_MISSION_GROUPS).toHaveLength(12);
    expect(DEMO_MISSION_GROUPS.map((group) => group.id)).toEqual([
      'personal-agent',
      'digital-assistant',
      'consumer-partner',
      'employee-agent',
      'workload-agent',
      'agent-network',
      'discover',
      'register',
      'authenticate',
      'authorize',
      'privilege',
      'govern',
    ]);
    expect(DEMO_MISSION_GROUPS.find((group) => group.id === 'personal-agent').useCaseIds)
      .toEqual(['UC43', 'UC44', 'UC38']);
  });

  it('keeps UC46 available through the A2A and Privilege journey filters', () => {
    expect(DEMO_JOURNEY_GROUPS.find((group) => group.id === 'j-a2a').useCaseIds).toContain('UC46');
    expect(DEMO_JOURNEY_GROUPS.find((group) => group.id === 'j-privilege-mcp').useCaseIds).toContain('UC46');
    expect(DEMO_MISSION_GROUPS.find((group) => group.id === 'privilege').useCaseIds).toContain('UC46');
    // The agent chain sits beside the access review in every A2A / Privilege filter.
    expect(DEMO_JOURNEY_GROUPS.find((group) => group.id === 'j-a2a').useCaseIds).toContain('UC47');
    expect(DEMO_MISSION_GROUPS.find((group) => group.id === 'privilege').useCaseIds).toContain('UC47');
  });

  it('exports the Privilege & JIT access lanes', () => {
    expect(PRIVILEGE_USE_CASE_IDS).toEqual([
      'UC17',
      'UC25',
      'UC40',
      'UC-PAM-SETUP',
      'UC-PAM-SCRIPT',
      'UC-LEARN11',
      'UC-TOOL3',
    ]);
    expect(DEMO_USE_CASE_SEARCH_TERMS.UC17).toEqual(
      expect.arrayContaining(['jit', 'ephemeral credentials', 'secretless']),
    );
    expect(DEMO_USE_CASE_SEARCH_TERMS['UC-PAM-SCRIPT']).toEqual(
      expect.arrayContaining(['approval', 'session recording', 'kill switch']),
    );
  });

  it('exports the admin vertical demo-steps id list', () => {
    expect(ADMIN_PRIMARY_USE_CASE_IDS).toEqual([
      'ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4', 'ADMIN5', 'ADMIN6',
      'ADMIN7', 'ADMIN8', 'ADMIN9', 'ADMIN10', 'ADMIN11', 'ADMIN12', 'ADMIN13',
    ]);
  });

  it('DEMO_USE_CASE_IDS = primary + advanced concatenated in that order', () => {
    expect(DEMO_USE_CASE_IDS).toEqual([
      ...DEMO_PRIMARY_USE_CASE_IDS,
      ...DEMO_ADVANCED_USE_CASE_IDS,
    ]);
  });

  it('primary and advanced sets are disjoint (no id appears in both)', () => {
    const primarySet = new Set(DEMO_PRIMARY_USE_CASE_IDS);
    const overlap = DEMO_ADVANCED_USE_CASE_IDS.filter((id) => primarySet.has(id));
    expect(overlap).toEqual([]);
  });

  it('all ids are unique across the full script', () => {
    const seen = new Set();
    const dupes = [];
    for (const id of DEMO_USE_CASE_IDS) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it('all ids are non-empty strings', () => {
    for (const id of [...DEMO_USE_CASE_IDS, ...ADMIN_PRIMARY_USE_CASE_IDS]) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('primary list has 26 steps (all use cases visible)', () => {
    expect(DEMO_PRIMARY_USE_CASE_IDS).toHaveLength(26);
  });

  // UC29 cannot fire on this deployment (Node gateway validates by JWKS, no
  // introspection hook; PingOne Agent Gateway has no outage toggle) — it must not be
  // put back into the script until that changes.
  it('does not script UC29 (introspection outage is not demonstrable here)', () => {
    expect(DEMO_PRIMARY_USE_CASE_IDS).not.toContain('UC29');
  });

  it('advanced list is empty (nothing hidden)', () => {
    expect(DEMO_ADVANCED_USE_CASE_IDS).toHaveLength(0);
  });

  // UC24 (Act 1 — public catalog, no token exchange) opens the script; UC1 is
  // the delegated-access step that follows it.
  it('UC24 opens the script and UC1 follows it', () => {
    expect(DEMO_PRIMARY_USE_CASE_IDS[0]).toBe('UC24');
    expect(DEMO_PRIMARY_USE_CASE_IDS[1]).toBe('UC1');
  });

  it('ADMIN ids all start with ADMIN', () => {
    for (const id of ADMIN_PRIMARY_USE_CASE_IDS) {
      expect(id).toMatch(/^ADMIN/);
    }
  });
});
