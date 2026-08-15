'use strict';

import { getPatientRecord, listPatientRecords } from '../db/healthcareDb';

export async function dispatchHealthcareTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_patient_records': {
      const records = listPatientRecords();
      return { records, count: records.length };
    }

    case 'get_patient_record': {
      const id = args.record_id as string;
      const record = getPatientRecord(id);
      if (!record) return { found: false, record_id: id };
      return { found: true, record };
    }

    default:
      throw new Error(`Unknown healthcare tool: ${toolName}`);
  }
}
