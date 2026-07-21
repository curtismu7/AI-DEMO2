import { describe, it, expect } from 'vitest';
import {
  AGENT_GATEWAY_CAPABILITIES,
  AGENT_GATEWAY_GROUPS,
  allRelatedUCIds,
} from '../agentGatewayCapabilities';

describe('agentGatewayCapabilities', () => {
  it('has exactly 7 capabilities', () => {
    expect(AGENT_GATEWAY_CAPABILITIES).toHaveLength(7);
  });

  it('every capability has a unique id, a known group, a one-liner, and evidence', () => {
    const groupIds = AGENT_GATEWAY_GROUPS.map((g) => g.id);
    const ids = new Set();
    for (const cap of AGENT_GATEWAY_CAPABILITIES) {
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

  it('groups split 2/2/3 across validate-audit, throttle-transform, oauth-policy-metadata', () => {
    const counts = AGENT_GATEWAY_GROUPS.map(
      (g) => AGENT_GATEWAY_CAPABILITIES.filter((c) => c.group === g.id).length,
    );
    expect(counts).toEqual([2, 2, 3]);
  });

  it('the metadata-controls (RAR) capability cites no Groovy/PingGateway equivalent', () => {
    const cap = AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === 'metadata-controls');
    expect(cap.evidence.code).toMatch(/no Groovy equivalent/i);
    expect(cap.relatedUCIds).toEqual(expect.arrayContaining(['UC14b']));
  });

  it('allRelatedUCIds returns a deduped union of every relatedUCIds', () => {
    const ids = allRelatedUCIds();
    expect(ids).toEqual(expect.arrayContaining(['UC1', 'UC18', 'UC29', 'UC14b']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
