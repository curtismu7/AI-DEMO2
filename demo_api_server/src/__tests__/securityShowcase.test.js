'use strict';

// Security Showcase contract + schema-regression tests.
//
// The showcase rendered nothing until the manifest Zod schema was taught about
// dashboard.securityShowcase and the chip dispatch fields — Zod strips unknown
// keys (resolver.parse), so an omission here silently breaks the panel on every
// vertical with no error. These tests lock that fix and assert every dropdown
// vertical ships a well-formed showcase. See memory reference_manifest_schema_strips_fields.

const path = require('path');
const { ManifestSchema, ChipSchema } = require('../../services/verticalManifest/schema');

// Verticals whose manifests must carry the Security Showcase (the dropdown set).
const SHOWCASE_VERTICALS = ['banking', 'healthcare', 'retail', 'workforce', 'sporting-goods'];
const EXPECTED_TABS = ['defenses', 'ai', 'attacks', 'pingone'];

const loadManifest = (id) =>
  require(path.resolve(__dirname, `../../config/verticals/${id}/manifest.json`));

describe('Security Showcase — schema regression', () => {
  it('ChipSchema preserves the showcase dispatch fields (not stripped)', () => {
    const r = ChipSchema.parse({
      id: 'c', label: 'L', message: 'm',
      showcase: 'atk_confused_deputy',
      caption: 'Attack blocked.',
      stepUpMethod: 'otp',
      denyTool: 'show_mortgage',
    });
    expect(r.showcase).toBe('atk_confused_deputy');
    expect(r.caption).toBe('Attack blocked.');
    expect(r.stepUpMethod).toBe('otp');
    expect(r.denyTool).toBe('show_mortgage');
  });

  it('ManifestSchema preserves dashboard.securityShowcase through parse', () => {
    const m = {
      id: 'x', schemaVersion: 3, identity: { displayName: 'X' },
      theme: { cssVars: { '--a': '#000' } }, agent: { persona: 'P' },
      dashboard: {
        kind: 'x', chips: [],
        securityShowcase: { tabs: [{ id: 't', label: 'T', chips: [{ id: 'c', label: 'L', message: 'm', showcase: 'x' }] }] },
      },
    };
    const parsed = ManifestSchema.parse(m);
    expect(parsed.dashboard.securityShowcase).toBeTruthy();
    expect(parsed.dashboard.securityShowcase.tabs[0].chips[0].showcase).toBe('x');
  });
});

describe('Security Showcase — per-vertical contract', () => {
  for (const vertical of SHOWCASE_VERTICALS) {
    describe(vertical, () => {
      const parsed = ManifestSchema.parse(loadManifest(vertical));
      const sc = parsed.dashboard && parsed.dashboard.securityShowcase;

      it('survives schema parse with the 4 expected tabs', () => {
        expect(sc).toBeTruthy();
        expect(sc.tabs.map((t) => t.id)).toEqual(EXPECTED_TABS);
      });

      it('every attack chip carries a showcase key + presenter caption', () => {
        const attacks = sc.tabs.find((t) => t.id === 'attacks').chips;
        expect(attacks.length).toBeGreaterThanOrEqual(6);
        for (const c of attacks) {
          if (!c.showcase) throw new Error(`${c.id} needs a showcase key`);
          if (!c.caption) throw new Error(`${c.id} needs a caption`);
        }
      });

      it('the PingOne Admin tab is admin-only', () => {
        const pingone = sc.tabs.find((t) => t.id === 'pingone');
        expect(pingone.adminOnly).toBe(true);
      });

      it('every showcase chip has id/label/message', () => {
        for (const tab of sc.tabs) {
          for (const c of tab.chips) {
            if (!c.id || !c.label || !c.message) throw new Error(`${tab.id}/${c.id} missing core field`);
          }
        }
      });
    });
  }
});
