'use strict';

import { McpToolDef } from './toolTypes';

export { dispatchHealthcareTool } from './healthcareToolHandler';

export const HEALTHCARE_TOOLS: McpToolDef[] = [
  {
    name: 'list_patient_records',
    description: 'List all patient records for the authenticated user, including providers, coverage type, and coverage status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['healthcare:read'],
    readOnly: true,
    intentHints: [
      'show my health records',
      'list my patient records',
      'what are my medical records',
      'show my coverage',
      'view my healthcare',
    ],
  },
  {
    name: 'get_patient_record',
    description: 'Get a single patient record by ID, including provider, coverage type, and coverage status.',
    inputSchema: {
      type: 'object',
      properties: {
        record_id: { type: 'string', description: 'Patient record ID' },
      },
      required: ['record_id'],
    },
    requiredScopes: ['healthcare:read'],
    readOnly: true,
    intentHints: [
      'show my health record',
      'get patient record details',
      'view my insurance coverage',
    ],
  },
];
