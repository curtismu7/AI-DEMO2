'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchSportingGoodsTool } from './sportingGoodsToolHandler';

export const SPORTING_GOODS_TOOLS: McpToolDef[] = [
  {
    name: 'list_gear_orders',
    description: 'List all sporting-goods orders for the authenticated user, including item, amount, status, and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['sporting-goods:read'],
    readOnly: true,
    intentHints: [
      'show my gear orders',
      'list my sporting goods purchases',
      'what gear did I order',
      'my equipment orders',
      'show gear history',
    ],
  },
  {
    name: 'get_gear_order',
    description: 'Get a single sporting-goods order by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['sporting-goods:read'],
    readOnly: true,
    intentHints: ['get gear order details', 'check gear order status', 'track gear order'],
  },
];

export { dispatchSportingGoodsTool };
