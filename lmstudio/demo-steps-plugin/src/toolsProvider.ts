import { tool, type Tool, type ToolsProviderController } from '@lmstudio/sdk';
import { z } from 'zod';
import { configSchematics } from './config';

const WORKFLOWS: Record<string, { label: string; server: string; tools: string[]; starters: string[] }> = {
  'banking-everyday': { label: 'Everyday Banking', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'get_account_balance', 'get_my_transactions', 'search_transactions'], starters: ['Show my accounts', 'What is my balance?', 'Show my recent transactions'] },
  'banking-details': { label: 'Account Details', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'get_account_nickname', 'get_my_transactions', 'get_transaction_detail'], starters: ['Show my accounts', 'What is my checking account nickname?', 'Show the details of my latest transaction'] },
  'banking-movement': { label: 'Money Movement', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'create_transfer', 'create_deposit', 'create_withdrawal'], starters: ['Transfer $300 from checking to savings', 'Deposit $50 into checking', 'Withdraw $20 from savings'] },
  'banking-support': { label: 'Support and Fees', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'get_fee_schedule', 'request_fee_waiver', 'get_branch_hours'], starters: ['What fees do you charge?', 'Request a fee waiver on my checking account', 'What are the branch hours?'] },
  'banking-policy': { label: 'Banking Policy Guardrails', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'get_my_transactions', 'create_transfer'], starters: ['Show my accounts', 'Show my recent transactions', 'Transfer $50 from checking to savings'] },
  'sports-legacy': { label: 'Legacy Records', server: 'MCP AgentGateway-Banking', tools: ['show_gear_order', 'show_gear_warranty'], starters: ['Show my latest gear order', 'Is my watch still under warranty?'] },
  'sports-rentals': { label: 'Gear and Rentals', server: 'MCP AgentGateway-Banking', tools: ['list_rentals', 'browse_gear', 'list_wishlist', 'list_coaching_sessions'], starters: ['Show my active equipment rentals', 'What gear can I buy right now?'] },
  'sports-orders': { label: 'Orders and Loyalty', server: 'MCP AgentGateway-Banking', tools: ['list_gear', 'gear_order_status', 'loyalty_balance', 'list_store_credit'], starters: ['Show my gear orders', 'How many loyalty points do I have?'] },
  'sports-stores-code': { label: 'Stores and Code', server: 'MCP AgentGateway-Banking', tools: ['get_branch_hours', 'code_search'], starters: ['What Super Sports stores are near me?', 'Where is extend_rental implemented?'] },
  'sports-policy': { label: 'Super Sports Policy Guardrails', server: 'MCP AgentGateway-Banking', tools: ['list_rentals', 'loyalty_balance', 'extend_rental', 'sensitive_membership_details'], starters: ['Show my active equipment rentals', 'Extend my Trek Marlin 8 rental (3001) by 2 days'] },
  'care-data': { label: 'Health Data', server: 'MCP AgentGateway-Banking', tools: ['list_appointments', 'view_medications', 'view_lab_results', 'view_allergies'], starters: ['When is my next appointment?', 'What medications am I taking?'] },
  'care-coverage': { label: 'Coverage and Claims', server: 'MCP AgentGateway-Banking', tools: ['view_coverage', 'view_claims', 'view_care_team', 'view_referrals'], starters: ['What does my insurance plan cover?', 'Show my recent claims'] },
  'care-actions': { label: 'Actions', server: 'MCP AgentGateway-Banking', tools: ['refill_prescription', 'book_appointment', 'view_medications', 'list_appointments'], starters: ['Refill my Lisinopril prescription', 'Book an annual physical with Dr. Sarah Mitchell'] },
  'care-policy': { label: 'CareConnect Policy Guardrails', server: 'MCP AgentGateway-Banking', tools: ['list_appointments', 'view_medications', 'release_records', 'sensitive_patient_records'], starters: ['When is my next appointment?', 'Release my medical records to Dr. Helen Park'] },
  'opensearch-direct': { label: 'OpenSearch · Direct', server: 'MCP Direct-OpenSearch', tools: ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool', 'GetShardsTool', 'GenericOpenSearchApiTool', 'ClusterHealthTool', 'CountTool', 'MsearchTool', 'ExplainTool'], starters: ['List the OpenSearch indices', 'Search the first non-system index and show 5 documents'] },
  'opensearch-via-privilege': { label: 'OpenSearch · via Privilege', server: 'MCP Privilege-OpenSearch', tools: ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool', 'GetShardsTool', 'GenericOpenSearchApiTool', 'ClusterHealthTool', 'CountTool', 'MsearchTool', 'ExplainTool'], starters: ['List the OpenSearch indices', 'Show the OpenSearch cluster health'] },
  'opensearch-privilege-opensearch22': { label: 'OpenSearch · Privilege opensearch22', server: 'MCP Privilege-OpenSearch', tools: ['ClusterHealthTool', 'ListIndexTool', 'CountTool'], starters: ['What is the OpenSearch cluster health?', 'How many documents are in the cluster?'] },
  'privilege-aggregate': { label: 'Privilege Aggregate', server: 'MCP Privilege-Aggregate', tools: ['opensearch__ClusterHealthTool', 'opensearch__ListIndexTool', 'banking-mcp__list_banking_accounts', 'banking-mcp__get_banking_account'], starters: ['What is the OpenSearch cluster health?', 'List my banking accounts'] },
};

export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  const workflow = WORKFLOWS[ctl.getPluginConfig(configSchematics).get('workflow')] ?? WORKFLOWS['banking-everyday'];
  return [tool({
    name: 'show_demo_workflow',
    description: 'Show the selected AI-DEMO2 workflow, its MCP server, allowed tools, and starter prompts. Use this before running a demo.',
    parameters: { _: z.string().optional().describe('Leave empty; this tool reads the selected workflow.') },
    implementation: async () => JSON.stringify(workflow, null, 2),
  })];
}
