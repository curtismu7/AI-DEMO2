import React, { useState } from 'react';
import styles from './MCPToolsEducation.module.css';

interface MCPToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface MCPToolInfo {
  name: string;
  displayName: string;
  description: string;
  requiresUserAuth: boolean;
  requiredScopes: string[];
  readOnly: boolean;
  params: MCPToolParam[];
  exampleResponse?: string;
}

interface ToolCategory {
  name: string;
  description: string;
  tools: MCPToolInfo[];
  defaultExpanded: boolean;
}

/** Sample argument value for a param, keyed by name hint then type. */
function sampleArg(param: MCPToolParam): unknown {
  const n = param.name.toLowerCase();
  if (n.endsWith('account_id') || n === 'account_id') return 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  if (n.includes('email')) return 'user@example.com';
  if (n.includes('amount')) return 250.0;
  switch (param.type) {
    case 'number': return 1;
    case 'boolean': return true;
    default: return n.includes('description') ? 'Sample note' : `<${param.name}>`;
  }
}

/** Build a JSON-RPC tools/call request the agent would send for this tool. */
function buildSampleRequest(tool: MCPToolInfo): string {
  const args: Record<string, unknown> = {};
  tool.params.forEach(p => { args[p.name] = sampleArg(p); });
  return JSON.stringify(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool.name, arguments: args } },
    null,
    2
  );
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'Read-Only Data Access',
    description: 'Safe read operations — no data is modified. Ideal for untrusted agents.',
    defaultExpanded: false,
    tools: [
      {
        name: 'get_my_accounts',
        displayName: 'Get My Accounts',
        description: 'List all bank accounts for the authenticated user. Returns account type, name, masked account number, current balance, currency, and status. Use get_sensitive_account_details to retrieve full account numbers, IBAN, SWIFT, and routing information.',
        requiresUserAuth: true,
        requiredScopes: ['accounts:read'],
        readOnly: true,
        params: [],
        exampleResponse: `{
  "success": true,
  "count": 2,
  "accounts": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "accountType": "checking",
      "name": "Primary Checking",
      "accountNumber": "****4321",
      "balance": 4823.50,
      "currency": "USD",
      "status": "active"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "accountType": "savings",
      "name": "High-Yield Savings",
      "accountNumber": "****7654",
      "balance": 12450.00,
      "currency": "USD",
      "status": "active"
    }
  ]
}`
      },
      {
        name: 'get_account_balance',
        displayName: 'Get Account Balance',
        description: 'Get balance for a specific account using its account ID.',
        requiresUserAuth: true,
        requiredScopes: ['accounts:read'],
        readOnly: true,
        params: [
          { name: 'account_id', type: 'string', description: 'Account ID (UUID format)', required: true }
        ],
        exampleResponse: `{
  "success": true,
  "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "balance": 4823.50
}`
      },
      {
        name: 'get_my_transactions',
        displayName: 'Get My Transactions',
        description: 'Retrieve the user\'s transaction history across all accounts.',
        requiresUserAuth: true,
        requiredScopes: ['transactions:read'],
        readOnly: true,
        params: [],
        exampleResponse: `{
  "success": true,
  "count": 3,
  "transactions": [
    {
      "id": "tx-001-abcd",
      "type": "deposit",
      "amount": 500.00,
      "date": "2026-04-25T14:32:00.000Z",
      "fromAccountId": null,
      "toAccountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "description": "Direct deposit"
    },
    {
      "id": "tx-002-efgh",
      "type": "transfer",
      "amount": 200.00,
      "date": "2026-04-24T09:15:00.000Z",
      "fromAccountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "toAccountId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "description": "Savings transfer"
    }
  ]
}`
      },
      {
        name: 'sequential_think',
        displayName: 'Sequential Think',
        description: 'Reason step-by-step through a complex banking question or decision. Returns structured chain of reasoning steps with a final conclusion.',
        requiresUserAuth: false,
        requiredScopes: [],
        readOnly: true,
        params: [
          { name: 'query', type: 'string', description: 'The question or decision to reason through', required: true },
          { name: 'context', type: 'string', description: 'Optional additional context', required: false }
        ],
        exampleResponse: `{
  "success": true,
  "query": "Should I move money from checking to savings?",
  "steps": [
    { "step": 1, "reasoning": "Check current checking balance: $4823.50 — sufficient funds available." },
    { "step": 2, "reasoning": "Savings rate is 4.1% APY vs 0.01% on checking — opportunity cost is real." },
    { "step": 3, "reasoning": "User has $1200 in upcoming bills this month — keep at least $2000 in checking as buffer." }
  ],
  "conclusion": "Transferring $2000 to savings is safe and maximises interest without impacting bill payments.",
  "confidence": "high"
}`
      }
    ]
  },
  {
    name: 'Write Operations',
    description: 'These tools modify data or access sensitive information. Require user authentication and consent.',
    defaultExpanded: true,
    tools: [
      {
        name: 'create_deposit',
        displayName: 'Create Deposit',
        description: 'Create a deposit transaction to an account. Amounts over $500 require human consent on the web dashboard first.',
        requiresUserAuth: true,
        requiredScopes: ['transactions:write'],
        readOnly: false,
        params: [
          { name: 'to_account_id', type: 'string', description: 'Account ID to deposit to', required: true },
          { name: 'amount', type: 'number', description: 'Amount to deposit', required: true },
          { name: 'description', type: 'string', description: 'Transaction description', required: false }
        ],
        exampleResponse: `{
  "success": true,
  "operation": "deposit",
  "message": "Deposit of $250.00 completed successfully",
  "transaction": {
    "id": "tx-003-ijkl",
    "amount": 250.00,
    "toAccountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "description": "Agent deposit"
  },
  "amount": 250.00,
  "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}

// If amount > $250 and no HITL consent (Phase 2):
{
  "error": "hitl_required",
  "hitl": { "type": "consent" },
  "message": "High-value transaction requires human approval. Please approve in the dashboard.",
  "hitl_threshold_usd": 250
}`
      },
      {
        name: 'create_withdrawal',
        displayName: 'Create Withdrawal',
        description: 'Create a withdrawal transaction from an account. Amounts over $500 require human consent on the web dashboard first.',
        requiresUserAuth: true,
        requiredScopes: ['transactions:write'],
        readOnly: false,
        params: [
          { name: 'from_account_id', type: 'string', description: 'Account ID to withdraw from', required: true },
          { name: 'amount', type: 'number', description: 'Amount to withdraw', required: true },
          { name: 'description', type: 'string', description: 'Transaction description', required: false }
        ],
        exampleResponse: `{
  "success": true,
  "operation": "withdrawal",
  "message": "Withdrawal of $100.00 completed successfully",
  "transaction": {
    "id": "tx-004-mnop",
    "amount": 100.00,
    "fromAccountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "description": "ATM withdrawal"
  },
  "amount": 100.00,
  "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}`
      },
      {
        name: 'create_transfer',
        displayName: 'Create Transfer',
        description: 'Transfer money between accounts. Amounts over $500 require human consent on the web dashboard first.',
        requiresUserAuth: true,
        requiredScopes: ['transactions:write'],
        readOnly: false,
        params: [
          { name: 'from_account_id', type: 'string', description: 'Source account ID', required: true },
          { name: 'to_account_id', type: 'string', description: 'Destination account ID', required: true },
          { name: 'amount', type: 'number', description: 'Amount to transfer', required: true },
          { name: 'description', type: 'string', description: 'Transfer description', required: false }
        ],
        exampleResponse: `{
  "success": true,
  "operation": "transfer",
  "message": "Transfer of $300.00 completed successfully",
  "transaction": {
    "id": "tx-005-qrst",
    "amount": 300.00,
    "fromAccountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "toAccountId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "description": "Monthly savings"
  },
  "amount": 300.00
}`
      },
      {
        name: 'get_sensitive_account_details',
        displayName: 'Get Sensitive Account Details',
        description: 'Retrieve sensitive account details (full account number and routing number). The UI will prompt the user to approve access before this data is released.',
        requiresUserAuth: true,
        requiredScopes: ['sensitive:read'],
        readOnly: false,
        params: [],
        exampleResponse: `{
  "success": true,
  "accounts": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "accountNumber": "123456789012",
      "routingNumber": "021000021",
      "accountType": "checking",
      "name": "Primary Checking"
    }
  ]
}`
      }
    ]
  },
  {
    name: 'Public',
    description: 'No authentication required. Available to any agent or caller.',
    defaultExpanded: false,
    tools: [
      {
        name: 'query_user_by_email',
        displayName: 'Query User by Email',
        description: 'Check if a user exists in the banking system by email address.',
        requiresUserAuth: false,
        requiredScopes: [],
        readOnly: false,
        params: [
          { name: 'email', type: 'string', description: 'Email address to search for', required: true }
        ],
        exampleResponse: `{
  "success": true,
  "found": true,
  "user": {
    "id": "user-uuid-here",
    "email": "alex@example.com",
    "username": "alex.morgan"
  }
}

// If not found:
{
  "success": true,
  "found": false,
  "message": "No user found with email alex@example.com"
}`
      }
    ]
  }
];

