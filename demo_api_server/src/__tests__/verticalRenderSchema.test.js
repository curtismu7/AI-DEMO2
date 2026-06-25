// demo_api_server/src/__tests__/verticalRenderSchema.test.js
const { ManifestSchema } = require('../../services/verticalManifest/schema');

const base = {
  id: 'x', schemaVersion: 3,
  identity: { displayName: 'X' },
  theme: { cssVars: { '--a': '#000' } },
  agent: { persona: 'P' },
};

describe('manifest render block', () => {
  it('accepts a manifest with a valid render block', () => {
    const m = { ...base, render: {
      book_appointment: { type: 'card', title: 'Booked', fields: [{ label: 'When', path: 'when', format: 'date' }] },
      view_records: { type: 'table', columns: [{ label: 'Provider', path: 'provider' }] },
    } };
    expect(() => ManifestSchema.parse(m)).not.toThrow();
  });

  it('accepts a manifest with no render block (optional)', () => {
    expect(() => ManifestSchema.parse({ ...base })).not.toThrow();
  });

  it('rejects an unknown render type', () => {
    const m = { ...base, render: { t: { type: 'bogus' } } };
    expect(() => ManifestSchema.parse(m)).toThrow();
  });
});
