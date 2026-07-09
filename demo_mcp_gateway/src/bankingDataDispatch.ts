'use strict';

/**
 * bankingDataDispatch — shared Phase 266 Path C (oauth_bearer / bankingdata) tool dispatch.
 *
 * BL-02 (transport-parity): Path C must behave identically over WebSocket
 * (index.ts handleMessage) and HTTP POST /mcp (authorizeMcpRequest). Before this
 * module the dispatch lived only in the WS handler, so `demo_show_accounts` /
 * `demo_show_transactions` over HTTP raw-proxied to the OLB upstream →
 * "Unknown tool". Both transports call buildBankingDataToolResult().
 *
 * Credential model: forward the inbound TX bearer unchanged to
 * banking_resource_server /accounts or /transactions (no id_token, no
 * RFC 8693 re-exchange on this path).
 */

import axios from 'axios';
import type { GatewayConfig } from './config';
import { backendHttpUrl } from './router';

export interface BankingDataDispatchOk {
  ok: true;
  result: unknown;
}

export interface BankingDataDispatchErr {
  ok: false;
  code: number;
  message: string;
  data?: unknown;
}

export type BankingDataDispatchOutcome = BankingDataDispatchOk | BankingDataDispatchErr;

/**
 * Dispatch a bankingdata-disposition tool (demo_show_accounts / demo_show_transactions).
 *
 * @param toolName    tools/call name (already routed to 'bankingdata')
 * @param bearerToken inbound TX access token (forwarded unchanged)
 * @param config      GatewayConfig (bankingResourceServerBaseUrl)
 */
export async function buildBankingDataToolResult(
  toolName: string,
  bearerToken: string,
  config: GatewayConfig,
): Promise<BankingDataDispatchOutcome> {
  const url = backendHttpUrl('bankingdata', toolName, config);
  if (!url) {
    return {
      ok: false,
      code: -32500,
      message: 'bankingdata backend URL not configured',
      data: { credentialPath: 'oauth_bearer' },
    };
  }

  let resp;
  try {
    resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      timeout: 5000,
      validateStatus: (s: number) => s < 500,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[GW bankingdata] backend unreachable: ${detail} url=${url}`);
    return {
      ok: false,
      code: -32500,
      message: 'Backend route unreachable',
      data: { credentialPath: 'oauth_bearer', error: 'backend_unreachable', detail },
    };
  }

  if (resp.status === 401) {
    return {
      ok: false,
      code: -32401,
      message: 'Access token invalid',
      data: { credentialPath: 'oauth_bearer' },
    };
  }
  if (resp.status >= 400) {
    return {
      ok: false,
      code: -32500,
      message: `Backend returned ${resp.status}`,
      data: { credentialPath: 'oauth_bearer' },
    };
  }

  const base = (config.bankingResourceServerBaseUrl || '').replace(/\/$/, '');
  return {
    ok: true,
    result: {
      content: [{ type: 'text', text: JSON.stringify(resp.data) }],
      _meta: {
        credentialPath: 'oauth_bearer',
        backendRoute: base ? url.replace(base, '') : url,
      },
    },
  };
}
