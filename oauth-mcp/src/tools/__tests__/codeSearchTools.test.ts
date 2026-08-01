import { BankingToolRegistry } from '../BankingToolRegistry';

describe('code-search tool registration', () => {
  const names = BankingToolRegistry.getAllTools().map(t => t.name);
  test.each(['code_search', 'get_code', 'list_codebases'])('%s is registered', (n) => {
    expect(names).toContain(n);
  });
  test('all require code:search and are read-only', () => {
    for (const n of ['code_search', 'get_code', 'list_codebases']) {
      const t = BankingToolRegistry.getTool(n)!;
      expect(t.requiredScopes).toEqual(['code:search']);
      expect(t.readOnly).toBe(true);
      expect(t.requiresUserAuth).toBe(false);
    }
  });
});
