'use strict';

import { McpToolDef } from './toolTypes';

export { dispatchGovernmentTool } from './governmentToolHandler';

export const GOVERNMENT_TOOLS: McpToolDef[] = [
  {
    // Named to match the chip-facing tool scope-topology.json already declares
    // (tools.view_permits, requiredScopes ["read"]) — same pattern as
    // healthcare's view_records (see router.ts HEALTHCARE_TOOLS comment).
    name: 'view_permits',
    description: 'List all government permits for the authenticated user, including permit type, subject, status, and expiration date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: [
      'show my permits',
      'list my government permits',
      'what permits do I have',
      'view my licenses',
      'show permit status',
    ],
  },
  {
    name: 'get_permit',
    description: 'Get a single government permit by ID, including permit type, subject, status, and expiration date.',
    inputSchema: {
      type: 'object',
      properties: {
        permit_id: { type: 'string', description: 'Permit ID' },
      },
      required: ['permit_id'],
    },
    requiredScopes: ['government:read'],
    readOnly: true,
    intentHints: [
      'get permit details',
      'show permit information',
      'check permit status',
    ],
  },
];
