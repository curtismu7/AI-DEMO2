'use strict';

import { loadMockData } from '../shared/mockData';

const data = loadMockData('manufacturing') as {
  heroStats: Record<string, unknown>;
};

export async function dispatchManufacturingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_work_orders':
      return {
        workOrders: [],
        count: 0,
        summary: data.heroStats,
      };

    case 'get_work_order': {
      const id = args.order_id as string;
      return { found: false, order_id: id };
    }

    default:
      throw new Error(`Unknown manufacturing tool: ${toolName}`);
  }
}
