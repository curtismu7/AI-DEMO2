import {
  executeListAccountTypes,
  executeListTransactionTypes,
  executeShowSupportedCurrencies,
  executeGetFeeSchedule,
  executeListVerticals,
} from '../../../src/tools/handlers/publicTools';
import type { HandlerDeps } from '../../../src/tools/handlers/types';

const mockDeps: HandlerDeps = {
  apiClient: {} as any,
  logger: {} as any,
};

describe('Public Tool Handlers', () => {
  describe('executeListAccountTypes', () => {
    it('returns account types with success', async () => {
      const result = await executeListAccountTypes(mockDeps, 'token', {});

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.accountTypes).toBeDefined();
      expect(Array.isArray(result.structuredContent?.accountTypes)).toBe(true);
      expect(result.structuredContent?.accountTypes?.length).toBeGreaterThan(0);

      const types = result.structuredContent?.accountTypes ?? [];
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'checking', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'savings', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'loan', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'credit', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'investment', description: expect.any(String) })
      );
    });

    it('returns text representation', async () => {
      const result = await executeListAccountTypes(mockDeps, 'token', {});
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
    });
  });

  describe('executeListTransactionTypes', () => {
    it('returns transaction types with success', async () => {
      const result = await executeListTransactionTypes(mockDeps, 'token', {});

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.transactionTypes).toBeDefined();
      expect(Array.isArray(result.structuredContent?.transactionTypes)).toBe(true);
      expect(result.structuredContent?.transactionTypes?.length).toBeGreaterThan(0);

      const types = result.structuredContent?.transactionTypes ?? [];
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'deposit', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'withdrawal', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'transfer', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'payment', description: expect.any(String) })
      );
      expect(types).toContainEqual(
        expect.objectContaining({ type: 'purchase', description: expect.any(String) })
      );
    });

    it('returns text representation', async () => {
      const result = await executeListTransactionTypes(mockDeps, 'token', {});
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
    });
  });

  describe('executeShowSupportedCurrencies', () => {
    it('returns currencies with success', async () => {
      const result = await executeShowSupportedCurrencies(mockDeps, 'token', {});

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.currencies).toBeDefined();
      expect(Array.isArray(result.structuredContent?.currencies)).toBe(true);
      expect(result.structuredContent?.currencies?.length).toBeGreaterThanOrEqual(6);

      const currencies = result.structuredContent?.currencies ?? [];
      const codes = currencies.map((c: any) => c.code);
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
      expect(codes).toContain('GBP');
      expect(codes).toContain('JPY');
      expect(codes).toContain('CAD');
      expect(codes).toContain('AUD');
    });

    it('each currency has code and name', async () => {
      const result = await executeShowSupportedCurrencies(mockDeps, 'token', {});
      const currencies = result.structuredContent?.currencies ?? [];
      currencies.forEach((c: any) => {
        expect(c.code).toBeDefined();
        expect(typeof c.code).toBe('string');
        expect(c.name).toBeDefined();
        expect(typeof c.name).toBe('string');
      });
    });
  });

  describe('executeGetFeeSchedule', () => {
    it('returns all fees when no category specified', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', {});

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.fees).toBeDefined();
      expect(result.structuredContent?.fees?.checking).toBeDefined();
      expect(result.structuredContent?.fees?.savings).toBeDefined();
      expect(result.structuredContent?.fees?.transfers).toBeDefined();
      expect(result.structuredContent?.fees?.atm).toBeDefined();
    });

    it('returns checking fees when category is checking', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'checking' });

      expect(result.success).toBe(true);
      expect(result.structuredContent?.fees?.checking).toBeDefined();
      expect(Array.isArray(result.structuredContent?.fees?.checking)).toBe(true);
      expect(result.structuredContent?.fees?.checking?.length).toBeGreaterThan(0);
    });

    it('returns savings fees when category is savings', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'savings' });

      expect(result.success).toBe(true);
      expect(result.structuredContent?.fees?.savings).toBeDefined();
      expect(Array.isArray(result.structuredContent?.fees?.savings)).toBe(true);
    });

    it('returns transfers fees when category is transfers', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'transfers' });

      expect(result.success).toBe(true);
      expect(result.structuredContent?.fees?.transfers).toBeDefined();
      expect(Array.isArray(result.structuredContent?.fees?.transfers)).toBe(true);
    });

    it('returns atm fees when category is atm', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'atm' });

      expect(result.success).toBe(true);
      expect(result.structuredContent?.fees?.atm).toBeDefined();
      expect(Array.isArray(result.structuredContent?.fees?.atm)).toBe(true);
    });

    it('returns all fees when category is all', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'all' });

      expect(result.success).toBe(true);
      expect(result.structuredContent?.fees?.checking).toBeDefined();
      expect(result.structuredContent?.fees?.savings).toBeDefined();
      expect(result.structuredContent?.fees?.transfers).toBeDefined();
      expect(result.structuredContent?.fees?.atm).toBeDefined();
    });

    it('returns error for invalid category', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.text).toContain('Invalid category');
    });

    it('each fee has name, amount, and condition', async () => {
      const result = await executeGetFeeSchedule(mockDeps, 'token', { category: 'checking' });
      const fees = result.structuredContent?.fees?.checking ?? [];
      fees.forEach((f: any) => {
        expect(f.name).toBeDefined();
        expect(typeof f.name).toBe('string');
        expect(f.amount).toBeDefined();
        expect(typeof f.amount).toBe('number');
        expect(f.condition).toBeDefined();
        expect(typeof f.condition).toBe('string');
      });
    });
  });

  describe('executeListVerticals', () => {
    it('returns verticals with success', async () => {
      const result = await executeListVerticals(mockDeps, 'token', {});

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.verticals).toBeDefined();
      expect(Array.isArray(result.structuredContent?.verticals)).toBe(true);
      expect(result.structuredContent?.verticals?.length).toBeGreaterThanOrEqual(9);
    });

    it('contains expected vertical names', async () => {
      const result = await executeListVerticals(mockDeps, 'token', {});
      const verticals = result.structuredContent?.verticals ?? [];
      const names = verticals.map((v: any) => v.name);

      expect(names).toContain('banking');
      expect(names).toContain('mortgage');
      expect(names).toContain('healthcare');
      expect(names).toContain('investments');
      expect(names).toContain('retail');
      expect(names).toContain('workforce');
      expect(names).toContain('government');
      expect(names).toContain('education');
      expect(names).toContain('manufacturing');
    });

    it('each vertical has name, description, and available flag', async () => {
      const result = await executeListVerticals(mockDeps, 'token', {});
      const verticals = result.structuredContent?.verticals ?? [];
      verticals.forEach((v: any) => {
        expect(v.name).toBeDefined();
        expect(typeof v.name).toBe('string');
        expect(v.description).toBeDefined();
        expect(typeof v.description).toBe('string');
        expect(v.available).toBeDefined();
        expect(typeof v.available).toBe('boolean');
      });
    });

    it('all verticals are available', async () => {
      const result = await executeListVerticals(mockDeps, 'token', {});
      const verticals = result.structuredContent?.verticals ?? [];
      verticals.forEach((v: any) => {
        expect(v.available).toBe(true);
      });
    });
  });
});
