'use strict';

/**
 * dualTokenDispatch — shared Phase 266 Path B (dual_token disposition) tool dispatch.
 *
 * BL-02 (transport-parity): Path B must behave identically over WebSocket
 * (index.ts handleMessage) and HTTP POST /mcp (authorizeMcpRequest). Before this
 * module the dispatch lived only in the WS handler, so `user_profile_card` over
 * HTTP raw-proxied to the OLB upstream → "Unknown tool". Both transports call
 * buildDualTokenToolResult() and render the JSON-RPC envelope natively.
 *
 * Credential model: forward the inbound TX bearer unchanged + attach the OIDC
 * id_token (fetched server-to-server from the BFF) in the JSON-RPC body to
 * banking_resource_server /identity. No RFC 8693 re-exchange on this path.
 */

import axios from 'axios';
import type { GatewayConfig } from './config';
import { backendHttpUrl } from './router';

export interface DualTokenDispatchOk {
  ok: true;
  result: unknown;
}

export interface DualTokenDispatchErr {
  ok: false;
  code: number;
  message: string;
  data?: unknown;
}

export type DualTokenDispatchOutcome = DualTokenDispatchOk | DualTokenDispatchErr;

/**
 * Fetch the user's id_token from the BFF (server-to-server only).
 * Returns null when the session has no id_token (404/412/503).
 */
export async function fetchIdTokenFromBff(
  subjectSub: string,
  config: GatewayConfig,
): Promise<string | null> {
  const resp = await axios.get(config.bffInternalIdTokenUrl, {
    headers: {
      'x-internal-gateway-secret': config.bffInternalSecret,
      'x-subject-sub': subjectSub,
    },
    timeout: 3000,
    validateStatus: (s) => s < 500,
  });
  if (resp.status === 404 || resp.status === 412 || resp.status === 503) return null;
  if (resp.status !== 200) throw new Error(`BFF id_token fetch returned ${resp.status}`);
  return resp.data?.idToken || null;
}

/**
 * Dispatch a dual_token-disposition tool (user_profile_card).
 *
 * @param toolName   tools/call name (already routed to 'dualtoken')
 * @param bearerToken inbound TX access token (forwarded unchanged)
 * @param userSub    decoded.sub — used to fetch id_token from BFF
 * @param config     GatewayConfig (bankingResourceServerBaseUrl, BFF bridge)
 */
export async function buildDualTokenToolResult(
  toolName: string,
  bearerToken: string,
  userSub: string,
  config: GatewayConfig,
): Promise<DualTokenDispatchOutcome> {
  let idToken: string | null = null;
  try {
    idToken = await fetchIdTokenFromBff(userSub, config);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[GW dual_token] id_token fetch failed: ${detail} url=${config.bffInternalIdTokenUrl}`);
    return {
      ok: false,
      code: -32500,
      message: 'Failed to retrieve id_token from BFF',
      data: { credentialPath: 'dual_token', error: 'id_token_fetch_failed', detail },
    };
  }
  if (!idToken) {
    return {
      ok: false,
      code: -32412,
      message: 'id_token missing — sign in again with openid scope',
      data: { credentialPath: 'dual_token', error: 'id_token_missing' },
    };
  }

  const url = backendHttpUrl('dualtoken', toolName, config);
  if (!url) {
    return {
      ok: false,
      code: -32500,
      message: 'dual_token backend URL not configured',
      data: { credentialPath: 'dual_token' },
    };
  }

  let identityResp;
  try {
    identityResp = await axios.post(
      url,
      {
        jsonrpc: '2.0',
        method: 'identity.show',
        params: { idToken },
        id: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
        validateStatus: (s: number) => s < 500,
      },
    );
  } catch {
    return {
      ok: false,
      code: -32500,
      message: 'Backend identity route unreachable',
      data: { credentialPath: 'dual_token' },
    };
  }

  if (identityResp.status === 401) {
    return {
      ok: false,
      code: -32401,
      message: 'Access token invalid',
      data: { credentialPath: 'dual_token' },
    };
  }
  if (identityResp.status === 412) {
    return {
      ok: false,
      code: -32412,
      message: 'id_token missing — sign in with openid scope',
      data: { credentialPath: 'dual_token', error: 'id_token_missing' },
    };
  }
  if (identityResp.status >= 400) {
    return {
      ok: false,
      code: -32500,
      message: `Backend returned ${identityResp.status}`,
      data: { credentialPath: 'dual_token' },
    };
  }

  return {
    ok: true,
    result: {
      content: [{ type: 'text', text: JSON.stringify(identityResp.data) }],
      structuredContent: identityResp.data,
      _meta: {
        credentialPath: 'dual_token',
        idTokenAttached: true,
        accessTokenAttached: true,
        infoPageHint: '/path/dualtoken-info',
        backendRoute: '/api/resource-server/identity',
        resourceRequest: {
          method: 'POST',
          url: url,
          path: '/api/resource-server/identity',
          headers: {
            Authorization: 'Bearer [redacted]',
            'Content-Type': 'application/json',
          },
          body: {
            jsonrpc: '2.0',
            method: 'identity.show',
            params: { idToken: '[redacted]' },
          },
          note: 'Dual-token: access bearer in Authorization + id_token in JSON-RPC body.',
        },
        note: 'Gateway forwarded bearer (Authorization header) + id_token (JSON-RPC params body) to banking_resource_server /identity.',
        tokenEvents: [
          {
            id: 'evt-inbound',
            label: 'Inbound user bearer received (aud=AI-agent-resource, sub=user, act=upstream-agent)',
            tokenType: 'access_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'RFC 6750 §3',
          },
          {
            id: 'evt-idtoken-fetch',
            label: 'id_token fetched from BFF session (server-to-server, OIDC identity assertion)',
            tokenType: 'id_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'OIDC Core §3.1.3.7',
          },
          {
            id: 'gw-passthrough',
            label: 'Gateway passthrough: TX token forwarded unchanged to banking_resource_server — no re-exchange (mTLS enforces gateway passage)',
            tokenType: 'access_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'RFC 8693 — exchange skipped by design',
          },
          {
            id: 'evt-forward',
            label: 'Outbound POST to banking_resource_server /identity: original bearer (Authorization) + id_token (params.idToken)',
            tokenType: 'access_token+id_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'JSON-RPC 2.0 + RFC 6750 §3.1',
          },
          {
            id: 'evt-bearer-validated',
            label: 'banking_resource_server: bearer aud + signature validated (authenticateToken middleware via JWKS)',
            tokenType: 'access_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'RFC 7515/7517/8414/7662 + RFC 8707 audience binding',
          },
          {
            id: 'evt-idtoken-decoded',
            label: 'banking_resource_server: id_token sub matched against access_token sub; decoded server-side; sanitized claims returned',
            tokenType: 'id_token',
            credentialPath: 'dual_token',
            status: 'ok',
            specRef: 'OIDC Core §3.1.3.7 + custody policy',
          },
        ],
      },
    },
  };
}
