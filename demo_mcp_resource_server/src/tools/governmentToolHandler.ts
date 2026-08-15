'use strict';

import { getPermit, listPermits } from '../db/governmentDb';

export async function dispatchGovernmentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_permits': {
      const permits = listPermits();
      return { permits, count: permits.length };
    }

    case 'get_permit': {
      const id = args.permit_id as string;
      const permit = getPermit(id);
      if (!permit) return { found: false, permit_id: id };
      return { found: true, permit };
    }

    default:
      throw new Error(`Unknown government tool: ${toolName}`);
  }
}
