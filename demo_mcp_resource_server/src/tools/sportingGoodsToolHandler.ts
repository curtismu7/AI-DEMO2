'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('sporting-goods') as {
  orders: Array<{ id: string; [k: string]: unknown }>;
  rentals: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchSportingGoodsTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_gear_orders':
      return { orders: data.orders, count: data.orders.length };
    case 'get_gear_order': {
      const id = args.order_id as string;
      const order = data.orders.find((o) => o.id === id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown sporting-goods tool: ${toolName}`);
  }
}
