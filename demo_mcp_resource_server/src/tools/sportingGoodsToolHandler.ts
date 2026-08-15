'use strict';
import { listOrders, getOrder } from '../db/sportingGoodsDb';

export async function dispatchSportingGoodsTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_gear_orders': {
      const orders = listOrders();
      return { orders, count: orders.length };
    }
    case 'get_gear_order': {
      const id = args.order_id as string;
      const order = getOrder(id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown sporting-goods tool: ${toolName}`);
  }
}
