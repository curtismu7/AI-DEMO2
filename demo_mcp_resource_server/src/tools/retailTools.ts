'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchRetailTool } from './retailToolHandler';

export const RETAIL_TOOLS: McpToolDef[] = [
  {
    name: 'list_orders',
    description: 'List all retail orders for the authenticated user, including product, amount, status, and order date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['retail:read'],
    readOnly: true,
    intentHints: [
      'show my orders',
      'list my purchases',
      'what orders do I have',
      'order history',
      'recent purchases',
    ],
  },
  {
    name: 'get_order',
    description: 'Get a single retail order by ID with full order details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['retail:read'],
    readOnly: true,
    intentHints: ['get order details', 'check order status', 'track my order'],
  },
];

export { dispatchRetailTool };
