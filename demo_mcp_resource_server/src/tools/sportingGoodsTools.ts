'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchSportingGoodsTool } from './sportingGoodsToolHandler';

export const SPORTING_GOODS_TOOLS: McpToolDef[] = [
  {
    // Renamed from list_gear_orders to match the chip's list_gear
    // (scope-topology.json tools.list_gear, requiredScopes ["read"]).
    name: 'list_gear',
    description: 'List all sporting-goods orders for the authenticated user, including item, amount, status, and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
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
    // Renamed from get_gear_order to match the chip's gear_order_status
    // (scope-topology.json tools.gear_order_status, requiredScopes ["read"]).
    // orderId OPTIONAL — defaults to the most recent order, same as retail's
    // order_status (see retailToolHandler.ts for the identical reasoning).
    name: 'gear_order_status',
    description: 'Show the status of a sporting-goods order. Defaults to the most recent order when no orderId is given.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID (optional — defaults to the most recent order)' },
      },
      required: [],
    },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: ['get gear order details', 'check gear order status', 'track gear order'],
  },
];

export { dispatchSportingGoodsTool };
