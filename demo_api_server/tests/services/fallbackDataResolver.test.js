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
