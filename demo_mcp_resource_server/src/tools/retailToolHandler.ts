'use strict';
import { getOrder, insertOrder, listOrders } from '../db/retailDb';

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
    case 'checkout': {
      // Defaults mirror the BFF's checkout exactly: a consent-showcase chip may
      // carry no product or amount, and the consent control still has to run
      // against a real order. An amount-carrying policy chip (UC6/7/8) keeps
      // its amount.
      const product = typeof args.product === 'string' && args.product.trim() ? args.product.trim() : 'Headphones';
      const amount = typeof args.amount === 'number' ? args.amount : 100;
      const order = insertOrder({ product, amount });
      // Flat, like order_status above — the BFF returns `result: order`, and
      // the manifest's checkout descriptor reads the order's own fields.
      return { ...order, render: 'checkout' };
    }
    default:
      throw new Error(`Unknown retail tool: ${toolName}`);
  }
}
