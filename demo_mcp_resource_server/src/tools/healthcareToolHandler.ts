'use strict';

import { loadMockData } from '../shared/mockData';

const data = loadMockData('healthcare') as {
  patientRecords: Array<{ id: string; [k: string]: unknown }>;
  billingHistory: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchHealthcareTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_patient_records':
      return { records: data.patientRecords, count: data.patientRecords.length };

    case 'get_patient_record': {
      const id = args.record_id as string;
      const record = data.patientRecords.find((r) => r.id === id);
      if (!record) return { found: false, record_id: id };
      return { found: true, record };
    }

    default:
      throw new Error(`Unknown healthcare tool: ${toolName}`);
  }
}
