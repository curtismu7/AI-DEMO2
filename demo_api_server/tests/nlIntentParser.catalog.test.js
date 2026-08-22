'use strict';

const {
  CAPABILITY_CATALOG,
  buildCatalogMessage,
  parseHeuristic,
} = require('../services/nlIntentParser');

describe('Protected RAG routing', () => {
  it('routes the exact Demo Step to code_search with bounded parameters', () => {
    expect(parseHeuristic('find where the BFF performs MCP token exchange', 'banking')).toEqual({
      kind: 'banking',
      banking: {
        action: 'code_search',
        params: { query: 'BFF MCP token exchange', limit: 5 },
      },
    });
  });

  it('does not capture unrelated generic search prompts', () => {
    const result = parseHeuristic('find a nearby coffee shop', 'banking');
    expect(result?.banking?.action).not.toBe('code_search');
  });
});

describe('capability catalog', () => {
  it('exports CAPABILITY_CATALOG as a non-empty string array', () => {
    expect(Array.isArray(CAPABILITY_CATALOG)).toBe(true);
    expect(CAPABILITY_CATALOG.length).toBeGreaterThan(0);
    expect(CAPABILITY_CATALOG.every((c) => typeof c === 'string')).toBe(true);
  });

  it('buildCatalogMessage returns a message containing every catalog item', () => {
    const msg = buildCatalogMessage();
    CAPABILITY_CATALOG.forEach((item) => {
      expect(msg).toContain(item);
    });
  });

  it('message has bullet formatting and the heuristics-only note', () => {
    const msg = buildCatalogMessage();
    expect(msg).toContain('•');
    expect(msg).toContain('Heuristics-only mode');
  });

  it('catalog covers core handled actions incl. deposit/withdraw', () => {
    expect(buildCatalogMessage()).toContain('deposit');
  });
});

// Absolute rule (user, 2026-05-29): EVERY agent path must work with EVERY
// vertical. The heuristic path was banking-only; these guard the manifest-driven
// catalog so non-banking verticals never leak banking terminology.
describe('vertical-aware catalog (all verticals)', () => {
  const sportingCtx = {
    terminology: { accounts: 'Loyalty Accounts', balance: 'Reward Points', transactions: 'Purchases', highValueAction: 'Team Order' },
    chips: [
      { key: 'balance', label: 'Reward Points' },
      { key: 'accounts', label: 'My Gear' },
      { key: 'transactions', label: 'Purchase History' },
      { key: 'transfer', label: 'Place Order' },
    ],
  };
  const healthcareCtx = {
    terminology: { accounts: 'Patient Records', balance: 'Coverage', transactions: 'Appointments', highValueAction: 'Release Records' },
    chips: [
      { key: 'balance', label: 'Check Coverage' },
      { key: 'accounts', label: 'My Records' },
      { key: 'transactions', label: 'Appointments' },
      { key: 'transfer', label: 'Release Records' },
    ],
  };

  it('banking catalog (no ctx) is unchanged — regression-safe default', () => {
    const msg = buildCatalogMessage();
    expect(msg).toContain('show my checking balance');
    expect(msg).toContain('mortgage');
  });

  it('sporting-goods catalog speaks the vertical and leaks no banking terms', () => {
    const msg = buildCatalogMessage(sportingCtx);
    expect(msg).toContain('Reward Points');
    expect(msg).toContain('My Gear');
    expect(msg).not.toMatch(/checking|savings|mortgage/i);
  });

  it('healthcare catalog speaks the vertical and leaks no banking terms', () => {
    const msg = buildCatalogMessage(healthcareCtx);
    expect(msg).toContain('Coverage');
    expect(msg).toContain('My Records');
    expect(msg).not.toMatch(/checking|savings|mortgage/i);
  });

  it('parseHeuristic no-match returns the vertical-aware catalog', () => {
    const res = parseHeuristic('hello there friend', 'sporting-goods', sportingCtx);
    expect(res.kind).toBe('none');
    expect(res.message).toContain('Reward Points');
    expect(res.message).not.toMatch(/mortgage/i);
  });

  it('parseHeuristic no-match for banking is unchanged', () => {
    const res = parseHeuristic('hello there friend', 'banking');
    expect(res.kind).toBe('none');
    expect(res.message).toContain('mortgage');
  });
});

