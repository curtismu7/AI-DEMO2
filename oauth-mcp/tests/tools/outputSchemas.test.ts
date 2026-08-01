import { BankingToolRegistry } from '../../src/tools/BankingToolRegistry';

describe('BankingToolRegistry outputSchema', () => {
  const tools = BankingToolRegistry.getAllTools();

  it('every tool has an outputSchema defined', () => {
    const missing = tools.filter(t => !t.outputSchema).map(t => t.name);
    expect(missing).toEqual([]);
  });

  it('every outputSchema has type "object"', () => {
    tools.forEach(t => {
      expect(t.outputSchema!.type).toBe('object');
    });
  });
});
