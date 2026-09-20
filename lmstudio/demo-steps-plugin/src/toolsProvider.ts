import { tool, type Tool, type ToolsProviderController } from '@lmstudio/sdk';
import { z } from 'zod';
import { configSchematics } from './config';

export const WORKFLOWS: Record<string, { label: string; server: string; tools: string[]; starters: string[]; handoffs?: string[] }> = {
  // This target is intentionally not selectable. It supports the visible
  // Super Sports Checkout handoff, matching LibreChat's hidden destination
  // agent while keeping the LM Studio picker focused on visible use cases.
  'banking-movement': { label: 'Money Movement', server: 'MCP AgentGateway-Banking', tools: ['get_my_accounts', 'create_transfer', 'create_deposit', 'create_withdrawal'], starters: ['Transfer $300 from checking to savings', 'Deposit $50 into checking', 'Withdraw $20 from savings'] },
  'sports-legacy': { label: 'Legacy Records', server: 'MCP AgentGateway-Banking', tools: ['show_gear_order', 'show_gear_warranty'], starters: ['Show my latest gear order', 'Is my watch still under warranty?'] },
  'sports-rentals': { label: 'Gear and Rentals', server: 'MCP AgentGateway-Banking', tools: ['list_rentals', 'browse_gear', 'list_wishlist', 'list_coaching_sessions'], starters: ['Show my active equipment rentals', 'What gear can I buy right now?'] },
  'sports-orders': { label: 'Orders and Loyalty', server: 'MCP AgentGateway-Banking', tools: ['list_gear', 'gear_order_status', 'loyalty_balance', 'list_store_credit'], starters: ['Show my gear orders', 'How many loyalty points do I have?'] },
  'sports-stores-code': { label: 'Stores and Code', server: 'MCP AgentGateway-Banking', tools: ['get_branch_hours', 'code_search'], starters: ['What Super Sports stores are near me?', 'Where is extend_rental implemented?'] },
  'sports-policy': { label: 'Super Sports Policy Guardrails', server: 'MCP AgentGateway-Banking', tools: ['list_rentals', 'loyalty_balance', 'extend_rental', 'sensitive_membership_details'], starters: ['Show my active equipment rentals', 'Extend my Trek Marlin 8 rental (3001) by 2 days'] },
  'sports-stores-code-local-model': { label: 'Super Sports Stores and Code · Local model', server: 'MCP Direct-Banking', tools: ['get_branch_hours', 'code_search'], starters: ['What Super Sports stores are near me?', "What are the Denver Outfitter's hours?", 'Where is extend_rental implemented?', 'Find where PingOne Authorize denies agent-mediated tools'] },
  'handoff-super-sports-checkout': { label: 'Handoff · Super Sports Checkout', server: 'MCP AgentGateway-Banking', tools: ['list_gear', 'gear_order_status'], handoffs: ['banking-movement'], starters: ['Show my gear orders', 'Where is my Garmin Forerunner 265 order (2002)?', 'Withdraw $449 from checking to pay for order 2002'] },
  'opensearch-direct': { label: 'OpenSearch · Direct', server: 'MCP Direct-OpenSearch', tools: ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool', 'GetShardsTool', 'GenericOpenSearchApiTool', 'ClusterHealthTool', 'CountTool', 'MsearchTool', 'ExplainTool'], starters: ['List the OpenSearch indices', 'Search the first non-system index and show 5 documents'] },
  'opensearch-via-privilege': { label: 'OpenSearch · via Privilege', server: 'MCP Privilege-OpenSearch', tools: ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool', 'GetShardsTool', 'GenericOpenSearchApiTool', 'ClusterHealthTool', 'CountTool', 'MsearchTool', 'ExplainTool'], starters: ['List the OpenSearch indices', 'Show the OpenSearch cluster health'] },
  'opensearch-privilege-opensearch22': { label: 'OpenSearch · Privilege opensearch22', server: 'MCP Privilege-OpenSearch', tools: ['ClusterHealthTool', 'ListIndexTool', 'CountTool'], starters: ['What is the OpenSearch cluster health?', 'How many documents are in the cluster?'] },
  'privilege-aggregate': { label: 'Privilege Aggregate', server: 'MCP Privilege-Aggregate', tools: ['opensearch__ClusterHealthTool', 'opensearch__ListIndexTool', 'banking-mcp__list_banking_accounts', 'banking-mcp__get_banking_account'], starters: ['What is the OpenSearch cluster health?', 'List my banking accounts'] },
};

function includesAny(request: string, terms: string[]): boolean {
  return terms.some((term) => request.includes(term));
}

export function routeHandoff(workflowKey: string, request: string): { targetKey: string; reason: string } {
  const normalized = request.toLowerCase();

  if (workflowKey === 'handoff-super-sports-checkout') {
    if (!includesAny(normalized, ['pay', 'payment', 'purchase', 'checkout', 'transfer', 'deposit', 'withdraw', 'charge'])) {
      return {
        targetKey: workflowKey,
        reason: 'The request is an order lookup and can be handled by the selected workflow.',
      };
    }
    return {
      targetKey: 'banking-movement',
      reason: 'The request requires a payment, withdrawal, deposit, or transfer.',
    };
  }

  return { targetKey: workflowKey, reason: 'The selected workflow is already the best match.' };
}

export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  const key = ctl.getPluginConfig(configSchematics).get('workflow');
  const workflow = WORKFLOWS[key] ?? WORKFLOWS['sports-legacy'];
  if (!workflow.handoffs?.length) return [];

  return [tool({
    name: 'route_demo_request',
    description: 'Route a cross-workflow request to the correct AI-DEMO2 workflow. Call this once before selecting a target MCP tool. Do not narrate the routing.',
    parameters: { request: z.string().describe('The user request that may need another workflow.') },
    implementation: async ({ request }: { request: string }) => {
      const route = routeHandoff(key, request);
      const target = WORKFLOWS[route.targetKey];
      return [
        `Handoff route: ${workflow.label} -> ${target.label}.`,
        `MCP server: ${target.server}.`,
        `Call one of these tools next: ${target.tools.length ? target.tools.join(', ') : 'none'}.`,
        `Reason: ${route.reason}`,
      ].join('\n');
    },
  })];
}
