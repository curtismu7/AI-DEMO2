'use strict';
import { getOrder, listOrders } from '../db/retailDb';

export async function dispatchRetailTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_orders': {
      const orders = listOrders();
      return { orders, count: orders.length, render: 'list_orders' };
    }
    case 'order_status': {
      // orderId optional — defaults to the most recent order (listOrders is
      // already ORDER BY date DESC, so [0] is that order). Flat, not
      // {found,order} nested: matches the BFF's order_status shape exactly
      // (result: order), which the manifest's descriptor paths expect.
      const orderId = args.orderId as string | undefined;
      const order = orderId ? getOrder(orderId) : (listOrders()[0] ?? null);
      if (!order) return { error: 'order not found' };
      return { ...order, render: 'order_status' };
    }
    default:
      throw new Error(`Unknown retail tool: ${toolName}`);
  }
}
