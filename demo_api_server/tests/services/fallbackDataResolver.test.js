const fallbackDataResolver = require('../../services/fallbackDataResolver');

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

    it('should return banking as default when intent cannot be determined', async () => {
      const result = await fallbackDataResolver.resolveFallbackChips(
        'hello world',
        { verticalId: undefined }
      );
      expect(result.verticalId).toBe('banking');
      expect(result.isFallback).toBe(true);
    });
  });
});
