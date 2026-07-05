/**
 * Banking Tool Registry
 * Defines all available banking tools and their schemas for MCP protocol
 */

import { ToolDefinition, JSONSchema } from '../interfaces/mcp';
import { VERTICAL_TOOLS, verticalHandlerName } from './handlers/verticalHandlers';
import {
  GET_MY_ACCOUNTS_OUTPUT,
  GET_ACCOUNT_BALANCE_OUTPUT,
  GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT,
  GET_MY_TRANSACTIONS_OUTPUT,
  WRITE_TRANSACTION_OUTPUT,
  QUERY_USER_BY_EMAIL_OUTPUT,
  REQUEST_FEE_WAIVER_OUTPUT,
  SEQUENTIAL_THINK_OUTPUT,
  ADMIN_LOOKUP_OUTPUT,
  ADMIN_PROFILE_OUTPUT,
  ADMIN_ACCOUNTS_OUTPUT,
  ADMIN_TRANSACTIONS_OUTPUT,
  ADMIN_WRITE_OUTPUT,
  SHOW_VERTICAL_OUTPUT,
  SEARCH_TRANSACTIONS_OUTPUT,
  GET_TRANSACTION_DETAIL_OUTPUT,
} from './outputSchemas';

export interface BankingToolDefinition extends ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  requiresUserAuth: boolean;
  requiredScopes: string[];
  handler: string; // Method name in BankingToolProvider
  readOnly: boolean; // true = safe read-only; false = writes data or accesses PII
  vertical?: string; // set for vertical action tools (incl. 'admin') — lets the gateway filter tools/list per active vertical (AllowedVertical advice). Absent = cross-vertical (banking/feature).
  outputSchema?: JSONSchema;
}

/**
 * Vertical action tools (workforce/healthcare/retail/sporting-goods), generated
 * from the single VERTICAL_TOOLS list. Unlike the show_* feature tools (api_key
 * disposition), these use the DELEGATED bearer: the gateway proxies the agent
 * token and the BFF executes the active vertical's tool via /api/path/vertical-tool.
 * Coarse read/write scopes — PingAuthorize makes the fine-grained decision, and
 * the AllowedVertical advice filters tools/list per vertical.
 * See docs/specs/SPEC-vertical-tools-through-mcp.md.
 */
const VERTICAL_TOOL_DEFS: Record<string, BankingToolDefinition> = VERTICAL_TOOLS.reduce(
  (acc, t) => {
    acc[t.name] = {
      name: t.name,
      title: t.name.replace(/_/g, ' '),
      description: `${t.vertical} vertical action "${t.name}". Routes through the full delegated MCP pipeline: RFC 8693 token exchange, MCP gateway, PingAuthorize, then the BFF vertical-tool executor.`,
      requiresUserAuth: true,
      requiredScopes: [t.scope],
      handler: verticalHandlerName(t.name),
      readOnly: t.scope === 'read',
      vertical: t.vertical,
      icons: [],
      annotations: { userFacing: { readable: t.scope === 'read', destructive: t.scope === 'write', idempotent: t.scope === 'read', openWorld: false } },
      // Parameterized tools (book_appointment, checkout, order_status, ...) carry
      // their real schema in VERTICAL_TOOLS; no-arg read tools default to the
      // empty schema. Without the real schema the provider rejects every arg.
      inputSchema: t.inputSchema || { type: 'object', properties: {}, required: [], additionalProperties: false },
      outputSchema: SHOW_VERTICAL_OUTPUT,
    } as BankingToolDefinition;
    return acc;
  },
  {} as Record<string, BankingToolDefinition>,
);

/**
 * Registry of all banking tools available through the MCP server
 */
