'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchRetailTool } from './retailToolHandler';

export const RETAIL_TOOLS: McpToolDef[] = [
  {
    // Already the chip-facing name — scope-topology.json's tools.list_orders
    // entry requires only "read" (same same-name-shadow pattern as workforce's
    // list_expenses: no rename, just needs a router.ts entry).
    name: 'list_orders',
    description: 'List all retail orders for the authenticated user, including product, amount, status, and order date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
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
    // Renamed from get_order to match the chip's order_status (scope-topology.json
    // tools.order_status, requiredScopes ["read"]). orderId is OPTIONAL — the
    // BFF's order_status defaults to the customer's most recent order when a
    // one-click "Where's my order?" chip carries no id; replicated in the
    // handler below (orders[0], DB already returns ORDER BY date DESC so [0]
    // IS the most recent — same semantics the BFF's seed-array orders[0] had).
    name: 'order_status',
    description: 'Show the status of a retail order. Defaults to the most recent order when no orderId is given.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order ID (optional — defaults to the most recent order)' },
      },
      required: [],
    },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: ['get order details', 'check order status', 'track my order', "where's my order"],
  },
];

export { dispatchRetailTool };
