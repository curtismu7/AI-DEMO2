'use strict';
import { getAnfOrder, listAnfOrders } from '../db/abercrombieDb';

export async function dispatchAnfTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_anf_orders': {
      const orders = listAnfOrders();
      return { orders, count: orders.length, render: 'list_anf_orders' };
    }
    case 'get_anf_order': {
      const id = args.order_id as string;
      const order = getAnfOrder(id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown ANF tool: ${toolName}`);
  }
}
