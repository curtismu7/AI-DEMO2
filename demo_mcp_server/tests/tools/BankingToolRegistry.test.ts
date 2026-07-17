/**
 * Banking Tool Registry Tests
 */

import { BankingToolRegistry } from '../../src/tools/BankingToolRegistry';

describe('BankingToolRegistry', () => {
  const EXPECTED_TOOL_NAMES = [
    'get_my_accounts',
    'get_account_balance',
    'get_sensitive_account_details',
    'get_my_transactions',
    'create_deposit',
    'create_withdrawal',
    'create_transfer',
    'update_contact_email',
    'request_fee_waiver',
    'query_user_by_email',
    'lookup_customer',
    'get_customer_profile',
    'get_customer_accounts',
    'get_customer_transactions',
    'freeze_account',
    'reset_customer_password',
    'adjust_balance',
    'delete_customer',
    'get_branch_hours',
    'sequential_think',
    'list_account_types',
    'list_transaction_types',
    'show_supported_currencies',
    'get_fee_schedule',
    'list_verticals',
    'show_mortgage',
    'show_health_record',
    'show_investment',
    'show_gear_order',
    'show_expense_report',
    'show_permit',
    'show_enrollment',
    'show_large_purchase',
    // Vertical action tools (sporting-goods, healthcare, workforce, retail)
    'gear_order_status',
    'list_gear',
    'checkout',
    'loyalty_balance',
    'rewards_balance',
    'order_status',
    'list_orders',
    'view_records',
    'release_records',
    'list_appointments',
    'book_appointment',
    'view_coverage',
    'view_benefits',
    'pto_balance',
    'request_time_off',
    'list_expenses',
    'submit_expense',
    'extend_rental',
    'list_rentals',
    'sensitive_order_history',
    'sensitive_membership_details',
    'sensitive_payroll_details',
    'sensitive_patient_records',
    'code_search',
    'get_code',
    'list_codebases',
  ];

  describe('getAllTools', () => {
    it('should return all current banking tools', () => {
      const tools = BankingToolRegistry.getAllTools();
      const names = tools.map((t) => t.name);

      // Check that all expected tools are present
      EXPECTED_TOOL_NAMES.forEach((name) => {
        expect(names).toContain(name);
      });
    });

    it('should return tools with required metadata fields', () => {
      const tools = BankingToolRegistry.getAllTools();

      tools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('title');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('requiresUserAuth');
        expect(tool).toHaveProperty('requiredScopes');
        expect(tool).toHaveProperty('handler');
        expect(tool).toHaveProperty('readOnly');
        expect(tool).toHaveProperty('icons');
        expect(tool).toHaveProperty('annotations');

        expect(typeof tool.name).toBe('string');
        expect(typeof tool.title).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
        expect(typeof tool.requiresUserAuth).toBe('boolean');
        expect(Array.isArray(tool.requiredScopes)).toBe(true);
        expect(typeof tool.handler).toBe('string');
        expect(typeof tool.readOnly).toBe('boolean');
      });
    });
  });

  describe('getTool', () => {
    it('should return tool definition for valid tool name', () => {
      const tool = BankingToolRegistry.getTool('get_my_accounts');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_my_accounts');
      expect(tool?.title).toBe('My Bank Accounts');
      expect(tool?.requiresUserAuth).toBe(true);
      expect(tool?.requiredScopes).toEqual(['read']);
      expect(tool?.handler).toBe('executeGetMyAccounts');
      expect(tool?.readOnly).toBe(true);
    });

    it('should return undefined for invalid tool name', () => {
      const tool = BankingToolRegistry.getTool('invalid_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getToolNames and hasTool', () => {
    it('should return all tool names', () => {
      const names = BankingToolRegistry.getToolNames();
      // Check that all expected tools are present
      EXPECTED_TOOL_NAMES.forEach((name) => {
        expect(names).toContain(name);
      });
    });

    it('should report existence accurately', () => {
      expect(BankingToolRegistry.hasTool('get_my_accounts')).toBe(true);
      expect(BankingToolRegistry.hasTool('create_transfer')).toBe(true);
      expect(BankingToolRegistry.hasTool('sequential_think')).toBe(true);
      expect(BankingToolRegistry.hasTool('invalid_tool')).toBe(false);
    });
  });

  describe('scope and safety helpers', () => {
    it('should return read tools with read scope', () => {
      // Phase 210+: scope model is flat (read / write / sensitive:read).
      const tools = BankingToolRegistry.getToolsByScope('read');
      const names = tools.map((t) => t.name);

      expect(names).toEqual(
        expect.arrayContaining(['get_my_accounts', 'get_account_balance', 'get_my_transactions'])
      );
    });

    it('should return write tools with write scope', () => {
      const tools = BankingToolRegistry.getToolsByScope('write');
      const names = tools.map((t) => t.name);

      expect(names).toEqual(
        expect.arrayContaining(['create_deposit', 'create_withdrawal', 'create_transfer'])
      );
    });

    it('should return read-only tools', () => {
      const tools = BankingToolRegistry.getReadOnlyTools();
      expect(tools.length).toBeGreaterThan(0);
      tools.forEach((tool) => expect(tool.readOnly).toBe(true));
      expect(tools.map((t) => t.name)).toContain('sequential_think');
    });

    it('should return authenticated/write tools helper set', () => {
      const tools = BankingToolRegistry.getAuthenticatedTools();
      expect(tools.length).toBeGreaterThan(0);
      tools.forEach((tool) => expect(tool.readOnly).toBe(false));
      expect(tools.map((t) => t.name)).toContain('create_transfer');
    });
  });

  describe('getMCPToolDefinitions', () => {
    it('should return MCP-compatible tool definitions without handler property', () => {
      const mcpTools = BankingToolRegistry.getMCPToolDefinitions();

      // Verify it returns a reasonable number of tools
      expect(mcpTools.length).toBeGreaterThan(EXPECTED_TOOL_NAMES.length);

      mcpTools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('title');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('icons');
        expect(tool).toHaveProperty('annotations');
        expect(tool).toHaveProperty('requiresUserAuth');
        expect(tool).toHaveProperty('requiredScopes');

        expect(tool).not.toHaveProperty('handler');
      });
    });
  });

  describe('Tool schema validation', () => {
    it('should have valid object schemas for all tools', () => {
      const tools = BankingToolRegistry.getAllTools();

      tools.forEach((tool) => {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema).toHaveProperty('properties');
        expect(tool.inputSchema).toHaveProperty('required');
        expect(tool.inputSchema.additionalProperties).toBe(false);
      });
    });

    it('should require query for sequential_think', () => {
      const tool = BankingToolRegistry.getTool('sequential_think');
      expect(tool?.inputSchema.required).toEqual(['query']);
      expect(tool?.inputSchema.properties?.query?.type).toBe('string');
    });

    it('should require read scope for sensitive account details', () => {
      const tool = BankingToolRegistry.getTool('get_sensitive_account_details');
      // After scope rename: sensitive:read was removed; tool uses only 'read' scope.
      // Sensitive access is gated by PingAuthorize policy, not scope enforcement.
      expect(tool?.requiredScopes).toEqual(['read']);
      expect(tool?.requiresUserAuth).toBe(true);
    });

    // Regression: parameterized vertical tools must advertise their real params.
    // A default empty schema ({ properties:{}, additionalProperties:false }) makes
    // the provider reject every argument ("Additional property not allowed"), so
    // the tool runs with no args and returns an empty result (the "{}" card bug).
    it('parameterized vertical tools declare their params (not the empty default)', () => {
      const expected: Record<string, string[]> = {
        book_appointment: ['provider', 'when'],
        release_records: ['recordId'],
        checkout: ['product', 'amount'],
        order_status: ['orderId'],
        submit_expense: ['category', 'amount'],
        request_time_off: ['days'],
        gear_order_status: ['orderId'],
        extend_rental: ['rentalId'],
      };
      for (const [name, required] of Object.entries(expected)) {
        const tool = BankingToolRegistry.getTool(name);
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toEqual(required);
        for (const key of required) {
          expect(tool?.inputSchema.properties?.[key]).toBeDefined();
        }
      }
    });
  });

  describe('Public (no-auth) tools', () => {
    it('list_account_types should have no auth requirements', () => {
      const tool = BankingToolRegistry.getTool('list_account_types');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_account_types');
      expect(tool?.title).toBe('Account Types');
      expect(tool?.requiresUserAuth).toBe(false);
      expect(tool?.requiredScopes).toEqual([]);
      expect(tool?.handler).toBe('executeListAccountTypes');
      expect(tool?.readOnly).toBe(true);
    });

    it('list_transaction_types should have no auth requirements', () => {
      const tool = BankingToolRegistry.getTool('list_transaction_types');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_transaction_types');
      expect(tool?.title).toBe('Transaction Types');
      expect(tool?.requiresUserAuth).toBe(false);
      expect(tool?.requiredScopes).toEqual([]);
      expect(tool?.handler).toBe('executeListTransactionTypes');
      expect(tool?.readOnly).toBe(true);
    });

    it('show_supported_currencies should have no auth requirements', () => {
      const tool = BankingToolRegistry.getTool('show_supported_currencies');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('show_supported_currencies');
      expect(tool?.title).toBe('Supported Currencies');
      expect(tool?.requiresUserAuth).toBe(false);
      expect(tool?.requiredScopes).toEqual([]);
      expect(tool?.handler).toBe('executeShowSupportedCurrencies');
      expect(tool?.readOnly).toBe(true);
    });

    it('get_fee_schedule should have no auth requirements', () => {
      const tool = BankingToolRegistry.getTool('get_fee_schedule');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_fee_schedule');
      expect(tool?.title).toBe('Fee Schedule');
      expect(tool?.requiresUserAuth).toBe(false);
      expect(tool?.requiredScopes).toEqual([]);
      expect(tool?.handler).toBe('executeGetFeeSchedule');
      expect(tool?.readOnly).toBe(true);
      // Verify it has an optional category parameter
      expect(tool?.inputSchema.properties?.category).toBeDefined();
      expect(tool?.inputSchema.required).toEqual([]);
    });

    it('list_verticals should have no auth requirements', () => {
      const tool = BankingToolRegistry.getTool('list_verticals');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_verticals');
      expect(tool?.title).toBe('Available Verticals');
      expect(tool?.requiresUserAuth).toBe(false);
      expect(tool?.requiredScopes).toEqual([]);
      expect(tool?.handler).toBe('executeListVerticals');
      expect(tool?.readOnly).toBe(true);
    });

    it('all 5 new public tools should pass the public tool criteria', () => {
      const publicToolNames = [
        'list_account_types',
        'list_transaction_types',
        'show_supported_currencies',
        'get_fee_schedule',
        'list_verticals',
      ];

      publicToolNames.forEach((name) => {
        const tool = BankingToolRegistry.getTool(name);
        expect(tool).toBeDefined();
        expect(tool?.requiresUserAuth).toBe(false);
        expect(tool?.requiredScopes).toEqual([]);
        expect(tool?.readOnly).toBe(true);
      });
    });
  });
});