// Live vertical catalogs must quote real chip messages (not invented
// "show my {terminology}" phrases that never match heuristics).
describe('live vertical catalog quotes always parse (all verticals)', () => {
  const VERTICALS = [
    'banking',
    'healthcare',
    'retail',
    'sporting-goods',
    'workforce',
    'government',
    'university',
    'manufacturing',
    'oauth-teaching',
  ];

  for (const v of VERTICALS) {
    it(`${v}: every quoted catalog example parses to a non-none kind`, () => {
      const manifest = require(`../config/verticals/${v}/manifest.json`);
      // Banking keeps the hand-authored catalog (null ctx). Other verticals
      // build ctx from the on-disk manifest so the test does not depend on
      // verticalManifest.init() having loaded every plugin.
      const ctx =
        v === 'banking'
          ? null
          : {
              terminology: manifest.terminology,
              chips: (manifest.dashboard && manifest.dashboard.chips10) || [],
            };
      if (v !== 'banking') {
        expect(ctx.terminology).toBeTruthy();
        expect(ctx.chips.length).toBeGreaterThan(0);
      }
      const msg = buildCatalogMessage(ctx);
      const examples = [...msg.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(examples.length).toBeGreaterThan(0);
      for (const ex of examples) {
        const res = parseHeuristic(ex, v, ctx);
        expect({ ex, kind: res.kind }).toEqual({
          ex,
          kind: expect.not.stringMatching(/^none$/),
        });
        expect(['vertical', 'banking', 'education']).toContain(res.kind);
      }
      if (v !== 'banking') {
        expect(msg).not.toMatch(/checking|savings|mortgage/i);
      }
    });
  }
});

// Regression: the LIVE path resolves ctx via resolveActiveVerticalCtx() after
// verticalManifest.init(). Banking's manifest carries a terminology block, so a
// naive `if (m.terminology)` check would treat banking like a themed vertical and
// collapse its 10-item hand-authored catalog to 6 chip labels. resolveActiveVerticalCtx
// must return null for banking. These tests exercise the real resolver (NOT a passed
// ctx), which is the gap that let the original regression ship green.
describe('resolveActiveVerticalCtx — live banking path (regression)', () => {
  const { resolveActiveVerticalCtx } = require('../services/nlIntentParser');
  const { verticalManifest } = require('../services/verticalManifest');

  let prevActive;
  beforeAll(() => {
    verticalManifest.init();
    prevActive = verticalManifest.resolver.activeId();
    verticalManifest.resolver.setActive('banking');
  });
  afterAll(() => {
    if (prevActive) verticalManifest.resolver.setActive(prevActive);
  });

  it('returns null for the banking vertical (selects the verbatim catalog)', () => {
    expect(resolveActiveVerticalCtx()).toBeNull();
  });

  it('live banking catalog keeps the full 10-item hand-authored list (deposit/withdraw/mortgage)', () => {
    const ctx = resolveActiveVerticalCtx();
    const msg = buildCatalogMessage(ctx);
    expect(msg).toContain('deposit');
    expect(msg).toContain('withdraw');
    expect(msg).toContain('mortgage');
    // verbatim (null ctx) === explicit-no-arg; both must equal the CAPABILITY_CATALOG render
    expect(msg).toBe(buildCatalogMessage());
  });
});

// Chip routing contract (user, 2026-05-31): a `both`-mode chip10 is the
// "always works" surface — it must resolve to a deterministic vertical/banking
// heuristic so it runs the per-vertical service (which holds the canned
// response) instead of falling through to the LLM. If a chip message ever
// parses to kind:'none', clicking it in heuristic mode would dead-end, and in
// LLM-only mode the SPA's forceHeuristic re-dispatch would have nothing to run.
// `llm`-mode chips are intentionally exempt (they target the reasoning path).
describe('chip routing contract — every `both` chip resolves to a heuristic (all verticals)', () => {
  const { resolveActiveVerticalCtx } = require('../services/nlIntentParser');
  const { verticalManifest } = require('../services/verticalManifest');
  // Phase 2 demo hardening: ALL chips10-bearing verticals, so an LLM outage
  // can never leave a `both` chip dead in any vertical. mode:'llm' and
  // mode:'direct' chips stay exempt via the bothChips filter below.
  const VERTICALS = [
    'admin', 'banking', 'government', 'healthcare', 'investment',
    'manufacturing', 'oauth-teaching', 'pingone-admin', 'retail',
    'sporting-goods', 'university', 'workforce',
  ];

  let prevActive;
  beforeAll(() => {
    verticalManifest.init();
    prevActive = verticalManifest.resolver.activeId();
  });
  afterAll(() => {
    if (prevActive) verticalManifest.resolver.setActive(prevActive);
  });

  for (const v of VERTICALS) {
    describe(v, () => {
      // Read the manifest from disk at collection time — the resolver isn't
      // init()'d until beforeAll, which runs AFTER describe bodies are evaluated.
      const manifest = require(`../config/verticals/${v}/manifest.json`);
      const chips10 = (manifest.dashboard && manifest.dashboard.chips10) || [];
      const bothChips = chips10.filter((c) => (c.mode || 'both') === 'both');

      it('has at least one `both` chip', () => {
        expect(bothChips.length).toBeGreaterThan(0);
      });

      for (const chip of bothChips) {
        it(`"${chip.label}" (${JSON.stringify(chip.message)}) routes to a vertical/banking action, not kind:'none'`, () => {
          verticalManifest.resolver.setActive(v);
          const ctx = resolveActiveVerticalCtx();
          const res = parseHeuristic(chip.message, v, ctx);
          expect(res).toBeTruthy();
          expect(res.kind).not.toBe('none');
          expect(['vertical', 'banking', 'education']).toContain(res.kind);
        });
      }
    });
  }
});

describe('progressive trust Act 1 (UC24)', () => {
  it('routes "What branches are near me?" to branch_hours without LLM', () => {
    const res = parseHeuristic('What branches are near me?');
    expect(res).toEqual({ kind: 'banking', banking: { action: 'branch_hours' } });
  });
});

// Regression: the dashboard chat's own greeting invites "ask me about OAuth,
// PKCE, MCP, or how AI agents work" in every vertical, but bare "OAuth" only
// matched the "oauth flow" phrase and there was no generic "how do AI agents
// work" pattern at all — both fell through to the vertical's no-match card
// instead of opening an education panel. Cover every vertical, not just
// banking: an airline/retail/etc. session hit this identically.
describe('education topics the greeting itself advertises', () => {
  const verticals = ['banking', 'airlines', 'retail'];

  for (const v of verticals) {
    it(`"What is OAuth?" opens the login-flow panel in ${v}`, () => {
      const res = parseHeuristic('What is OAuth?', v);
      expect(res.kind).toBe('education');
      expect(res.education?.panel).toBe('login-flow');
    });

    it(`"How do AI agents work?" opens the ai-primer panel in ${v}`, () => {
      const res = parseHeuristic('How do AI agents work?', v);
      expect(res.kind).toBe('education');
      expect(res.education?.panel).toBe('ai-primer');
    });
  }
});
