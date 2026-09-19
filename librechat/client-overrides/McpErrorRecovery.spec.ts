import { normalizeMcpServerNames } from './McpErrorRecovery';

describe('normalizeMcpServerNames', () => {
  test('trims, drops blank values, and removes duplicates', () => {
    expect(normalizeMcpServerNames([' sports ', '', 'sports', 'banking', '  '])).toEqual([
      'sports',
      'banking',
    ]);
  });
});
