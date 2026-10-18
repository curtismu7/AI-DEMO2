/**
 * GET /protected/profile — a tiny REST resource protected by this resource server.
 *
 * The ID-JAG playground calls it with the access token oauth-mcp minted from an ID-JAG to show a
 * real backend accepting it, and with no token or the raw ID-JAG to show the refusals. Bearer
 * validation is the MCP tools path's own (injected `validate` = authManager.validateAgentToken,
 * `acceptedIssuers` = the transport's RFC 9207 list), reported one check at a time; checks stop
 * at the first failure, so the last entry is the one that refused.
 */
import { createHash } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentTokenInfo } from '../interfaces/auth';

/** Any one of these grants the profile: what an ID-JAG-redeemed token normally carries here
 *  (`read` is all an xaa.dev IdenX ID-JAG grants: the scope registered for our resource there). */
export const PROFILE_SCOPES = ['mcp:invoke', 'accounts:read', 'read'];

export interface ProtectedProfileDeps {
  validate: (token: string) => Promise<AgentTokenInfo>;
  acceptedIssuers: string[];
  resourceUrl: string;
}

type Check = { check: string; ok: boolean; detail: string };

function decode(token: string): { header: Record<string, unknown>; claims: Record<string, unknown> } | null {
  try {
    const [h, p] = token.split('.');
    return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(p, 'base64url').toString()) };
  } catch {
    return null;
  }
}

export async function handleProtectedProfile(req: IncomingMessage, res: ServerResponse, deps: ProtectedProfileDeps): Promise<void> {
  const verified: Check[] = [];
  const realm = `Bearer realm="Protected profile", resource_metadata="${deps.resourceUrl.replace(/\/protected\/profile$/, '')}/.well-known/oauth-protected-resource"`;
  const send = (status: number, body: Record<string, unknown>, challenge?: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(challenge ? { 'WWW-Authenticate': challenge } : {}) });
    res.end(JSON.stringify({ resource: deps.resourceUrl, verified, ...body }));
  };
  const refuse = (check: string, detail: string, error = 'invalid_token', status = 401) => {
    verified.push({ check, ok: false, detail });
    // Header values must be printable ASCII; the body keeps the full text.
    send(status, { error, error_description: detail }, `${realm}, error="${error}", error_description="${detail.replace(/"/g, "'").replace(/[^\x20-\x7e]/g, '')}"`);
  };

  const auth = String(req.headers.authorization || '');
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) {
    // RFC 6750 §3.1: no error code when the request carried no credentials.
    verified.push({ check: 'bearer', ok: false, detail: 'No Authorization: Bearer header.' });
    send(401, { error: 'unauthorized', error_description: 'A bearer access token is required.' }, realm);
    return;
  }
  verified.push({ check: 'bearer', ok: true, detail: 'Authorization: Bearer present.' });

  const d = decode(token);
  if (!d) return refuse('token type', 'Not a JWT.');
  if (d.header.typ === 'oauth-id-jag+jwt') {
    return refuse('token type', 'This is an ID-JAG (typ oauth-id-jag+jwt): a grant for the authorization server to redeem, never an access token for a resource.');
  }
  verified.push({ check: 'token type', ok: true, detail: `JWT${d.header.typ ? ` (typ ${d.header.typ})` : ''}, not an ID-JAG.` });

  // Checked before the signature: jose rejects an expired token as a failed verification.
  const exp = d.claims.exp;
  const left = typeof exp === 'number' ? exp - Math.floor(Date.now() / 1000) : null;
  if (left !== null && left <= 0) return refuse('expiry', `Expired ${-left} s ago.`);
  verified.push({ check: 'expiry', ok: true, detail: left === null ? 'No exp claim.' : `${left} s left.` });

  let info: AgentTokenInfo;
  try {
    info = await deps.validate(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refuse(/aud/i.test(msg) ? 'audience' : 'signature', msg);
  }
  if (!info.signatureVerified || !info.verifiedClaims) return refuse('signature', 'The signature could not be verified against the issuer\'s keys.');
  const c = info.verifiedClaims as Record<string, unknown>;
  verified.push({ check: 'signature', ok: true, detail: 'Verified against the issuer\'s published keys.' });
  verified.push({ check: 'audience', ok: true, detail: `aud ${JSON.stringify(c.aud)} is this resource server.` });

  if (!deps.acceptedIssuers.includes(String(c.iss))) return refuse('issuer', `iss ${String(c.iss)} is not an issuer this resource server trusts (RFC 9207).`);
  verified.push({ check: 'issuer', ok: true, detail: `iss ${String(c.iss)} is trusted.` });

  const scope = Array.isArray(c.scope) ? c.scope.join(' ') : String(c.scope || '');
  const granted = PROFILE_SCOPES.filter((s) => scope.split(/\s+/).includes(s));
  if (!granted.length) {
    verified.push({ check: 'scope', ok: false, detail: `Needs one of ${PROFILE_SCOPES.join(', ')}; the token has "${scope || '(none)'}".` });
    send(403, { error: 'insufficient_scope', error_description: `Requires one of: ${PROFILE_SCOPES.join(' ')}` },
      `${realm}, error="insufficient_scope", scope="${PROFILE_SCOPES.join(' ')}"`);
    return;
  }
  verified.push({ check: 'scope', ok: true, detail: `Has ${granted.join(', ')}.` });

  const sub = String(c.sub || '');
  send(200, {
    principal: { sub, client_id: c.client_id ?? null, scope },
    // Sample record, the same for every vertical: what this backend shows only to a verified bearer.
    data: {
      profileId: `prf-${createHash('sha256').update(sub).digest('hex').slice(0, 8)}`,
      subject: sub,
      status: 'active',
      plan: 'Standard',
      servedBy: 'oauth-mcp resource server',
      servedAt: new Date().toISOString(),
    },
  });
}
