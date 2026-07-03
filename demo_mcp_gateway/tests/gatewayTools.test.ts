'use strict';
import { GATEWAY_TOOLS } from '../src/gatewayTools';

describe('GATEWAY_TOOLS', () => {
  it('exports the gateway-owned tool descriptors', () => {
    const names = GATEWAY_TOOLS.map((t) => t.name);
    expect(names).toContain('special_offers');
    expect(names).toContain('user_profile_card');
    expect(names).toContain('show_health_record');
    // every descriptor has a JSON-Schema object inputSchema
    for (const t of GATEWAY_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});
