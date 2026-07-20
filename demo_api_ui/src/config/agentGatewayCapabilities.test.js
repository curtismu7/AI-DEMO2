import { AGENT_GATEWAY_CAPABILITIES, CAPABILITY_GROUPS, allRelatedUCIds } from './agentGatewayCapabilities';

describe('agentGatewayCapabilities', () => {
  it('has exactly 7 capabilities', () => {
    expect(AGENT_GATEWAY_CAPABILITIES).toHaveLength(7);
  });

  it('every capability has a unique id and belongs to a known group', () => {
    const groupIds = CAPABILITY_GROUPS.map((g) => g.id);
    const ids = new Set();
    for (const cap of AGENT_GATEWAY_CAPABILITIES) {
      expect(ids.has(cap.id)).toBe(false);
      ids.add(cap.id);
      expect(groupIds).toContain(cap.group);
      expect(['pinggateway', 'node', 'node-only']).toContain(cap.enforcedByDefault);
      expect(cap.evidence.node).toEqual(expect.any(String));
    }
  });

  it('groups split 2/2/3 across validate-audit, throttle-transform, oauth-policy-metadata', () => {
    const counts = CAPABILITY_GROUPS.map(
      (g) => AGENT_GATEWAY_CAPABILITIES.filter((c) => c.group === g.id).length
    );
    expect(counts).toEqual([2, 2, 3]);
  });

  it('RAR is the one node-only capability, with no pingGateway evidence', () => {
    const rar = AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === 'metadata-controls');
    expect(rar.enforcedByDefault).toBe('node-only');
    expect(rar.evidence.pingGateway).toBeNull();
  });

  it('allRelatedUCIds returns a deduped union of every relatedUCIds', () => {
    const ids = allRelatedUCIds();
    expect(ids).toEqual(expect.arrayContaining(['UC1', 'UC18', 'UC29', 'UC14b']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
