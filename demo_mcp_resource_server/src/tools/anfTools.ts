'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchAnfTool } from './anfToolHandler';

export const ANF_TOOLS: McpToolDef[] = [
  {
    // Already the chip-facing name — scope-topology.json's tools.list_anf_orders
    // entry requires only "read". Backed by a flat JSON mock file, not yet a
    // real SQLite table like the other 4 migrated verticals (loadMockData in
    // anfToolHandler.ts) — payload shape already matches the chip's descriptor
    // regardless, so routing it is still a valid backend swap.
    name: 'list_anf_orders',
    description: 'List all Abercrombie & Fitch orders for the authenticated user, including product, amount, status, and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: [
      'show my A&F orders',
      'list my Abercrombie orders',
      'what did I order from Abercrombie',
      'my ANF purchases',
      'show ANF order history',
    ],
  },
  {
    name: 'get_anf_order',
    description: 'Get a single Abercrombie & Fitch order by ID with full order details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['anf:read'],
    readOnly: true,
    intentHints: ['get ANF order details', 'check Abercrombie order status', 'track A&F order'],
  },
];

export { dispatchAnfTool };
