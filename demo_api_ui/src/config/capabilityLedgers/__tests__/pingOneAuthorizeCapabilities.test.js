import { describe, it, expect } from 'vitest';
import {
  PINGONE_AUTHORIZE_CAPABILITIES,
  PINGONE_AUTHORIZE_GROUPS,
  allRelatedUCIds,
} from '../pingOneAuthorizeCapabilities';

describe('pingOneAuthorizeCapabilities', () => {
  it('has exactly 8 capabilities', () => {
    expect(PINGONE_AUTHORIZE_CAPABILITIES).toHaveLength(8);
  });

  it('every capability has a unique id, a known group, a one-liner, and evidence', () => {
    const groupIds = PINGONE_AUTHORIZE_GROUPS.map((g) => g.id);
    const ids = new Set();
    for (const cap of PINGONE_AUTHORIZE_CAPABILITIES) {
      expect(ids.has(cap.id)).toBe(false);
      ids.add(cap.id);
      expect(groupIds).toContain(cap.group);
      expect(cap.oneLiner).toEqual(expect.any(String));
      expect(cap.oneLiner.length).toBeGreaterThan(0);
      expect(cap.evidence.code).toEqual(expect.any(String));
      expect(Array.isArray(cap.relatedUCIds)).toBe(true);
      expect(cap.relatedUCIds.length).toBeGreaterThan(0);
    }
  });

  it('groups split 3/3/2 across realtime-decisioning, fine-grained-policy, operations-audit', () => {
    const counts = PINGONE_AUTHORIZE_GROUPS.map(
      (g) => PINGONE_AUTHORIZE_CAPABILITIES.filter((c) => c.group === g.id).length,
    );
    expect(counts).toEqual([3, 3, 2]);
  });

  it('the mcp-first-tool-gate capability is the literal "Contextual Runtime Authorization" claim', () => {
    const cap = PINGONE_AUTHORIZE_CAPABILITIES.find((c) => c.id === 'mcp-first-tool-gate');
    expect(cap.group).toBe('realtime-decisioning');
    expect(cap.relatedUCIds).toEqual(expect.arrayContaining(['UC1']));
  });

  it('allRelatedUCIds returns a deduped union of every relatedUCIds', () => {
    const ids = allRelatedUCIds();
    expect(ids).toEqual(expect.arrayContaining(['UC1', 'UC6', 'UC14b']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
