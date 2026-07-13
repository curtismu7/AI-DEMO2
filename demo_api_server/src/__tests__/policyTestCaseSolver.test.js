const {
  _satisfy,
  _violate,
  _classifyDomain,
  buildTestCasesForRule,
} = require('../../services/policyTestCaseSolver');

function idx(entries) { return new Map(entries.map((e) => [e.id, e])); }

describe('policyTestCaseSolver satisfy/violate', () => {
  test('GreaterThan: satisfy is constant+1, violate is constant', () => {
    const index = idx([{ id: 'a1', name: 'Amount', valueType: 'NUMBER' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ Amount: 2001 });
    const avoid = {}; _violate(node, index, avoid, {});
    expect(avoid).toEqual({ Amount: 2000 });
  });

  test('Equals (string): satisfy is the constant, violate prefers a differing base default', () => {
    const index = idx([{ id: 'a1', name: 'TransactionType', valueType: 'STRING' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'withdrawal' } } } };
    const base = { TransactionType: 'transfer' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ TransactionType: 'withdrawal' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TransactionType: 'transfer' });
  });

  test('Equals (string): violate falls back to the generic sentinel when the base default equals the constant', () => {
    const index = idx([{ id: 'a1', name: 'TransactionType', valueType: 'STRING' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'transfer' } } } };
    const base = { TransactionType: 'transfer' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TransactionType: '__generated__' });
  });

  test('NotEquals (boolean): satisfy flips the constant, violate reproduces it', () => {
    const index = idx([{ id: 'a1', name: 'HitlApproved', valueType: 'BOOLEAN' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: 'true' } } } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ HitlApproved: false });
    const avoid = {}; _violate(node, index, avoid, {});
    expect(avoid).toEqual({ HitlApproved: true });
  });

  test('AND with disjoint attributes: satisfy sets both, violate falsifies only the first', () => {
    const index = idx([
      { id: 'a1', name: 'Amount', valueType: 'NUMBER' },
      { id: 'a2', name: 'TransactionType', valueType: 'STRING' },
    ]);
    const node = {
      and: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '500' } } } },
          { comparison: { left: { attribute: { id: 'a2' } }, op: 'Equals', right: { constant: { value: 'transfer' } } } },
        ],
      },
    };
    const base = { TransactionType: 'deposit' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ Amount: 501, TransactionType: 'transfer' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ Amount: 500, TransactionType: 'transfer' });
  });

  test('AND where two children constrain the same attribute: the falsifying write wins', () => {
    const index = idx([{ id: 'a1', name: 'UserId', valueType: 'STRING' }]);
    const node = {
      and: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: 'none' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: '' } } } },
        ],
      },
    };
    const base = { UserId: 'demoUser' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ UserId: 'none' });
  });

  test('OR: satisfy picks the first branch', () => {
    const index = idx([{ id: 'a1', name: 'ToolName', valueType: 'STRING' }]);
    const node = {
      or: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'checkout' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'create_transfer' } } } },
        ],
      },
    };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ ToolName: 'checkout' });
  });

  test('OR of same-attribute Equals: violate picks one value distinct from every branch', () => {
    const index = idx([{ id: 'a1', name: 'ToolName', valueType: 'STRING' }]);
    const node = {
      or: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'checkout' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'create_transfer' } } } },
        ],
      },
    };
    const base = { ToolName: 'transfer' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ ToolName: 'transfer' });
  });

  test('NOT flips satisfy/violate on its child', () => {
    const index = idx([{ id: 'a1', name: 'Acr', valueType: 'STRING' }]);
    const node = { not: { condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'Multi_Factor' } } } } } };
    const base = { Acr: '' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ Acr: '' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ Acr: 'Multi_Factor' });
  });

  test('reference resolves the named condition transparently', () => {
    const index = idx([
      { id: 'a1', name: 'Amount', valueType: 'NUMBER' },
      { id: 'c1', condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } } },
    ]);
    const node = { reference: { id: 'c1' } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ Amount: 2001 });
  });

  test('attribute-to-attribute comparison uses the right attribute\'s base default', () => {
    const index = idx([
      { id: 'a1', name: 'TokenAudience', valueType: 'STRING' },
      { id: 'a2', name: 'McpResourceUri', valueType: 'STRING' },
    ]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { attribute: { id: 'a2' } } } };
    const base = { TokenAudience: 'mcpgateway.ping.demo', McpResourceUri: 'mcpgateway.ping.demo' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ TokenAudience: 'mcpgateway.ping.demo' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TokenAudience: '__generated__' });
  });
});

describe('policyTestCaseSolver domain classification', () => {
  test('attributes fully within the transaction preset classify as transaction', () => {
    expect(_classifyDomain(['Amount', 'Acr'])).toBe('transaction');
  });
  test('attributes fully within the mcp preset classify as mcp', () => {
    expect(_classifyDomain(['ToolName', 'HitlApproved'])).toBe('mcp');
  });
  test('attributes outside both presets classify as custom', () => {
    expect(_classifyDomain(['UserTier', 'Amount'])).toBe('custom');
  });
});

describe('buildTestCasesForRule', () => {
  test('an empty condition produces no test cases', () => {
    const rule = { effectSettings: { type: 'unconditionalPermit' }, condition: { empty: {} } };
    expect(buildTestCasesForRule(rule, new Map())).toBeNull();
  });

  test('effectSettings.condition takes precedence over the top-level condition when present', () => {
    const index = idx([{ id: 'a1', name: 'Amount', valueType: 'NUMBER' }]);
    const rule = {
      effectSettings: {
        type: 'conditionalDenyElsePermit',
        condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } },
      },
      condition: { empty: {} },
    };
    const result = buildTestCasesForRule(rule, index);
    expect(result.trigger.preset).toBe('transaction');
    expect(result.trigger.parameters.Amount).toBe(2001);
    expect(result.avoid.parameters.Amount).toBe(2000);
  });
});
