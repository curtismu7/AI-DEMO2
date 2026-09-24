import { describe, expect, it } from 'vitest';
import { createMockIdJagTrace } from '../idJagMockTrace';

describe('offline ID-JAG fixture', () => {
  it('provides repeatable, token-free issuance, redemption, and tool evidence', () => {
    const first = createMockIdJagTrace();
    const second = createMockIdJagTrace();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.provenance).toBe('mock-id-jag');
    expect(first.tokenEvents.map((event) => event.id)).toEqual(['id-jag-issued', 'id-jag-redeemed']);
    expect(first.tokenEvents.every((event) => event.mock === true && event.claims.iss.startsWith('mock-'))).toBe(true);
    expect(first.mcpResult).toMatchObject({ mock: true, result: { balance: 'Mock balance: 1,234 points' } });
    expect(JSON.stringify(first)).not.toMatch(/Bearer |eyJ[A-Za-z0-9_-]{20,}|https?:\/\//);
  });
});
