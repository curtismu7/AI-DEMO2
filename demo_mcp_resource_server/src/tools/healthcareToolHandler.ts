'use strict';

import { getPatientRecord, listPatientRecords } from '../db/healthcareDb';

export async function dispatchHealthcareTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'view_records': {
      const records = listPatientRecords();
      // render keyed by tool name — same convention airlinesToolHandler
      // documents: the BFF's manifest.json descriptor is keyed "view_records".
      return { records, count: records.length, render: 'view_records' };
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
