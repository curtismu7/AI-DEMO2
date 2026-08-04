import { executeGetBranchHours } from '../publicCatalogHandlers';

const deps: any = { apiClient: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };

describe('executeGetBranchHours (UC24 public catalog)', () => {
  test('no vertical falls back to Super Banking branches', async () => {
    const r = await executeGetBranchHours(deps, '', {});
    expect(r.structuredContent!.message).toContain('Super Banking branch locations');
    expect((r.structuredContent!.branches as any[])[0].id).toBe('branch-austin-main');
  });

  test('government returns permit offices, never banking branches', async () => {
    const r = await executeGetBranchHours(deps, '', { vertical: 'government' });
    const msg = r.structuredContent!.message as string;
    expect(msg).toContain('City & County office locations');
    expect(msg).not.toContain('Super Banking');
    expect((r.structuredContent!.branches as any[]).map((b) => b.id)).toContain('gov-austin');
  });

  test('every vertical resolves its own catalog with its own brand', async () => {
    const expectations: Record<string, string> = {
      healthcare: 'Wellspring Health',
      retail: 'Super Retail',
      university: 'Riverbend University',
      workforce: 'Northwind',
      'sporting-goods': 'Super Sports',
      manufacturing: 'Ironline',
      investment: 'Meridian Wealth',
      airlines: 'United',
    };
    for (const [vertical, brand] of Object.entries(expectations)) {
      const r = await executeGetBranchHours(deps, '', { vertical });
      expect(r.structuredContent!.message).toContain(brand);
      expect(r.structuredContent!.message).not.toContain('Super Banking');
    }
  });

  test('unknown vertical falls back to banking instead of an empty list', async () => {
    const r = await executeGetBranchHours(deps, '', { vertical: 'not-a-vertical' });
    expect((r.structuredContent!.branches as any[]).length).toBeGreaterThan(0);
    expect(r.structuredContent!.message).toContain('Super Banking');
  });

  test('city filter still works within a vertical', async () => {
    const r = await executeGetBranchHours(deps, '', { vertical: 'government', city: 'Denver' });
    const branches = r.structuredContent!.branches as any[];
    expect(branches).toHaveLength(1);
    expect(branches[0].id).toBe('gov-denver');
  });
});
