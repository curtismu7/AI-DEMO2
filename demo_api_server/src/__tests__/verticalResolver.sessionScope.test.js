'use strict';

// Unit: resolver.activeIdFor(req) is session-scoped — a per-session preference
// wins over the process-global, so one session can't change another's vertical.

const { createResolver } = require('../../services/verticalManifest/resolver');

function makeResolver(globalId) {
  const loader = { get: () => null, reload() {}, removeFromCache() {} };
  const overlay = {
    get: () => undefined, list: () => [], setField() {}, setBatch() {},
    replaceBatch() {}, replaceRaw() {}, clearField() {}, clearAll() {},
  };
  const store = { getActiveId: () => globalId, setActiveId() {} };
  return createResolver(loader, overlay, store, { onEvent() {} });
}

describe('resolver.activeIdFor — session-scoped vertical', () => {
  it('session preference wins over the global', () => {
    const r = makeResolver('banking');
    expect(r.activeIdFor({ session: { active_vertical: 'healthcare' } })).toBe('healthcare');
  });

  it('falls back to the global when the session has no preference', () => {
    const r = makeResolver('banking');
    expect(r.activeIdFor({ session: {} })).toBe('banking');
    expect(r.activeIdFor({})).toBe('banking');
    expect(r.activeIdFor(null)).toBe('banking');
  });

  it('two sessions resolve independently (no bleed)', () => {
    const r = makeResolver('banking');
    const a = { session: { active_vertical: 'healthcare' } };
    const b = { session: { active_vertical: 'retail' } };
    expect(r.activeIdFor(a)).toBe('healthcare');
    expect(r.activeIdFor(b)).toBe('retail');
    // Mutating B's session does not affect A.
    b.session.active_vertical = 'workforce';
    expect(r.activeIdFor(a)).toBe('healthcare');
    expect(r.activeIdFor(b)).toBe('workforce');
  });

  it('bare activeId() remains the global (non-request contexts)', () => {
    const r = makeResolver('sporting-goods');
    expect(r.activeId()).toBe('sporting-goods');
  });
});
