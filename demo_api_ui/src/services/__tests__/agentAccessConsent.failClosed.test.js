// demo_api_ui/src/services/__tests__/agentAccessConsent.failClosed.test.js
// finding #63: isAgentBlockedByConsentDecline() fell back to `false` (not
// blocked) when localStorage.getItem threw — indistinguishable from a
// legitimate "never declined" state. Proves the module now fails CLOSED
// (blocked=true) when the initial storage read itself throws.
//
// Uses vi.stubGlobal to replace `localStorage` outright rather than spying
// on Storage.prototype — where the Storage methods live differs between
// runtimes (own instance properties under Node 26's builtin, on
// Storage.prototype under the jsdom store Node 22/CI provides), so a spy
// pinned to either location can silently intercept nothing on the other.
// See src/__tests__/useCustomChips.test.js for the same established pattern.

const throwingStorage = {
  getItem: () => { throw new Error('SecurityError: storage disabled by policy'); },
  setItem: () => { throw new Error('SecurityError: storage disabled by policy'); },
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  get length() { return 0; },
};

let _store = {};
const workingStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null),
  setItem: (key, val) => { _store[key] = String(val); },
  removeItem: (key) => { delete _store[key]; },
  clear: () => { _store = {}; },
  key: (index) => Object.keys(_store)[index] ?? null,
  get length() { return Object.keys(_store).length; },
};

describe('agentAccessConsent — fail-closed on storage failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    _store = {};
  });

  test('finding #63: reports blocked=true when the initial localStorage read throws', async () => {
    vi.stubGlobal('localStorage', throwingStorage);
    vi.resetModules();
    const { isAgentBlockedByConsentDecline } = await import('../agentAccessConsent.js');

    expect(isAgentBlockedByConsentDecline()).toBe(true);
  });

  test('reports blocked=false when storage works and has no decline recorded', async () => {
    vi.stubGlobal('localStorage', workingStorage);
    vi.resetModules();
    const { isAgentBlockedByConsentDecline } = await import('../agentAccessConsent.js');

    expect(isAgentBlockedByConsentDecline()).toBe(false);
  });

  test('a later localStorage failure does not flip an already-established blocked=false back to blocked', async () => {
    vi.stubGlobal('localStorage', workingStorage);
    vi.resetModules();
    const mod = await import('../agentAccessConsent.js');

    expect(mod.isAgentBlockedByConsentDecline()).toBe(false);

    // Storage starts failing sometime after the module already established its
    // in-memory state (e.g. quota hit, policy change mid-session). The module
    // never re-reads storage for isAgentBlockedByConsentDecline(), so this must
    // not affect the answer.
    vi.stubGlobal('localStorage', throwingStorage);

    expect(mod.isAgentBlockedByConsentDecline()).toBe(false);
  });
});
