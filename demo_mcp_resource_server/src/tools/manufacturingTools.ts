'use strict';

import { McpToolDef } from './toolTypes';

export { dispatchManufacturingTool } from './manufacturingToolHandler';

export const MANUFACTURING_TOOLS: McpToolDef[] = [
  {
    name: 'list_work_orders',
    description: 'List open work orders for the authenticated user, including status, inventory value, and scheduled shipments.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['manufacturing:read'],
    readOnly: true,
    intentHints: [
      'show my work orders',
      'list work orders',
      'what work orders are open',
      'show production orders',
      'view manufacturing orders',
    ],
  },
  {
    name: 'get_work_order',
    description: 'Get a single work order by ID with full production details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Work order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['manufacturing:read'],
    readOnly: true,
    intentHints: [
      'get work order details',
      'show work order status',
      'check production order',
    ],
  },
];
