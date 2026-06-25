const { ManifestSchema, ChipSchema } = require('../../services/verticalManifest/schema');

const base = {
  id: 'x',
  schemaVersion: 3,
  identity: { displayName: 'X' },
  theme: { cssVars: { '--a': '#000' } },
  agent: { persona: 'P' },
};

describe('chip mode + chips10', () => {
  it('ChipSchema accepts mode both/llm and defaults to both', () => {
    const r = ChipSchema.parse({ id: 'c1', label: 'L', message: 'm' });
    expect(r.mode).toBe('both');
    expect(ChipSchema.parse({ id: 'c2', label: 'L', message: 'm', mode: 'llm' }).mode).toBe('llm');
  });
  it('ChipSchema rejects an invalid mode', () => {
    expect(() => ChipSchema.parse({ id: 'c3', label: 'L', message: 'm', mode: 'bogus' })).toThrow();
  });
  it('manifest accepts dashboard.chips10 as a chip array', () => {
    const m = { ...base, dashboard: { kind: 'x', chips: [], chips10: [{ id: 'c1', label: 'L', message: 'm', mode: 'llm' }] } };
    expect(() => ManifestSchema.parse(m)).not.toThrow();
  });
  it('manifest is fine with no chips10 (optional)', () => {
    const m = { ...base, dashboard: { kind: 'x', chips: [] } };
    expect(() => ManifestSchema.parse(m)).not.toThrow();
  });
});
