'use strict';

import { loadMockData } from '../shared/mockData';

const data = loadMockData('government') as {
  permits: Array<{ id: string; [k: string]: unknown }>;
  filings: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchGovernmentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_permits':
      return { permits: data.permits, count: data.permits.length };

    case 'get_permit': {
      const id = args.permit_id as string;
      const permit = data.permits.find((p) => p.id === id);
      if (!permit) return { found: false, permit_id: id };
      return { found: true, permit };
    }

    default:
      throw new Error(`Unknown government tool: ${toolName}`);
  }
}