export class BankingToolRegistry {
  private static readonly TOOLS: Record<string, BankingToolDefinition> = {
    get_my_accounts: {
      name: 'get_my_accounts',
      title: 'My Bank Accounts',
      description: 'Retrieve the user\'s bank accounts with full account details including account type, name, masked account number, balance, currency, holder name, SWIFT/BIC code, IBAN, branch, and opening date. Use this for any request about account information, account details, or account overview. When the user asks about a specific account type (e.g. "my checking", "savings account", "car loan"), pass account_type to filter the results.',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeGetMyAccounts',
      readOnly: true,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 1C6.48 1 2 5.48 2 11s4.48 10 10 10 10-4.48 10-10S17.52 1 12 1zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 7 15.5 7 14 7.67 14 8.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 7 8.5 7 7 7.67 7 8.5 7.67 10 8.5 10zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: false
        }
      },
      outputSchema: GET_MY_ACCOUNTS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          account_type: {
            type: 'string',
            enum: ['checking', 'savings', 'loan', 'credit', 'investment'],
            description: 'Optional filter — only return accounts of this type. Omit to return all accounts.'
          }
        },
        required: [],
        additionalProperties: false
      }
    },

    get_account_balance: {
      name: 'get_account_balance',
      title: 'Account Balance',
      description: 'Get balance for a specific account. Use account ID (not account number) from get_my_accounts response.',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeGetAccountBalance',
      readOnly: true,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: false
        }
      },
      outputSchema: GET_ACCOUNT_BALANCE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          account_id: {
            type: 'string',
            description: 'Account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
            minLength: 1
          }
        },
        required: ['account_id'],
        additionalProperties: false
      }
    },


    get_sensitive_account_details: {
      name: 'get_sensitive_account_details',
      title: 'Account Details (Sensitive)',
      description: 'Retrieve sensitive account details (full account number and routing number). Requires sensitive:read scope and user consent — the UI will prompt the user to approve access before this data is released.',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeGetSensitiveAccountDetails',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22cc0000%22 d=%22M12 1C6.48 1 2 5.48 2 11s4.48 10 10 10 10-4.48 10-10S17.52 1 12 1zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 7 15.5 7 14 7.67 14 8.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 7 8.5 7 7 7.67 7 8.5 7.67 10 8.5 10zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: false
        }
      },
      outputSchema: GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    },

    get_my_transactions: {
      name: 'get_my_transactions',
      title: 'Transaction History',
      description: 'Retrieve user\'s transaction history',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeGetMyTransactions',
      readOnly: true,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-2.08-2.08-2.41 2.41L12 18l5.02-7.44-1.06-.27z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: false
        }
      },
      outputSchema: GET_MY_TRANSACTIONS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of transactions to return per page (default: all)',
            minimum: 1,
          },
          offset: {
            type: 'integer',
            description: 'Number of transactions to skip (for pagination). Use nextOffset from prior response.',
            minimum: 0,
            default: 0,
          },
        },
        required: [],
        additionalProperties: false,
      }
    },

    search_transactions: {
      name: 'search_transactions',
      title: 'Search Transactions',
      description: 'Search and filter the user\'s transactions by type, amount range, or date range. All filters are optional and combinable. Returns matching transactions sorted by date descending.',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeSearchTransactions',
      readOnly: true,
      icons: [],
      annotations: {
        userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false }
      },
      outputSchema: SEARCH_TRANSACTIONS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['deposit', 'withdrawal', 'transfer'],
            description: 'Filter by transaction type',
          },
          min_amount: {
            type: 'number',
            description: 'Minimum transaction amount (inclusive)',
            minimum: 0,
          },
          max_amount: {
            type: 'number',
            description: 'Maximum transaction amount (inclusive)',
            minimum: 0,
          },
          from_date: {
            type: 'string',
            description: 'Earliest date (ISO 8601, e.g. "2025-01-01"). Matches on createdAt string prefix.',
          },
          to_date: {
            type: 'string',
            description: 'Latest date (ISO 8601, e.g. "2025-12-31"). Matches on createdAt string prefix.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },

    get_transaction_detail: {
      name: 'get_transaction_detail',
      title: 'Transaction Detail',
      description: 'Fetch a single transaction by ID. Returns full transaction details or found:false if the ID does not exist.',
      requiresUserAuth: true,
      requiredScopes: ['read'],
      handler: 'executeGetTransactionDetail',
      readOnly: true,
      icons: [],
      annotations: {
        userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false }
      },
      outputSchema: GET_TRANSACTION_DETAIL_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          transaction_id: {
            type: 'string',
            description: 'The transaction ID to look up (from get_my_transactions or search_transactions response)',
          },
        },
        required: ['transaction_id'],
        additionalProperties: false,
      },
    },

    create_deposit: {
      name: 'create_deposit',
      title: 'Create Deposit',
      description: 'Create a deposit transaction to an account. Use account ID (not account number) from get_my_accounts response. Amounts over $250 require human consent on the web dashboard first (returns hitl_required if attempted without it).',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeCreateDeposit',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22ff9900%22 d=%22M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: false,
          destructive: false,
          idempotent: false,
          openWorld: false
        }
      },
      inputSchema: {
        type: 'object',
        properties: {
          to_account_id: {
            type: 'string',
            description: 'Account ID (UUID format, not account number) to deposit to - use the "id" field from get_my_accounts response',
            minLength: 1
          },
          amount: {
            type: 'number',
            description: 'Amount to deposit',
            minimum: 0.01,
            multipleOf: 0.01
          },
          description: {
            type: 'string',
            description: 'Transaction description',
            maxLength: 255
          }
        },
        required: ['to_account_id', 'amount'],
        additionalProperties: false
      },
      outputSchema: WRITE_TRANSACTION_OUTPUT,
    },

    create_withdrawal: {
      name: 'create_withdrawal',
      title: 'Create Withdrawal',
      description: 'Create a withdrawal transaction from an account. Use account ID (not account number) from get_my_accounts response. Amounts over $250 require human consent on the web dashboard first (returns hitl_required if attempted without it).',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeCreateWithdrawal',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22ff9900%22 d=%22M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: false,
          destructive: true,
          idempotent: false,
          openWorld: false
        }
      },
      inputSchema: {
        type: 'object',
        properties: {
          from_account_id: {
            type: 'string',
            description: 'Account ID (UUID format, not account number) to withdraw from - use the "id" field from get_my_accounts response',
            minLength: 1
          },
          amount: {
            type: 'number',
            description: 'Amount to withdraw',
            minimum: 0.01,
            multipleOf: 0.01
          },
          description: {
            type: 'string',
            description: 'Transaction description',
            maxLength: 255
          }
        },
        required: ['from_account_id', 'amount'],
        additionalProperties: false
      },
      outputSchema: WRITE_TRANSACTION_OUTPUT,
    },

    create_transfer: {
      name: 'create_transfer',
      title: 'Transfer Money',
      description: 'Transfer money between accounts. Use account IDs (not account numbers) from get_my_accounts response. Amounts over $250 require human consent on the web dashboard first (returns hitl_required if attempted without it).',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeCreateTransfer',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22ff9900%22 d=%22M16 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-11h-1V5c0-.55-.45-1-1-1zm0 11l-4 4v-3H5v-2h7v-3l4 4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: false,
          destructive: true,
          idempotent: false,
          openWorld: false
        }
      },
      inputSchema: {
        type: 'object',
        properties: {
          from_account_id: {
            type: 'string',
            description: 'Source account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
            minLength: 1
          },
          to_account_id: {
            type: 'string',
            description: 'Destination account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
            minLength: 1
          },
          amount: {
            type: 'number',
            description: 'Amount to transfer (minimum $0.01)',
            minimum: 0.01,
            multipleOf: 0.01
          },
          description: {
            type: 'string',
            description: 'Transfer description',
            maxLength: 255
          }
        },
        required: ['from_account_id', 'to_account_id', 'amount'],
        additionalProperties: false
      },
      outputSchema: WRITE_TRANSACTION_OUTPUT,
    },

    update_contact_email: {
      name: 'update_contact_email',
      title: 'Update Contact Email',
      description: 'Update the contact email address on a bank account. The account must belong to the authenticated user — changing another user\'s email is not permitted.',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeUpdateContactEmail',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_WRITE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          account_id: {
            type: 'string',
            description: 'The account ID whose contact email to update'
          },
          new_email: {
            type: 'string',
            description: 'New email address',
            format: 'email'
          }
        },
        required: ['account_id', 'new_email'],
        additionalProperties: false
      }
    },

    request_fee_waiver: {
      name: 'request_fee_waiver',
      title: 'Request Fee Waiver',
      description: 'Submit a fee waiver request for review by a human agent. This logs the request — it does NOT grant a waiver. A human reviewer will respond within 2 business days.',
      requiresUserAuth: true,
      requiredScopes: ['write'],
      handler: 'executeRequestFeeWaiver',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: false, idempotent: false, openWorld: false } },
      outputSchema: REQUEST_FEE_WAIVER_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID to request the fee waiver for' },
          reason: { type: 'string', description: 'Reason for the waiver request' }
        },
        required: ['account_id'],
        additionalProperties: false
      }
    },

    query_user_by_email: {
      name: 'query_user_by_email',
      title: 'Check Email',
      description: 'Check if a user exists in the banking system by email address',
      requiresUserAuth: true,
      requiredScopes: ['ai_agent'],
      handler: 'executeQueryUserByEmail',
      readOnly: false,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22999999%22 d=%22M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: false
        }
      },
      outputSchema: QUERY_USER_BY_EMAIL_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email address to search for',
            format: 'email',
            minLength: 1
          }
        },
        required: ['email'],
        additionalProperties: false
      }
    },

    lookup_customer: {
      name: 'lookup_customer',
      title: 'Look Up Customer',
      description: 'Search for customers by name, email, or username. Returns matching user records.',
      requiresUserAuth: true,
      requiredScopes: ['admin:read', 'users:read'],
      handler: 'executeLookupCustomer',
      readOnly: true,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_LOOKUP_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, email, or username fragment to search for' }
        },
        required: ['query'],
        additionalProperties: false
      }
    },

    get_customer_profile: {
      name: 'get_customer_profile',
      title: 'Get Customer Profile',
      description: 'Retrieve the full profile for a customer by userId.',
      requiresUserAuth: true,
      requiredScopes: ['admin:read', 'users:read'],
      handler: 'executeGetCustomerProfile',
      readOnly: true,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_PROFILE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID to retrieve' }
        },
        required: ['userId'],
        additionalProperties: false
      }
    },

    get_customer_accounts: {
      name: 'get_customer_accounts',
      title: 'Get Customer Accounts',
      description: 'Retrieve all accounts for a customer by userId.',
      requiresUserAuth: true,
      requiredScopes: ['admin:read', 'users:read'],
      handler: 'executeGetCustomerAccounts',
      readOnly: true,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_ACCOUNTS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID whose accounts to retrieve' }
        },
        required: ['userId'],
        additionalProperties: false
      }
    },

    get_customer_transactions: {
      name: 'get_customer_transactions',
      title: 'Get Customer Transactions',
      description: 'Retrieve the last N transactions for a customer. Defaults to 5.',
      requiresUserAuth: true,
      requiredScopes: ['admin:read', 'users:read'],
      handler: 'executeGetCustomerTransactions',
      readOnly: true,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_TRANSACTIONS_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID' },
          limit: { type: 'number', description: 'Number of transactions to return (default 5, max 50)' }
        },
        required: ['userId'],
        additionalProperties: false
      }
    },

    freeze_account: {
      name: 'freeze_account',
      title: 'Freeze / Unfreeze Account',
      description: 'Toggle the active status of a customer account. freeze: true disables it.',
      requiresUserAuth: true,
      requiredScopes: ['admin:write', 'users:manage'],
      handler: 'executeFreezeAccount',
      readOnly: false,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22cc5500%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: true, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_WRITE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'The account ID to freeze or unfreeze' },
          freeze: { type: 'boolean', description: 'true to freeze, false to unfreeze' }
        },
        required: ['accountId', 'freeze'],
        additionalProperties: false
      }
    },

    reset_customer_password: {
      name: 'reset_customer_password',
      title: 'Reset Customer Password',
      description: 'Mark a customer account as requiring a password reset. They are prompted on next login.',
      requiresUserAuth: true,
      requiredScopes: ['admin:write', 'users:manage'],
      handler: 'executeResetCustomerPassword',
      readOnly: false,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22cc5500%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: ADMIN_WRITE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID to mark for password reset' }
        },
        required: ['userId'],
        additionalProperties: false
      }
    },

    adjust_balance: {
      name: 'adjust_balance',
      title: 'Adjust Account Balance',
      description: 'Add or subtract from an account balance by seeding a transaction. Use positive amount to add, negative to subtract.',
      requiresUserAuth: true,
      requiredScopes: ['admin:write', 'users:manage'],
      handler: 'executeAdjustBalance',
      readOnly: false,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2020/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22cc5500%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: false, idempotent: false, openWorld: false } },
      outputSchema: ADMIN_WRITE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'The account ID to adjust' },
          amount: { type: 'number', description: 'Amount to add (positive) or subtract (negative)' },
          description: { type: 'string', description: 'Description for the seeded transaction' }
        },
        required: ['accountId', 'amount'],
        additionalProperties: false
      }
    },

    delete_customer: {
      name: 'delete_customer',
      title: 'Delete Customer',
      description: 'Permanently delete a customer and all their accounts and transactions. Requires confirm: true.',
      requiresUserAuth: true,
      requiredScopes: ['admin:write', 'admin:delete', 'users:manage'],
      handler: 'executeDeleteCustomer',
      readOnly: false,
      vertical: 'admin',
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22cc0000%22 d=%22M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: { userFacing: { readable: false, destructive: true, idempotent: false, openWorld: false } },
      outputSchema: ADMIN_WRITE_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The user ID to delete' },
          confirm: { type: 'boolean', description: 'Must be true — confirms the destructive action' }
        },
        required: ['userId', 'confirm'],
        additionalProperties: false
      }
    },

    sequential_think: {
      name: 'sequential_think',
      title: 'Reason & Analyze',
      description: 'Reason step-by-step through a complex banking question or decision. '
        + 'Returns a structured chain of reasoning steps with titles, descriptions, and a final conclusion. '
        + 'Use this before making complex decisions (e.g., transfer eligibility, account analysis, loan assessment).',
      requiresUserAuth: false,
      requiredScopes: [],
      handler: 'executeSequentialThink',
      readOnly: true,
      icons: [
        {
          src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M11 14h2v2h-2zm0-6h2v2h-2zm0-6h2v2h-2zm6 0h2v2h-2zm0 6h2v2h-2zm0 6h2v2h-2zm-12 0h2v2H5zm0-6h2v2H5zm0-6h2v2H5z%22/%3E%3C/svg%3E',
          mimeType: 'image/svg+xml',
          sizes: ['16x16', '32x32']
        }
      ],
      annotations: {
        userFacing: {
          readable: true,
          destructive: false,
          idempotent: true,
          openWorld: true
        }
      },
      outputSchema: SEQUENTIAL_THINK_OUTPUT,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The question or decision to reason through (e.g. "Should I transfer $500 from savings to checking?")',
            minLength: 1,
            maxLength: 500
          },
          context: {
            type: 'string',
            description: 'Optional additional context (e.g. account balances, user situation)',
            maxLength: 1000
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    },

    // -------------------------------------------------------------------------
    // Vertical feature tools — gateway intercepts these before BankingToolProvider.
    // Registered here so they appear in tools/list and scope checks work correctly.
    // -------------------------------------------------------------------------

    show_mortgage: {
      name: 'show_mortgage',
      title: 'Mortgage Account',
      description: 'Retrieve the user\'s mortgage account details including property address, loan amount, current balance, interest rate, monthly payment, and next payment date. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the mortgage backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['mortgage:read'],
      handler: 'executeShowMortgage',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_health_record: {
      name: 'show_health_record',
      title: 'Health Record',
      description: 'Retrieve the user\'s latest health record including record type, provider, facility, visit date, covered amount, copay, status, and coverage plan. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the healthcare backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['records:read'],
      handler: 'executeShowHealthRecord',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_investment: {
      name: 'show_investment',
      title: 'Portfolio Status',
      description: 'Retrieve the user\'s investment portfolio status including portfolio id, holder, total value, cash sweep, and holdings. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the investment backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['invest:read'],
      handler: 'executeShowInvestment',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_gear_order: {
      name: 'show_gear_order',
      title: 'Gear Order',
      description: 'Retrieve the user\'s latest gear order including item, category, amount, status, delivery date, loyalty points earned, and member tier. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the sporting-goods backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['gear:read'],
      handler: 'executeShowGearOrder',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_expense_report: {
      name: 'show_expense_report',
      title: 'Expense Report',
      description: 'Retrieve the user\'s latest expense report including category, description, amount, submission date, status, approver, and reimbursement date. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the workforce backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['expense:read'],
      handler: 'executeShowExpenseReport',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_permit: {
      name: 'show_permit',
      title: 'Permit Status',
      description: 'Retrieve the resident\'s permit status including permit type, subject, jurisdiction, issue/expiry dates, fees owed, status, and inspector. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the government backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['permits:read'],
      handler: 'executeShowPermit',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_enrollment: {
      name: 'show_enrollment',
      title: 'Enrollment Status',
      description: 'Retrieve the student\'s enrollment status including program, term, standing, enrolled and earned credits, GPA, tuition balance, and holds. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the university backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['transcript:read'],
      handler: 'executeShowEnrollment',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-6 8.18v4L12 18l6-2.82v-4L12 14l-6-2.82z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_work_order: {
      name: 'show_work_order',
      title: 'Work Order Status',
      description: 'Retrieve the operator\'s work order status including product, type, line, quantity, completed quantity, value, status, and due date. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the manufacturing backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['workorders:read'],
      handler: 'executeShowWorkOrder',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    show_large_purchase: {
      name: 'show_large_purchase',
      title: 'Large Purchase',
      description: 'Retrieve the user\'s latest large purchase record including product, SKU, category, amount, status, estimated delivery, rewards points earned, and retailer. Routes through the MCP gateway api_key disposition — the gateway drops the OAuth bearer and calls the retail backend with a service API key.',
      requiresUserAuth: true,
      requiredScopes: ['largepurchase:read'],
      handler: 'executeShowLargePurchase',
      readOnly: true,
      icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%220055cc%22 d=%22M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23.46 5H5.21l-.94-2H1zm16 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z%22/%3E%3C/svg%3E', mimeType: 'image/svg+xml', sizes: ['16x16', '32x32'] }],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
      outputSchema: SHOW_VERTICAL_OUTPUT,
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },

    code_search: {
      name: 'code_search',
      title: 'Code Search',
      description: 'Semantic search over the indexed source code. Returns ranked snippets with file path and line range. Use when asked where something is implemented or how the code works.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Natural-language description of the code to find' },
        limit: { type: 'number', description: 'Max results (1-25, default 10)' },
      }, required: ['query'], additionalProperties: false },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeCodeSearch',
      readOnly: true,
      outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
      icons: [],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
    },

    get_code: {
      name: 'get_code',
      title: 'Get Code',
      description: 'Fetch the source lines for a file and line range (e.g. from a code_search hit).',
      inputSchema: { type: 'object', properties: {
        file: { type: 'string', description: 'Repo-relative file path' },
        line_start: { type: 'number' },
        line_end: { type: 'number' },
      }, required: ['file', 'line_start', 'line_end'], additionalProperties: false },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeGetCode',
      readOnly: true,
      outputSchema: { type: 'object', properties: { file: { type: 'string' }, line_start: { type: 'number' }, line_end: { type: 'number' }, code: { type: 'string' } } },
      icons: [],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
    },

    list_codebases: {
      name: 'list_codebases',
      title: 'List Codebases',
      description: 'List the codebases indexed in the code-search vector store.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeListCodebases',
      readOnly: true,
      outputSchema: { type: 'object', properties: { codebases: { type: 'array' } } },
      icons: [],
      annotations: { userFacing: { readable: true, destructive: false, idempotent: true, openWorld: false } },
    },
  };

  /**
   * Get all available banking tools
   */
  public static getAllTools(): BankingToolDefinition[] {
    return [...Object.values(this.TOOLS), ...Object.values(VERTICAL_TOOL_DEFS)];
  }

  /**
   * Get tool definition by name
   */
  public static getTool(name: string): BankingToolDefinition | undefined {
    return this.TOOLS[name] ?? VERTICAL_TOOL_DEFS[name];
  }

  /**
   * Get tool names
   */
  public static getToolNames(): string[] {
    return [...Object.keys(this.TOOLS), ...Object.keys(VERTICAL_TOOL_DEFS)];
  }

  /**
   * Check if a tool exists
   */
  public static hasTool(name: string): boolean {
    return name in this.TOOLS || name in VERTICAL_TOOL_DEFS;
  }

  /**
   * Get tools that require specific scopes
   */
  public static getToolsByScope(scope: string): BankingToolDefinition[] {
    return Object.values(this.TOOLS).filter(tool => 
      tool.requiredScopes.includes(scope)
    );
  }

  /**
   * Get read-only tools (safe for external agents without write scopes)
   */
  public static getReadOnlyTools(): BankingToolDefinition[] {
    return Object.values(this.TOOLS).filter(t => t.readOnly);
  }

  /**
   * Get authenticated/write tools (require user auth and write scopes)
   */
  public static getAuthenticatedTools(): BankingToolDefinition[] {
    return Object.values(this.TOOLS).filter(t => !t.readOnly);
  }

  /**
   * Get MCP-compatible tool definitions (without handler property)
   * Includes MCP 2025-11-25 spec-compliant metadata: title, icons, annotations
   */
  public static getMCPToolDefinitions(): ToolDefinition[] {
    return this.getAllTools().map(tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      icons: tool.icons,
      annotations: tool.annotations,
      requiresUserAuth: tool.requiresUserAuth,
      requiredScopes: tool.requiredScopes
    }));
  }
}