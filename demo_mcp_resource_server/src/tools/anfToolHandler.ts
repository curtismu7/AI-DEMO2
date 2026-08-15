'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('abercrombie-fitch') as {
  orders: Array<{ id: string; [k: string]: unknown }>;
  products: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchAnfTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_anf_orders':
      return { orders: data.orders, count: data.orders.length };
    case 'get_anf_order': {
      const id = args.order_id as string;
      const order = data.orders.find((o) => o.id === id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown ANF tool: ${toolName}`);
  }
}