/**
 * Catalog of the hosted PingOne MCP server's tools (Platform / Applications /
 * DaVinci), grouped exactly as the server publishes them. These are the admin
 * tools an operator agent can call against PingOne itself — distinct from the
 * banking tools above, which act on the demo's banking data. Explore them live
 * (with request/response inspection) on the PingOne MCP Inspector page.
 */
interface PingOneMcpTool {
  name: string;
  description: string;
}

interface PingOneMcpGroup {
  category: string;
  tools: PingOneMcpTool[];
}

const PINGONE_MCP_GROUPS: PingOneMcpGroup[] = [
  {
    category: 'Platform — Environments',
    tools: [
      { name: 'list_environments__platform_', description: 'List all environments' },
      { name: 'get_environment__platform_', description: 'Get environment details' },
      { name: 'create_environment__platform_', description: 'Create an environment' },
      { name: 'update_environment__platform_', description: 'Update an environment' },
      { name: 'get_environment_services__platform_', description: 'Get environment services' },
      { name: 'update_environment_services__platform_', description: 'Update environment services' }
    ]
  },
  {
    category: 'Platform — Populations',
    tools: [
      { name: 'list_populations__platform_', description: 'List populations' },
      { name: 'get_population__platform_', description: 'Get population details' },
      { name: 'create_population__platform_', description: 'Create a population' },
      { name: 'update_population__platform_', description: 'Update a population' }
    ]
  },
  {
    category: 'Platform — Users',
    tools: [
      { name: 'list_users__platform_', description: 'List users' },
      { name: 'get_user__platform_', description: 'Get user details' },
      { name: 'create_user__platform_', description: 'Create a user' },
      { name: 'update_user__platform_', description: 'Update a user' },
      { name: 'manage_user_account__platform_', description: 'Manage user account (enable/disable/unlock)' },
      { name: 'manage_user_mfa__platform_', description: 'Manage user MFA devices' },
      { name: 'manage_user_password__platform_', description: 'Manage user password' }
    ]
  },
  {
    category: 'Applications — Core',
    tools: [
      { name: 'listApplications', description: 'List applications' },
      { name: 'getApplication', description: 'Get application details' },
      { name: 'createApplication', description: 'Create an application' },
      { name: 'updateApplication', description: 'Update an application' },
      { name: 'deleteApplication', description: 'Delete an application' },
      { name: 'getApplicationMetadata', description: 'Get application metadata' },
      { name: 'updateApplicationMetadata', description: 'Update application metadata' },
      { name: 'getApplicationSecret', description: 'Get application secret' },
      { name: 'regenerateApplicationSecret', description: 'Regenerate application secret' },
      { name: 'deleteApplicationPreviousSecret', description: 'Delete previous application secret' }
    ]
  },
  {
    category: 'Applications — Attribute Mappings',
    tools: [
      { name: 'listApplicationAttributeMappings', description: 'List attribute mappings' },
      { name: 'createApplicationAttributeMapping', description: 'Create attribute mapping' },
      { name: 'updateApplicationAttributeMapping', description: 'Update attribute mapping' },
      { name: 'deleteApplicationAttributeMapping', description: 'Delete attribute mapping' }
    ]
  },
  {
    category: 'Applications — Flow Policies',
    tools: [
      { name: 'listApplicationFlowPolicyAssignments', description: 'List flow policy assignments' },
      { name: 'createApplicationFlowPolicyAssignment', description: 'Assign a flow policy' },
      { name: 'updateApplicationFlowPolicyAssignment', description: 'Update flow policy assignment' },
      { name: 'deleteApplicationFlowPolicyAssignment', description: 'Remove flow policy assignment' }
    ]
  },
  {
    category: 'Applications — Sign-On Policies',
    tools: [
      { name: 'listApplicationSignOnPolicyAssignments', description: 'List sign-on policy assignments' },
      { name: 'createApplicationSignOnPolicyAssignment', description: 'Assign a sign-on policy' },
      { name: 'updateApplicationSignOnPolicyAssignment', description: 'Update sign-on policy assignment' },
      { name: 'deleteApplicationSignOnPolicyAssignment', description: 'Remove sign-on policy assignment' }
    ]
  },
  {
    category: 'Applications — Grants & Roles',
    tools: [
      { name: 'listApplicationGrants', description: 'List application grants' },
      { name: 'createApplicationGrant', description: 'Create application grant' },
      { name: 'updateApplicationGrant', description: 'Update application grant' },
      { name: 'deleteApplicationGrant', description: 'Delete application grant' },
      { name: 'listApplicationRoleAssignments', description: 'List role assignments' },
      { name: 'createApplicationRoleAssignment', description: 'Assign a role' },
      { name: 'deleteApplicationRoleAssignment', description: 'Remove role assignment' }
    ]
  },
  {
    category: 'Applications — Push Credentials',
    tools: [
      { name: 'listApplicationPushCredentials', description: 'List push credentials' },
      { name: 'createApplicationPushCredential', description: 'Create push credential' },
      { name: 'updateApplicationPushCredential', description: 'Update push credential' },
      { name: 'deleteApplicationPushCredential', description: 'Delete push credential' }
    ]
  },
  {
    category: 'DaVinci',
    tools: [
      { name: 'listDavinciFlows', description: 'List flows' },
      { name: 'listDavinciFlowVersions', description: 'List flow versions' },
      { name: 'describeDavinciFlow', description: 'Get flow details' },
      { name: 'describeDavinciFlowVersion', description: 'Get flow version details' },
      { name: 'listDavinciFlowExecutions', description: 'List flow executions' },
      { name: 'describeDavinciFlowExecution', description: 'Get flow execution details' },
      { name: 'listDavinciApplications', description: 'List DaVinci applications' },
      { name: 'describeDavinciApplication', description: 'Get DaVinci application details' },
      { name: 'listDavinciApplicationFlowPolicies', description: 'List flow policies' },
      { name: 'describeDavinciApplicationFlowPolicy', description: 'Get flow policy details' },
      { name: 'listDavinciConnectors', description: 'List connectors' },
      { name: 'describeDavinciConnector', description: 'Get connector details' },
      { name: 'listDavinciConnectorInstances', description: 'List connector instances' },
      { name: 'describeDavinciConnectorInstance', description: 'Get connector instance details' },
      { name: 'listDavinciVariables', description: 'List variables' },
      { name: 'describeDavinciVariable', description: 'Get variable details' },
      { name: 'listDavinciForms', description: 'List forms' },
      { name: 'describeDavinciForm', description: 'Get form details' }
    ]
  }
];

