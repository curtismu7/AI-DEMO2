'use strict';
import { getOrder, listOrders } from '../db/retailDb';

export async function dispatchRetailTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_orders': {
      const orders = listOrders();
      return { orders, count: orders.length };
    }
    case 'get_order': {
      const id = args.order_id as string;
      const order = getOrder(id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown retail tool: ${toolName}`);
  }
}
