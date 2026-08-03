/**
 * Banking Tool Validator Tests
 */

import { BankingToolValidator } from '../../src/tools/BankingToolValidator';

describe('BankingToolValidator', () => {
  describe('validateToolParams', () => {
    describe('get_my_accounts', () => {
      it('should validate empty parameters', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', {});
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.sanitizedParams).toEqual({});
      });

      it('should reject additional properties', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', {
          extra_param: 'value'
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Additional property not allowed: extra_param');
      });

      it('should accept an allowed account_type enum value', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', {
          account_type: 'checking'
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject an account_type value outside the declared enum', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', {
          account_type: 'crypto'
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
      });
    });

    describe('get_account_balance', () => {
      it('should validate valid account_id', () => {
        const result = BankingToolValidator.validateToolParams('get_account_balance', {
          account_id: 'acc_123'
        });
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.sanitizedParams).toEqual({
          account_id: 'acc_123'
        });
      });

      it('should trim whitespace from account_id', () => {
        const result = BankingToolValidator.validateToolParams('get_account_balance', {
          account_id: '  acc_123  '
        });
        
        expect(result.isValid).toBe(true);
        expect(result.sanitizedParams).toEqual({
          account_id: 'acc_123'
        });
      });

      it('should reject missing account_id', () => {
        const result = BankingToolValidator.validateToolParams('get_account_balance', {});
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required parameter: account_id');
      });

      it('should reject empty account_id after trimming', () => {
        const result = BankingToolValidator.validateToolParams('get_account_balance', {
          account_id: '   '
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('account_id must be at least 1 characters long after trimming');
      });

      it('should reject non-string account_id', () => {
        const result = BankingToolValidator.validateToolParams('get_account_balance', {
          account_id: 123
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('account_id must be a string');
      });
    });

    describe('create_deposit', () => {
      it('should validate valid deposit parameters', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 100.50,
          description: 'Test deposit'
        });
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.sanitizedParams).toEqual({
          to_account_id: 'acc_123',
          amount: 100.50,
          description: 'Test deposit'
        });
      });

      it('should validate without optional description', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 50.25
        });
        
        expect(result.isValid).toBe(true);
        expect(result.sanitizedParams).toEqual({
          to_account_id: 'acc_123',
          amount: 50.25
        });
      });

      it('should round amount to 2 decimal places', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 100.999
        });
        
        expect(result.isValid).toBe(true);
        expect(result.sanitizedParams?.amount).toBe(101.00);
      });

      it('should reject missing required parameters', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          amount: 100
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required parameter: to_account_id');
      });

      it('should reject amount below minimum', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 0.005
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('amount must be at least 0.01');
      });

      it('should reject invalid amount type', () => {
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 'invalid'
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('amount must be a valid number');
      });

      it('should reject description that is too long', () => {
        const longDescription = 'a'.repeat(256);
        const result = BankingToolValidator.validateToolParams('create_deposit', {
          to_account_id: 'acc_123',
          amount: 100,
          description: longDescription
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('description must be at most 255 characters long');
      });
    });

    describe('create_transfer', () => {
      it('should validate valid transfer parameters', () => {
        const result = BankingToolValidator.validateToolParams('create_transfer', {
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 250.75,
          description: 'Transfer to savings'
        });
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.sanitizedParams).toEqual({
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 250.75,
          description: 'Transfer to savings'
        });
      });

      it('should reject missing required parameters', () => {
        const result = BankingToolValidator.validateToolParams('create_transfer', {
          from_account_id: 'acc_123',
          amount: 100
        });
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required parameter: to_account_id');
      });

      it('should validate without optional description', () => {
        const result = BankingToolValidator.validateToolParams('create_transfer', {
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 100.00
        });
        
        expect(result.isValid).toBe(true);
        expect(result.sanitizedParams).toEqual({
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 100.00
        });
      });
    });

    describe('unknown tool', () => {
      it('should reject unknown tool name', () => {
        const result = BankingToolValidator.validateToolParams('unknown_tool', {});
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Unknown tool: unknown_tool');
      });
    });

    describe('invalid parameter types', () => {
      it('should reject non-object parameters', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', 'invalid' as any);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Parameters must be an object');
      });

      it('should reject null parameters', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', null as any);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Parameters must be an object');
      });

      it('should reject array parameters', () => {
        const result = BankingToolValidator.validateToolParams('get_my_accounts', [] as any);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Parameters must be an object');
      });
    });
  });

  describe('validateScopes', () => {
    // Phase 210+: flat scope model — read / write / sensitive:read.
    it('should validate sufficient scopes for get_my_accounts', () => {
      const result = BankingToolValidator.validateScopes('get_my_accounts', ['read']);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate sufficient scopes for create_deposit', () => {
      const result = BankingToolValidator.validateScopes('create_deposit', ['write']);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject insufficient scopes', () => {
      const result = BankingToolValidator.validateScopes('get_my_accounts', ['write']);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required scopes: read');
    });

    it('should reject multiple missing scopes', () => {
      const result = BankingToolValidator.validateScopes('create_transfer', []);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required scopes: write');
    });

    it('should reject unknown tool for scope validation', () => {
      const result = BankingToolValidator.validateScopes('unknown_tool', ['read']);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unknown tool: unknown_tool');
    });

    it('should validate exact scope match', () => {
      const result = BankingToolValidator.validateScopes('get_my_transactions', ['read']);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle NaN amounts', () => {
      const result = BankingToolValidator.validateToolParams('create_deposit', {
        to_account_id: 'acc_123',
        amount: NaN
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('amount must be a valid number');
    });

    it('should handle Infinity amounts', () => {
      const result = BankingToolValidator.validateToolParams('create_deposit', {
        to_account_id: 'acc_123',
        amount: Infinity
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('amount must be a valid number');
    });

    it('should handle negative amounts', () => {
      const result = BankingToolValidator.validateToolParams('create_deposit', {
        to_account_id: 'acc_123',
        amount: -10.50
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('amount must be at least 0.01');
    });

    it('should handle zero amounts', () => {
      const result = BankingToolValidator.validateToolParams('create_deposit', {
        to_account_id: 'acc_123',
        amount: 0
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('amount must be at least 0.01');
    });
  });
});