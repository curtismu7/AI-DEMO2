'use strict';

/**
 * apiKeyDispatch — shared Phase 267 Path A (api_key disposition) tool dispatch.
 *
 * BL-02 (transport-parity): the api_key disposition must behave identically
 * whether the request arrived over WebSocket (index.ts handleMessage) or
 * HTTP POST /mcp (middleware/authorizeMcpRequest.ts). Before this module the
 * dispatch was inlined in the WS handler only, so a tool like `show_mortgage`
 * routed correctly over WS but the HTTP path raw-proxied it to the OLB
 * upstream → "Unknown tool". This is the single source of that dispatch;
 * both transports call buildApiKeyToolResult() and render the JSON-RPC
 * envelope in their transport-native way.
 *
 * Scope enforcement is NOT done here — it is an Authorize-layer decision that
 * already ran (guardToolCall on WS / runMcpAuthorizationPipeline on HTTP)
 * before dispatch. By the time we reach here the scope check has passed.
 */

import axios from 'axios';
import type { GatewayConfig } from './config';
import { backendHttpUrl, APIKEY_BACKEND_ROUTES } from './router';
import { getScopesForGatewayTool } from './auth/toolScopes';

export interface ApiKeyDispatchOk {
  ok: true;
  /** JSON-RPC `result` object to return to the caller. */
  result: unknown;
}

export interface ApiKeyDispatchErr {
  ok: false;
  /** JSON-RPC error code (e.g. -32500 / -32401). */
  code: number;
  message: string;
  data?: unknown;
}

export type ApiKeyDispatchOutcome = ApiKeyDispatchOk | ApiKeyDispatchErr;

/** Per-tool metadata for Token Chain events and error messages. */
interface ToolMeta {
  /** Short service name shown in Token Chain events (e.g. 'banking_mortgage_service'). */
  serviceLabel: string;
  /** Route segment on the backend (e.g. 'mortgage'). */
  routeSegment: string;
  /** UI info page hint. */
  infoPageHint: string;
  /** Human-readable tool display name for error messages. */
  displayName: string;
}

/** Display names for each api_key-disposition tool (for error messages and Token Chain). */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  show_mortgage:       'Mortgage Account',
  show_health_record:  'Health Record',
  show_gear_order:     'Gear Order',
  show_expense_report: 'Expense Report',
  show_large_purchase: 'Large Purchase',
  show_permit:         'Permit Status',
  show_enrollment:     'Enrollment Status',
  show_work_order:     'Work Order Status',
};

function getToolMeta(toolName: string): ToolMeta {
  const routeSegment = APIKEY_BACKEND_ROUTES[toolName] ?? toolName;
  const infoPageHint = routeSegment === 'mortgage' ? '/path/mortgage' : '/path/feature';
  return {
    serviceLabel: 'demo_data_service',
    routeSegment,
    infoPageHint,
    displayName: TOOL_DISPLAY_NAMES[toolName] ?? toolName,
  };
}

/**
 * Dispatch an api_key-disposition tool.
 *
 * Phase 267: if the tool maps to a real backend URL the gateway DROPS the
 * OAuth bearer and calls the backend with X-API-Key + X-User-Sub — the
 * credential swap IS the demo. Otherwise it returns the Phase 266 Gateway-only
 * marker (no backend call).
 *
 * @param toolName             the tools/call tool name (already routed to 'apikey')
 * @param userSub              decoded.sub of the inbound user token
 * @param apiKeyMaskedLast4    last4 of the service key (Token Chain display only)
 * @param config               GatewayConfig (mortgageServiceBaseUrl / ApiKey)
 */
export async function buildApiKeyToolResult(
  toolName: string,
  userSub: string,
  apiKeyMaskedLast4: string | undefined,
  config: GatewayConfig,
): Promise<ApiKeyDispatchOutcome> {
  const last4 = apiKeyMaskedLast4 || 'XXXX';
  const backendUrl = backendHttpUrl('apikey', toolName, config);
  const meta = getToolMeta(toolName);

  // Phase 266 Gateway-only marker — apikey tool with no real backend.
  if (!backendUrl) {
    return {
      ok: true,
      result: {
        content: [{ type: 'text', text: 'API_KEY_PATH_MARKER' }],
        _meta: {
          credentialPath: 'api_key',
          apiKeyMaskedLast4: last4,
          infoPageHint: '/path/apikey-info',
          note: 'Gateway swapped your OAuth token for a service API key. No backend was called.',
          tokenEvents: [
            {
              id: 'evt-inbound',
              label: 'Inbound user bearer received',
              tokenType: 'access_token',
              credentialPath: 'api_key',
              status: 'ok',
            },
            {
              id: 'evt-swap',
              label: 'Gateway swap: OAuth bearer dropped, service API key attached',
              tokenType: 'api_key',
              maskedValue: `...${last4}`,
              credentialPath: 'api_key',
              status: 'ok',
            },
          ],
        },
      },
    };
  }

  // Phase 267 — real backend dispatch via X-API-Key (OAuth bearer dropped).
  let mResp;
  try {
    mResp = await axios.get(backendUrl, {
      headers: {
        'X-API-Key': config.mortgageServiceApiKey,
        'X-User-Sub': userSub,
      },
      timeout: 5000,
      validateStatus: (s: number) => s < 500,
    });
  } catch {
    return { ok: false, code: -32500, message: `${meta.displayName} backend unreachable`, data: { credentialPath: 'api_key' } };
  }
  if (mResp.status === 401) {
    return { ok: false, code: -32401, message: `${meta.displayName} backend rejected the service API key`, data: { credentialPath: 'api_key' } };
  }
  if (mResp.status >= 400) {
    return { ok: false, code: -32500, message: `${meta.displayName} backend returned ${mResp.status}`, data: { credentialPath: 'api_key' } };
  }

  return {
    ok: true,
    result: {
      content: [{ type: 'text', text: JSON.stringify(mResp.data) }],
      _meta: {
        credentialPath: 'api_key',
        apiKeyMaskedLast4: last4,
        maskedApiKey: `xxxx${last4}`,
        backend: meta.serviceLabel,
        infoPageHint: meta.infoPageHint,
        note: `Gateway dropped your OAuth bearer, attached a service API key, and called ${meta.serviceLabel} /${meta.routeSegment} (X-API-Key + X-User-Sub).`,
        tokenEvents: [
          {
            id: 'evt-inbound',
            label: 'Inbound user bearer received (aud=AI-agent-resource, sub=user)',
            tokenType: 'access_token',
            credentialPath: 'api_key',
            status: 'ok',
            specRef: 'RFC 6750 §3',
          },
          {
            id: 'evt-scope',
            label: `Authorize PERMIT: ${getScopesForGatewayTool(toolName).join(', ')} present on the user bearer (scope decision before credential swap)`,
            tokenType: 'access_token',
            credentialPath: 'api_key',
            status: 'ok',
          },
          {
            id: 'evt-swap',
            label: 'Gateway swap: OAuth bearer dropped, service API key attached',
            tokenType: 'api_key',
            maskedValue: `...${last4}`,
            credentialPath: 'api_key',
            status: 'ok',
          },
          {
            id: 'evt-backend',
            label: `Outbound GET ${meta.serviceLabel} /${meta.routeSegment} (X-API-Key + X-User-Sub, no OAuth)`,
            tokenType: 'api_key',
            credentialPath: 'api_key',
            status: 'ok',
          },
        ],
      },
    },
  };
}
