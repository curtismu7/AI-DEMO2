'use strict';

/**
 * whoami: shows the identity this server verified on the bearer token it received.
 *
 * Behind a Privilege door in Pass Agent Token mode, the gateway forwards the agent's own token (for example a
 * PingFederate JWT) instead of swapping in a gateway credential. This tool lets a demo prove that: it returns
 * the issuer, subject, actor (act) and audience of the token that reached this server, plus every claim in it. index.ts has already
 * verified the signature, issuer and audience before any tool runs, so this only reads the checked token.
 * Gated on whoami:read so it stays out of every other caller's tools/list (least privilege).
 */

import { McpToolDef } from './toolTypes';

export const IDENTITY_TOOLS: McpToolDef[] = [
  {
    name: 'whoami',
    description: 'Return the identity this server verified on the token it received: issuer, subject, actor (act), audience, scopes and every other claim. Shows which token the gateway forwarded.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['whoami:read'],
    readOnly: true,
    intentHints: ['who am I', 'which token did you receive', 'show the forwarded token', 'whoami'],
  },
];

export const IDENTITY_TOOL_NAMES = new Set(IDENTITY_TOOLS.map((t) => t.name));

function claimsOf(token: string): Record<string, unknown> {
  const payload = String(token || '').split('.')[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export async function dispatchIdentityTool(toolName: string, token: string, subject: string): Promise<unknown> {
  if (toolName !== 'whoami') throw new Error(`Unknown identity tool: ${toolName}`);
  const c = claimsOf(token);
  const scope = typeof c.scope === 'string' ? c.scope : Array.isArray(c.scope) ? c.scope.join(' ') : '';
  return {
    verifiedBy: 'mcp-resource-server',
    issuer: c.iss ?? null,
    subject,
    actor: c.act ?? null,
    audience: c.aud ?? null,
    clientId: c.client_id ?? null,
    scope,
    expiresAt: typeof c.exp === 'number' ? new Date(c.exp * 1000).toISOString() : null,
    claims: c,
  };
}
