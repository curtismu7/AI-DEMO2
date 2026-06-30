/**
 * Step Details Data Array
 * Defines expandable step details for OAuth Token Exchange flow
 * Each step shows: number, title, timestamp, status, and expanded details
 */

export const STEP_DETAILS = [
  {
    id: 'step-1-receive-user-token',
    number: 1,
    title: 'BFF receives user token',
    timestamp: 'immediate',
    status: 'active',
    summary: 'Customer signs in with PingOne OAuth',
    expandedContent: {
      what: 'PingOne issues a customer access token (subject token) after successful authentication. This token is stored in an httpOnly cookie on the BFF server.',
      httpRequest: {
        method: 'POST',
        endpoint: '/oauth/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic [client_id:client_secret]'
        },
        body: {
          grant_type: 'authorization_code',
          code: '[auth_code]',
          redirect_uri: 'https://banking.example.com/callback',
          code_verifier: '[pkce_verifier]'
        }
      },
      httpResponse: {
        status: 200,
        body: {
          access_token: 'eyJhbGc...[JWT]...XdE',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read write openid profile'
        }
      },
      tokenStructure: {
        type: 'JWT (RFC 7519)',
        role: 'Subject Token (RFC 8693 §3.1)',
        claims: {
          sub: 'user-id-12345',
          iss: 'https://auth.pingone.com/[env-id]/as',
          aud: 'client-id-banking-app',
          iat: 1719700000,
          exp: 1719703600,
          scope: 'read write openid profile',
          client_id: 'client-id-banking-app',
          auth_time: 1719699900,
          sid: 'session-id-xyz'
        }
      },
      validationChecks: [
        { label: 'Signature valid', status: 'pass', detail: 'Token signed by PingOne private key' },
        { label: 'Not expired', status: 'pass', detail: 'exp > current time' },
        { label: 'iss matches', status: 'pass', detail: 'iss points to trusted PingOne AS' },
        { label: 'aud matches', status: 'pass', detail: 'aud is this BFF client_id' }
      ],
      warnings: []
    }
  },
  {
    id: 'step-2-exchange-token',
    number: 2,
    title: 'RFC 8693 Token Exchange',
    timestamp: 'on agent action',
    status: 'active',
    summary: 'BFF requests MCP-scoped access token via Token Exchange',
    expandedContent: {
      what: 'The BFF calls PingOne Token Exchange (RFC 8693 §2.1) to request a new token scoped to the MCP resource. The user token (subject_token) is exchanged for a narrower MCP token with an act claim (delegated token).',
      httpRequest: {
        method: 'POST',
        endpoint: '/oauth/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic [bff-client-id:bff-client-secret]'
        },
        body: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: '[user-access-token]',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          resource: 'mcp-server',
          scope: 'read',
          requested_token_use: 'access_token'
        }
      },
      httpResponse: {
        status: 200,
        body: {
          access_token: 'eyJhbGc...[NEW JWT]...XdE',
          token_type: 'Bearer',
          expires_in: 1800,
          scope: 'read',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token'
        }
      },
      tokenStructure: {
        type: 'JWT (RFC 7519)',
        role: 'Delegated Token (RFC 8693 §4)',
        claims: {
          sub: 'user-id-12345',
          act: 'client-id-bff',
          iss: 'https://auth.pingone.com/[env-id]/as',
          aud: 'mcp-server',
          iat: 1719700100,
          exp: 1719701900,
          scope: 'read',
          client_id: 'client-id-bff',
          may_act: 'client-id-bff'
        }
      },
      validationChecks: [
        { label: 'Exchange grant valid', status: 'pass', detail: 'grant_type = urn:ietf:params:oauth:grant-type:token-exchange' },
        { label: 'BFF authorized', status: 'pass', detail: 'BFF client_id has token exchange scope' },
        { label: 'Scope narrowed', status: 'pass', detail: 'Requested scope (read) ⊆ subject token scope (read write)' },
        { label: 'act claim set', status: 'pass', detail: 'act = client-id-bff proves delegation' },
        { label: 'Audience changed', status: 'pass', detail: 'aud changed from banking-app to mcp-server' }
      ],
      warnings: []
    }
  },
  {
    id: 'step-3-bind-audience',
    number: 3,
    title: 'RFC 8707 Audience binding',
    timestamp: 'in Token Exchange',
    status: 'done',
    summary: 'Token locked to mcp-server audience only',
    expandedContent: {
      what: 'RFC 8707 Resource Indicators ensure the exchanged token is bound to a single resource (aud = mcp-server). This prevents token reuse on unintended services. The resource parameter in the Token Exchange request drives this binding.',
      httpRequest: {
        method: 'POST',
        endpoint: '/oauth/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: '[user-access-token]',
          resource: 'mcp-server',
          scope: 'read'
        }
      },
      httpResponse: {
        status: 200,
        body: {
          access_token: 'eyJhbGc...[TOKEN with aud=mcp-server]...XdE',
          scope: 'read'
        }
      },
      tokenStructure: {
        type: 'JWT (RFC 7519 §4.1.3 + RFC 8707)',
        role: 'Resource-bound Token',
        claims: {
          sub: 'user-id-12345',
          act: 'client-id-bff',
          aud: 'mcp-server',
          iss: 'https://auth.pingone.com/[env-id]/as',
          scope: 'read'
        }
      },
      validationChecks: [
        { label: 'aud is single string', status: 'pass', detail: 'aud = "mcp-server" (not array)' },
        { label: 'Resource param honored', status: 'pass', detail: 'aud matches resource param from request' },
        { label: 'Cannot reuse elsewhere', status: 'pass', detail: 'MCP server will reject if aud != "mcp-server"' }
      ],
      warnings: [
        { level: 'info', text: 'RFC 8707 is stronger than separate access tokens—each resource gets its own instance, not a shared token' }
      ]
    }
  },
  {
    id: 'step-4-scope-narrowing',
    number: 4,
    title: 'RFC 6749 §3.3 Scope narrowing',
    timestamp: 'in Token Exchange',
    status: 'done',
    summary: 'Only required scopes survive the exchange',
    expandedContent: {
      what: 'RFC 6749 §3.3 and RFC 8693 §2.1 mandate that Token Exchange cannot grant scopes the subject token doesn\'t already have. If the user token has scopes [read, write] but we request only [read], the MCP token receives only [read].',
      httpRequest: {
        method: 'POST',
        endpoint: '/oauth/token',
        body: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: '[user-token with scope=read write]',
          scope: 'read'
        }
      },
      httpResponse: {
        status: 200,
        body: {
          access_token: '[token with scope=read]',
          scope: 'read'
        }
      },
      tokenStructure: {
        type: 'Scope claim in JWT',
        role: 'Authorization boundary',
        claims: {
          scope: 'read',
          description: 'Space-delimited as per RFC 6749 §3.3'
        }
      },
      validationChecks: [
        { label: 'Requested scope ⊆ subject scope', status: 'pass', detail: '[read] ⊆ [read write]' },
        { label: 'No scope grant', status: 'pass', detail: 'Exchange cannot add scopes not in subject token' },
        { label: 'MCP tool allowed by scope', status: 'pass', detail: 'Requested tool requires scope=read' }
      ],
      warnings: [
        { level: 'warning', text: 'If requested scope includes scopes not in subject token, Token Exchange fails with invalid_scope' }
      ]
    }
  }
];
