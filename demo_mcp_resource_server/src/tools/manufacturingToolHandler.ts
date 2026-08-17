'use strict';

import { getWorkOrder, listWorkOrders } from '../db/manufacturingDb';

export async function dispatchManufacturingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'view_work_orders': {
      const workOrders = listWorkOrders();
      return { workOrders, count: workOrders.length, render: 'view_work_orders' };
    }

    case 'get_work_order': {
      const id = args.order_id as string;
      const workOrder = getWorkOrder(id);
      if (!workOrder) return { found: false, order_id: id };
      return { found: true, workOrder };
    }

    default:
      throw new Error(`Unknown manufacturing tool: ${toolName}`);
  }
}
