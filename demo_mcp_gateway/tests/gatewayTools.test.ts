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

  // MCP spec (2025-06-18+) structured tool output: a tool that returns
  // structuredContent (see bankingDataDispatch.ts/dualTokenDispatch.ts/
  // apiKeyDispatch.ts) SHOULD declare outputSchema so a client knows what
  // shape to expect. special_offers has no backend call (a marker result,
  // no real data) so it's excluded.
  it('declares outputSchema on every tool that returns structuredContent data', () => {
    const DATA_BEARING = [
      'user_profile_card',
      'show_health_record',
      'show_gear_order',
      'show_gear_warranty',
      'show_enrollment',
      'show_large_purchase',
      'show_expense_report',
      'show_permit',
      'show_work_order',
    ];
    for (const name of DATA_BEARING) {
      const t = GATEWAY_TOOLS.find((d) => d.name === name);
      expect(t?.outputSchema).toMatchObject({ type: 'object' });
    }
  });
});
