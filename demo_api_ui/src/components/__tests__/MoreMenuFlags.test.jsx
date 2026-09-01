// The More menu takes its flag labels from QUICK_FLAGS by id. If someone
// removes or renames an id in the pill's lineup, the menu silently renders
// nothing for that row — no error, no console warning, just a missing switch
// nobody notices until a demo. This is the check that fails first.
import { describe, it, expect } from 'vitest';
import { QUICK_FLAGS } from '../QuickFlagsPill';
import { MORE_MENU_FLAG_IDS } from '../AIAgent';

describe('More menu server-flag rows', () => {
  it('every id it renders exists in the pill lineup', () => {
    const known = new Set(QUICK_FLAGS.map((d) => d.id));
    expect(MORE_MENU_FLAG_IDS.filter((id) => !known.has(id))).toEqual([]);
  });

  it('every id resolves to a non-empty label', () => {
    for (const id of MORE_MENU_FLAG_IDS) {
      const def = QUICK_FLAGS.find((d) => d.id === id);
      expect(def?.label, `no label for ${id}`).toBeTruthy();
    }
  });

  it('carries the ID-JAG switch the menu exists to expose', () => {
    expect(MORE_MENU_FLAG_IDS).toContain('ff_enterprise_managed_mcp_auth');
    const def = QUICK_FLAGS.find((d) => d.id === 'ff_enterprise_managed_mcp_auth');
    expect(def.label).toMatch(/ID-JAG/);
  });
});
