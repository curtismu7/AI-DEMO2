const fallbackDataResolver = require('../../services/fallbackDataResolver');
const fallbackChipsLoader = require('../../config/fallback-chips/loader');
const nlIntentParser = require('../../services/nlIntentParser');

/** Tools that only exist in the banking vertical — a leak canary. */
const BANKING_ONLY_TOOLS = ['create_transfer', 'get_my_accounts'];
const leaksBanking = (chips = []) =>
  chips.some((c) => BANKING_ONLY_TOOLS.includes(c.tool));

describe('fallbackDataResolver', () => {
  describe('resolveFallbackChips', () => {
    it('should detect banking intent from prompt and return banking fallback chips', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'transfer $100',
        { verticalId: 'undefined', userPrompt: 'transfer $100' }
      );
      expect(result.verticalId).toBe('banking');
      expect(result.chips).toBeDefined();
      expect(result.chips.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.chips.some(c => c.tool === 'create_transfer')).toBe(true);
    });

    it('should detect retail intent and return retail fallback chips', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'show my orders',
        { verticalId: undefined }
      );
      expect(result.verticalId).toBe('retail');
      expect(result.chips.some(c => c.message.toLowerCase().includes('order'))).toBe(true);
    });

    it('should detect sporting goods intent from prompt', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'redeem my points',
        { verticalId: undefined }
      );
      expect(result.verticalId).toBe('sporting-goods');
      expect(result.chips.some(c => c.message.toLowerCase().includes('redeem') || c.message.toLowerCase().includes('point'))).toBe(true);
    });

    // --- no silent banking fallback -------------------------------------

    it('never returns banking chips for an unmatched healthcare prompt', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: 'healthcare' }
      );
      expect(result.verticalId).toBe('healthcare');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    it('never returns banking chips for an unmatched investment prompt', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: 'investment' }
      );
      expect(result.verticalId).toBe('investment');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    // Protocol-education prompts ("what is PAR", "explain step-up") are
    // vertical-agnostic teaching, not banking data. They must never drag the
    // active vertical over to banking.
    it('never returns banking chips for a protocol-education prompt in healthcare', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'explain sensitive data',
        { verticalId: 'healthcare' }
      );
      expect(result.verticalId).toBe('healthcare');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    it('never returns banking chips for a protocol-education prompt in investment', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'explain pkce',
        { verticalId: 'investment' }
      );
      expect(result.verticalId).toBe('investment');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    it('returns a structured no-match for a protocol-education prompt when no vertical is active', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'explain token exchange',
        { verticalId: undefined }
      );
      expect(result.verticalId).not.toBe('banking');
      expect(result.noMatch).toBe(true);
      expect(result.chips).toEqual([]);
    });

    it('still serves banking chips for a protocol-education prompt inside banking', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'explain token exchange',
        { verticalId: 'banking' }
      );
      expect(result.verticalId).toBe('banking');
      expect(result.noMatch).toBeUndefined();
      expect(result.chips.some((c) => c.tool === 'create_transfer')).toBe(true);
    });

    it('returns a structured no-match instead of banking when no vertical is active', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: undefined }
      );
      expect(result.verticalId).not.toBe('banking');
      expect(result.noMatch).toBe(true);
      expect(result.chips).toEqual([]);
      expect(typeof result.intentsConsidered).toBe('number');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });

    // --- web_search is vertical-agnostic, never a banking claim -----------
    //
    // parseBanking's trailing catch-all turns any unexcluded "what is X" /
    // "who is X" / "tell me about X" phrasing into a web_search action. The
    // action dispatches brave_search and appears in no vertical manifest, so
    // it belongs to no vertical. Tagging it 'banking' pulled account and
    // transfer chips into every other vertical.

    const WEB_SEARCH_PROMPTS = [
      'what is step-up mfa',
      'what is par',
      'who is the ceo of acme',
      'tell me about widgets',
    ];

    it('does not tag a web_search intent with the banking vertical', () => {
      for (const prompt of WEB_SEARCH_PROMPTS) {
        const intent = nlIntentParser.parseForFallback(prompt, {
          verticalId: 'investment',
        });
        expect(intent.banking && intent.banking.action).toBe('web_search');
        expect(intent.vertical).toBeUndefined();
      }
    });

    it.each(WEB_SEARCH_PROMPTS)(
      'keeps the active investment vertical for the web_search prompt %j',
      async (prompt) => {
        const result = await fallbackDataResolver.resolveFallbackChips(prompt, {
          verticalId: 'investment',
        });
        expect(result.verticalId).toBe('investment');
        expect(leaksBanking(result.chips)).toBe(false);
        expect(leaksBanking(result.suggestions || [])).toBe(false);
      }
    );

    it('keeps the active healthcare vertical for a web_search prompt', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'what is step-up mfa',
        { verticalId: 'healthcare' }
      );
      expect(result.verticalId).toBe('healthcare');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    it('keeps the active government vertical for a web_search prompt', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'what is par',
        { verticalId: 'government' }
      );
      expect(result.verticalId).toBe('government');
      expect(leaksBanking(result.chips)).toBe(false);
      expect(leaksBanking(result.suggestions || [])).toBe(false);
    });

    it('returns a structured no-match for a web_search prompt with no active vertical', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'what is step-up mfa',
        { verticalId: undefined }
      );
      expect(result.verticalId).not.toBe('banking');
      expect(result.noMatch).toBe(true);
      expect(result.chips).toEqual([]);
    });

    it('still serves banking chips for a web_search prompt inside banking', async () => {
      for (const prompt of WEB_SEARCH_PROMPTS) {
        const intent = nlIntentParser.parseForFallback(prompt, {
          verticalId: 'banking',
        });
        // The intent itself survives — only the vertical claim is dropped.
        expect(intent.kind).toBe('banking');
        expect(intent.banking.action).toBe('web_search');
        expect(intent.banking.query).toBeTruthy();

        const result = await fallbackDataResolver.resolveFallbackChips(prompt, {
          verticalId: 'banking',
        });
        expect(result.verticalId).toBe('banking');
        expect(result.noMatch).toBeUndefined();
        expect(result.chips.some((c) => c.tool === 'create_transfer')).toBe(true);
      }
    });

    it('still claims the banking vertical for real banking actions', async () => {
      // Guard the fix's blast radius: only web_search loses the tag.
      const intent = nlIntentParser.parseForFallback('transfer $100', {
        verticalId: 'undefined',
      });
      expect(intent.vertical).toBe('banking');
    });

    // --- the cascade must not outrank the active vertical -----------------
    //
    // parseForFallback consults the active vertical LAST, after parseBanking,
    // parseEducation and six literal-vertical keyword branches, so whichever
    // branch matched first won. Two distinct classes of theft came out of that,
    // and each needs its own guard.

    /*
     * Class 1 — actions that live inside parseBanking but are cross-vertical BY
     * THEIR OWN DEFINITION, exactly like the web_search catch-all above.
     * UNUSUAL_PATTERNS_RE's comment says the sec_llm_analyze chip "ships this
     * exact text in EVERY vertical manifest" (9 manifests), INVEST_FEATURE_RE is
     * labelled "Cross-vertical invest / portfolio chip", VERTICAL_FEATURE_RE
     * exists so "NL phrases for non-banking verticals also map to
     * vertical_feature_demo", and the MCP-tools phrasing ships in 10 manifests.
     * None reads banking data; each dispatches the ACTIVE vertical's feature or
     * tool. So none may carry a banking claim.
     */
    const CROSS_VERTICAL_ACTIONS = [
      ['spot any unusual activity', 'unusual_patterns'],
      ['any suspicious charges', 'unusual_patterns'],
      ['show my health record', 'vertical_feature_demo'],
      ['show permit status', 'vertical_feature_demo'],
      ['show portfolio status', 'invest_demo'],
      ['Show me the tools available from the PingOne MCP server', 'mcp_tools'],
    ];

    it.each(CROSS_VERTICAL_ACTIONS)(
      'does not tag the cross-vertical %j intent with the banking vertical',
      (prompt, action) => {
        const intent = nlIntentParser.parseForFallback(prompt, {
          verticalId: 'healthcare',
        });
        // The intent itself survives — only the vertical claim is dropped.
        expect(intent.banking && intent.banking.action).toBe(action);
        expect(intent.vertical).toBeUndefined();
      }
    );

    it.each(CROSS_VERTICAL_ACTIONS)(
      'keeps the active government vertical for the cross-vertical prompt %j',
      async (prompt) => {
        const result = await fallbackDataResolver.resolveFallbackChips(prompt, {
          verticalId: 'government',
        });
        expect(result.verticalId).toBe('government');
        expect(leaksBanking(result.chips)).toBe(false);
        expect(leaksBanking(result.suggestions || [])).toBe(false);
      }
    );

    /*
     * Class 2 — the literal-vertical keyword sweep. Those branches GUESS a
     * vertical from bare nouns, and a guess must never overrule a vertical the
     * user is demonstrably already in: retail's \borders?\b took manufacturing's
     * own "show my work orders" while manufacturing was the active vertical.
     */
    const KEYWORD_SWEEP_THEFTS = [
      ['show my work orders', 'manufacturing'],
      ['which work orders are overdue', 'manufacturing'],
      ['check for irregular orders', 'healthcare'],
      ['my reward points', 'retail'],
      ['schedule a production run', 'manufacturing'],
      ['register for a course', 'workforce'],
    ];

    it.each(KEYWORD_SWEEP_THEFTS)(
      'keeps the active vertical for %j typed in %s',
      async (prompt, vertical) => {
        const intent = nlIntentParser.parseForFallback(prompt, {
          verticalId: vertical,
        });
        expect(intent.vertical).toBe(vertical);

        const result = await fallbackDataResolver.resolveFallbackChips(prompt, {
          verticalId: vertical,
        });
        expect(result.verticalId).toBe(vertical);
        expect(leaksBanking(result.chips)).toBe(false);
      }
    );

    /*
     * The sweep is not deleted, only demoted. With NO active vertical there is
     * nothing to outrank and guessing is the only thing it can usefully do, so
     * it must still guess — otherwise the demotion would silently turn every
     * context-free prompt into a no-match.
     */
    it('still guesses a vertical from keywords when none is active', async () => {
      const cases = [
        ['show my work orders', 'retail'],
        ['my reward points', 'sporting-goods'],
        ['register for a course', 'university'],
        ['request time off', 'workforce'],
      ];
      for (const [prompt, expected] of cases) {
        const intent = nlIntentParser.parseForFallback(prompt, {
          verticalId: undefined,
        });
        expect(intent.vertical).toBe(expected);
      }
    });

    /*
     * A branch whose vertical IS the active one still reports its own kind
     * rather than degrading to 'unknown' — the demotion changes which branch may
     * win, not what a legitimate win looks like.
     */
    it('lets the active vertical own keyword branch confirm it', () => {
      const intent = nlIntentParser.parseForFallback('track my order', {
        verticalId: 'retail',
      });
      expect(intent).toEqual({ kind: 'retail', vertical: 'retail' });
    });

    it('returns a no-match with the active vertical own suggestions for a vertical with no fallback chip file', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: 'oauth-teaching' }
      );
      expect(result.noMatch).toBe(true);
      expect(result.verticalId).toBe('oauth-teaching');
      expect(result.chips).toEqual([]);
      expect(leaksBanking(result.suggestions)).toBe(false);
      // 12 intents live in oauth-teaching chips10; all were considered.
      const oauthManifest = require('../../config/verticals/oauth-teaching/manifest.json');
      expect(result.intentsConsidered).toBe(oauthManifest.dashboard.chips10.length);
    });

    it('draws no-match suggestions from the active vertical own chips10', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: 'admin' }
      );
      expect(result.noMatch).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      const manifest = require('../../config/verticals/admin/manifest.json');
      const chips10 = (manifest.dashboard && manifest.dashboard.chips10) || [];
      const allowed = new Set(chips10.map((c) => c.message));
      for (const s of result.suggestions) {
        expect(allowed.has(s.message)).toBe(true);
      }
    });

    it('does not fake a closest-candidate score the parser cannot produce', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: 'oauth-teaching' }
      );
      // parseForFallback is a regex cascade with no scoring, so the field is
      // omitted rather than invented.
      expect(result).not.toHaveProperty('closestCandidate');
    });

    it('returns a no-match instead of banking when intent parsing throws', async () => {
      const spy = jest
        .spyOn(nlIntentParser, 'parseForFallback')
        .mockImplementation(() => {
          throw new Error('boom');
        });
      try {
        const result = await fallbackDataResolver.resolveFallbackChips(
          'transfer $100',
          { verticalId: 'healthcare' }
        );
        expect(result.noMatch).toBe(true);
        expect(result.verticalId).toBe('healthcare');
        expect(result.chips).toEqual([]);
        expect(leaksBanking(result.suggestions || [])).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('loadFallbackChips', () => {
    it('returns null for an unknown vertical instead of banking chips', async () => {
      const chips = await fallbackChipsLoader.loadFallbackChips('not-a-vertical');
      expect(chips).toBeNull();
    });

    it('returns null when no vertical id is supplied', async () => {
      const chips = await fallbackChipsLoader.loadFallbackChips();
      expect(chips).toBeNull();
    });

    it('has a fallback chip file for healthcare using healthcare tools', async () => {
      const chips = await fallbackChipsLoader.loadFallbackChips('healthcare');
      expect(Array.isArray(chips)).toBe(true);
      expect(chips.length).toBeGreaterThan(0);
      expect(leaksBanking(chips)).toBe(false);

      const manifest = require('../../config/verticals/healthcare/manifest.json');
      const realTools = new Set(
        (manifest.dashboard.chips10 || []).map((c) => c.tool).filter(Boolean)
      );
      for (const chip of chips) {
        if (chip.tool) expect(realTools.has(chip.tool)).toBe(true);
      }
    });

    it('has a fallback chip file for investment using investment tools', async () => {
      const chips = await fallbackChipsLoader.loadFallbackChips('investment');
      expect(Array.isArray(chips)).toBe(true);
      expect(chips.length).toBeGreaterThan(0);
      expect(leaksBanking(chips)).toBe(false);

      const manifest = require('../../config/verticals/investment/manifest.json');
      const realTools = new Set(
        (manifest.dashboard.chips10 || []).map((c) => c.tool).filter(Boolean)
      );
      for (const chip of chips) {
        if (chip.tool) expect(realTools.has(chip.tool)).toBe(true);
      }
    });
  });
});
