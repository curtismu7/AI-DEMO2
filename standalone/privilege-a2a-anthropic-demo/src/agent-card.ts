import type { AgentCard } from '@a2a-js/sdk';

/** The analyst's Agent Card. The worker serves it; the main agent builds its client from the same definition. */
export function analystCard(url: string): AgentCard {
  return {
    protocolVersion: '0.3.0',
    name: 'analyst_agent',
    description:
      'Access-review analyst. Answers who holds which entitlements by calling the access-review MCP tools, '
      + 'then flags expired, never-used, contractor, offboarding and unrevoked break-glass access. '
      + 'Acts on behalf of the calling user; every hop carries a PingOne-issued bearer token.',
    version: '1.1.0',
    url,
    preferredTransport: 'JSONRPC',
    provider: { organization: 'Ping Identity', url: 'https://www.pingidentity.com' },
    documentationUrl: 'https://docs.pingidentity.com',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: {
      pingone: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'PingOne-issued access token for the calling user, validated at the PingOne Privilege gateway.',
      },
    },
    security: [{ pingone: [] }],
    skills: [
      {
        id: 'list_entitlements',
        name: 'User entitlements',
        description: 'List every entitlement a given user holds, with grant and last-used dates.',
        tags: ['identity', 'access', 'review', 'entitlements'],
        examples: ['What access does Maria Lopez have?', 'Show Sam Chen\'s entitlements and when each was last used.'],
      },
      {
        id: 'who_has_role',
        name: 'Role holders',
        description: 'List the users who hold a given role.',
        tags: ['identity', 'access', 'review', 'roles'],
        examples: ['Who has the admin role?', 'List everyone holding the payments-approver role.'],
      },
      {
        id: 'get_access_grants',
        name: 'Resource grants',
        description: 'List who has been granted access to a given resource, including expired and break-glass grants.',
        tags: ['identity', 'access', 'review', 'grants'],
        examples: ['Who can access the production database?', 'Are any expired grants on the payroll system still in use?'],
      },
      {
        id: 'open_ticket',
        name: 'Access tickets',
        description: 'Open an access-review ticket for a finding that needs follow-up.',
        tags: ['identity', 'access', 'review', 'ticketing'],
        examples: ['Open a ticket to revoke the contractor\'s standing access.'],
      },
    ],
  };
}