const PINGONE_MCP_TOOL_COUNT = PINGONE_MCP_GROUPS.reduce((sum, g) => sum + g.tools.length, 0);

export const MCPToolsEducation: React.FC = () => {
  const [elicitationOpen, setElicitationOpen] = useState(false);
  const [pingOneOpen, setPingOneOpen] = useState(false);
  const [openExamples, setOpenExamples] = useState<Record<string, boolean>>({});
  const [openRequests, setOpenRequests] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOOL_CATEGORIES.map(cat => [cat.name, cat.defaultExpanded]))
  );

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryName]: !prev[categoryName]
    }));
  };

  const toggleExample = (toolName: string) => {
    setOpenExamples(prev => ({ ...prev, [toolName]: !prev[toolName] }));
  };

  const toggleRequest = (toolName: string) => {
    setOpenRequests(prev => ({ ...prev, [toolName]: !prev[toolName] }));
  };

  const totalTools = TOOL_CATEGORIES.reduce((sum, cat) => sum + cat.tools.length, 0);

  return (
    <div className={styles.mcpToolsEducation} data-testid="mcp-tools-education">
      <h2>MCP Banking Tools</h2>

      <div className={styles.introduction}>
        <p>
          The MCP server provides <strong>{totalTools} tools</strong> that an AI agent can use to interact with
          your banking data. Each tool requires specific OAuth scopes and may need user authentication.
        </p>
      </div>

      <div className={styles.categories}>
        {TOOL_CATEGORIES.map(category => {
          const isExpanded = expandedCategories[category.name];
          return (
            <div key={category.name} className={styles.category}>
              <button
                className={styles.categoryHeader}
                onClick={() => toggleCategory(category.name)}
                aria-expanded={isExpanded}
                type="button"
              >
                <span className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}>▶</span>
                <span className={styles.categoryName}>{category.name}</span>
                <span className={styles.toolCount}>{category.tools.length} tool{category.tools.length !== 1 ? 's' : ''}</span>
              </button>

              {isExpanded && (
                <div className={styles.categoryContent}>
                  <p className={styles.categoryDescription}>{category.description}</p>
                  {category.tools.map(tool => (
                    <div key={tool.name} className={styles.toolCard} data-testid={`tool-${tool.name}`}>
                      <div className={styles.toolHeader}>
                        <h3 className={styles.toolName}>{tool.displayName}</h3>
                        {tool.requiresUserAuth ? (
                          <span className={styles.authRequired} title="Requires user authentication">
                            🔐 Auth Required
                          </span>
                        ) : (
                          <span className={styles.authPublic} title="No authentication required">
                            🌐 Public
                          </span>
                        )}
                      </div>

                      <p className={styles.toolDescription}>{tool.description}</p>

                      <div className={styles.toolMeta}>
                        <div className={styles.scopes}>
                          {tool.requiredScopes.length > 0 ? (
                            tool.requiredScopes.map(scope => (
                              <span key={scope} className={styles.scopeBadge}>{scope}</span>
                            ))
                          ) : (
                            <span className={styles.noScopes}>No scopes required</span>
                          )}
                        </div>

                        {tool.params.length > 0 && (
                          <div className={styles.params}>
                            <span className={styles.paramsLabel}>Parameters:</span>
                            {tool.params.map(param => (
                              <span key={param.name} className={styles.paramBadge} title={param.description}>
                                {param.name}
                                {param.required && <span className={styles.required}>*</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className={styles.exampleSection}>
                        <button
                          className={styles.exampleToggle}
                          onClick={() => toggleRequest(tool.name)}
                          type="button"
                          aria-expanded={!!openRequests[tool.name]}
                        >
                          <span className={openRequests[tool.name] ? styles.chevronExpanded : styles.chevron}>▶</span>
                          Example Request
                        </button>
                        {openRequests[tool.name] && (
                          <pre className={styles.exampleCode}>{buildSampleRequest(tool)}</pre>
                        )}
                      </div>

                      {tool.exampleResponse && (
                        <div className={styles.exampleSection}>
                          <button
                            className={styles.exampleToggle}
                            onClick={() => toggleExample(tool.name)}
                            type="button"
                            aria-expanded={!!openExamples[tool.name]}
                          >
                            <span className={openExamples[tool.name] ? styles.chevronExpanded : styles.chevron}>▶</span>
                            Example Response
                          </button>
                          {openExamples[tool.name] && (
                            <pre className={styles.exampleCode}>{tool.exampleResponse}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Tool Coverage Tables */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1a3a52', marginBottom: '8px' }}>
          Action Chips — Tool Mapping
        </h3>
        <p style={{ fontSize: '13px', color: '#555', marginBottom: '12px' }}>
          Each MCP tool has a corresponding quick-action chip in the Banking Agent UI. Clicking a chip sends
          a pre-built natural-language intent — no typing required.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '9px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Tool</th>
                <th style={{ padding: '9px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Chip Label</th>
                <th style={{ padding: '9px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Group</th>
              </tr>
            </thead>
            <tbody>
              {[
                { tool: 'get_my_accounts',              chip: '🏦 My Accounts',                   group: 'Account',     isNew: false },
                { tool: 'get_account_balance',          chip: '💰 Check Balance',                 group: 'Account',     isNew: false },
                { tool: 'get_my_transactions',          chip: '📋 Recent Transactions',           group: 'Transaction', isNew: false },
                { tool: 'get_sensitive_account_details',chip: 'View Sensitive Account Details',   group: 'Account',     isNew: false },
                { tool: 'create_deposit',               chip: '⬇ Deposit',                       group: 'Transaction', isNew: false },
                { tool: 'create_withdrawal',            chip: '⬆ Withdraw',                      group: 'Transaction', isNew: false },
                { tool: 'create_transfer',              chip: '↔ Transfer',                      group: 'Transaction', isNew: false },
                { tool: 'query_user_by_email',          chip: '🔎 Query User by Email',           group: 'Admin',       isNew: true  },
                { tool: 'sequential_think',             chip: '🧠 Think Through a Question',      group: 'Account',     isNew: true  },
              ].map((row, i) => (
                <tr key={row.tool} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>{row.tool}</td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', color: '#111827' }}>
                    {row.chip}
                    {row.isNew && <span style={{ marginLeft: 6, fontSize: '10px', fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', borderRadius: 8, padding: '1px 7px' }}>new</span>}
                  </td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: row.group === 'Account' ? '#eff6ff' : row.group === 'Transaction' ? '#f0fdf4' : '#fef3c7',
                      color:      row.group === 'Account' ? '#1d4ed8' : row.group === 'Transaction' ? '#166534'  : '#92400e',
                    }}>
                      {row.group}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1a3a52', marginTop: '28px', marginBottom: '8px' }}>
          Coverage Matrix
        </h3>
        <p style={{ fontSize: '13px', color: '#555', marginBottom: '12px' }}>
          Every tool is registered in three places so the demo works even without a live MCP server connection.
          <strong> MCP Server</strong> = live tool call via WebSocket; <strong>Static Fallback</strong> = heuristic
          response from the BFF when the MCP server is unreachable; <strong>Education Panel</strong> = documented
          here on this page.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '9px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Tool</th>
                <th style={{ padding: '9px 14px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>MCP Server</th>
                <th style={{ padding: '9px 14px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Static Fallback</th>
                <th style={{ padding: '9px 14px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Education Panel</th>
              </tr>
            </thead>
            <tbody>
              {[
                'get_my_accounts',
                'get_account_balance',
                'get_my_transactions',
                'get_sensitive_account_details',
                'create_deposit',
                'create_withdrawal',
                'create_transfer',
                'query_user_by_email',
                'sequential_think',
              ].map((tool, i) => (
                <tr key={tool} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>{tool}</td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', color: '#16a34a', fontWeight: 700, fontSize: '16px' }}>✓</td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', color: '#16a34a', fontWeight: 700, fontSize: '16px' }}>✓</td>
                  <td style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', color: '#16a34a', fontWeight: 700, fontSize: '16px' }}>✓</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      <div className={styles.category} style={{ marginTop: '24px' }}>
        <button
          className={styles.categoryHeader}
          onClick={() => setElicitationOpen(o => !o)}
          aria-expanded={elicitationOpen}
          type="button"
          style={{ background: 'linear-gradient(90deg,#1a3a52 0%,#0052CC 100%)', color: '#fff' }}
        >
          <span className={`${styles.chevron} ${elicitationOpen ? styles.chevronExpanded : ''}`} style={{ color: '#fff' }}>▶</span>
          <span className={styles.categoryName} style={{ color: '#fff' }}>📡 MCP Elicitation (Spec: §elicitation)</span>
          <span className={styles.toolCount} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>MCP 2025-11-25</span>
        </button>

        {elicitationOpen && (
          <div className={styles.categoryContent}>
            <p className={styles.categoryDescription}>
              Elicitation allows an <strong>MCP server to request additional information from the user</strong> via the
              client — without breaking the agentic flow. Instead of failing a tool call mid-stream, the server sends an{' '}
              <code>elicitation/create</code> message and waits for the client to collect and return the data.
            </p>

            <div className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName}>Form Mode (default)</h3>
                <span className={styles.authPublic}>📋 Structured input</span>
              </div>
              <p className={styles.toolDescription}>
                The server sends a JSON Schema describing the fields it needs. The client renders a form, the user fills
                it in, and the client returns the values. This is the baseline mode — every client that declares the{' '}
                <code>elicitation</code> capability supports it.
              </p>
              <div className={styles.toolMeta}>
                <div className={styles.params}>
                  <span className={styles.paramsLabel}>Flow:</span>
                  <span className={styles.paramBadge}>server → elicitation/create</span>
                  <span className={styles.paramBadge}>client renders form</span>
                  <span className={styles.paramBadge}>user submits</span>
                  <span className={styles.paramBadge}>client returns values</span>
                </div>
              </div>
              <div style={{ marginTop: '10px', background: '#f8f9fa', borderRadius: '6px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', overflowX: 'auto' }}>
                <div style={{ color: '#374151', marginBottom: '4px' }}>{/* Server → Client */}</div>
                {`{
  "method": "elicitation/create",
  "params": {
    "message": "Please provide your transfer details",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "amount":      { "type": "number",  "title": "Amount ($)" },
        "description": { "type": "string",  "title": "Note" }
      },
      "required": ["amount"]
    }
  }
}`}
              </div>
            </div>

            <div className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName}>URL Mode (new in 2025-11-25)</h3>
                <span className={styles.authRequired}>🔗 External redirect</span>
              </div>
              <p className={styles.toolDescription}>
                When the client declares <code>{`elicitation: { url: {} }`}</code> in its capabilities, the server
                can send <code>mode: "url"</code> to redirect the user to an external URL — for example an OAuth
                consent page, a payment processor, or a credentials page. After the user completes the external flow,
                the server sends a <code>notifications/elicitation/complete</code>.
              </p>
              <p className={styles.toolDescription} style={{ color: '#b45309', fontWeight: 500 }}>
                ⚠️ Servers <strong>MUST NOT</strong> use URL-mode elicitation to authorize the MCP client itself —
                that is MCP Authorization (RFC 9728), a separate mechanism. Elicitation is for user data, not client auth.
              </p>
              <div className={styles.toolMeta}>
                <div className={styles.params}>
                  <span className={styles.paramsLabel}>Error code:</span>
                  <span className={styles.paramBadge}>-32042 URLElicitationRequiredError</span>
                </div>
              </div>
              <div style={{ marginTop: '10px', background: '#f8f9fa', borderRadius: '6px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', overflowX: 'auto' }}>
                <div style={{ color: '#374151', marginBottom: '4px' }}>{/* Server → Client */}</div>
                {`{
  "method": "elicitation/create",
  "params": {
    "mode": "url",
    "url": "https://bank.example.com/oauth/consent?session=abc123",
    "message": "Please complete identity verification"
  }
}

// Server → Client (after user completes external flow)
{ "method": "notifications/elicitation/complete" }`}
              </div>
            </div>

            <div className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName}>Super Banking HITL vs. Elicitation</h3>
                <span className={styles.authPublic}>🏦 This demo</span>
              </div>
              <p className={styles.toolDescription}>
                Super Banking implements its own <strong>Human-in-the-Loop (HITL)</strong> consent flow using a
                custom auth-challenge mechanism rather than the standard MCP elicitation protocol. High-value
                transactions (&gt;$500) trigger a HITL challenge that the user approves or denies on the web
                dashboard — functionally equivalent to URL-mode elicitation but implemented at the gateway level.
              </p>
              <div className={styles.toolMeta}>
                <div className={styles.scopes}>
                  <span className={styles.scopeBadge}>gateway: POST /hitl/challenge</span>
                  <span className={styles.scopeBadge}>client polls: GET /hitl/status</span>
                  <span className={styles.scopeBadge}>user approves on dashboard</span>
                </div>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: '#374151', marginTop: '12px' }}>
              Spec reference:{' '}
              <a href="https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation" target="_blank" rel="noreferrer">
                MCP 2025-11-25 §elicitation
              </a>
            </p>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* PingOne hosted MCP server catalog (Platform / Applications / DaVinci) */}
      {/* ------------------------------------------------------------------ */}
      <div className={styles.category} style={{ marginTop: '24px' }}>
        <button
          className={styles.categoryHeader}
          onClick={() => setPingOneOpen(o => !o)}
          aria-expanded={pingOneOpen}
          type="button"
          style={{ background: 'linear-gradient(90deg,#1a3a52 0%,#0052CC 100%)', color: '#fff' }}
        >
          <span className={`${styles.chevron} ${pingOneOpen ? styles.chevronExpanded : ''}`} style={{ color: '#fff' }}>▶</span>
          <span className={styles.categoryName} style={{ color: '#fff' }}>🔧 PingOne MCP Tools (Platform &amp; Apps · DaVinci)</span>
          <span className={styles.toolCount} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>{PINGONE_MCP_TOOL_COUNT} tools</span>
        </button>

        {pingOneOpen && (
          <div className={styles.categoryContent}>
            <p className={styles.categoryDescription}>
              These tools are published by the <strong>hosted PingOne MCP server</strong>, not the banking MCP server
              above. They let an operator agent administer PingOne itself — environments, populations, users,
              applications, and DaVinci flows. Explore them live, with full JSON-RPC request/response inspection, on the{' '}
              <a href="/pingone-mcp-inspector">PingOne MCP Inspector</a> page.
            </p>

            {PINGONE_MCP_GROUPS.map(group => (
              <div key={group.category} style={{ marginTop: '18px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1a3a52', marginBottom: '8px' }}>
                  {group.category}
                  <span style={{ marginLeft: 8, fontSize: '11px', fontWeight: 600, color: '#64748b' }}>
                    {group.tools.length} tool{group.tools.length !== 1 ? 's' : ''}
                  </span>
                </h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Tool</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#1a3a52' }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tools.map((tool, i) => (
                        <tr key={tool.name} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          <td style={{ padding: '7px 14px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: '12px', color: '#374151' }}>{tool.name}</td>
                          <td style={{ padding: '7px 14px', borderBottom: '1px solid #f1f5f9', color: '#111827' }}>{tool.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
