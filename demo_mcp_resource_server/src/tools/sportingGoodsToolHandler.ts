'use strict';
import { listOrders, getOrder } from '../db/sportingGoodsDb';

export async function dispatchSportingGoodsTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_gear': {
      const orders = listOrders();
      return { orders, count: orders.length, render: 'list_gear' };
    }
    case 'gear_order_status': {
      const orderId = args.orderId as string | undefined;
      const order = orderId ? getOrder(orderId) : (listOrders()[0] ?? null);
      if (!order) return { error: 'order not found' };
      return { ...order, render: 'gear_order_status' };
    }
    default:
      throw new Error(`Unknown sporting-goods tool: ${toolName}`);
  }
}
