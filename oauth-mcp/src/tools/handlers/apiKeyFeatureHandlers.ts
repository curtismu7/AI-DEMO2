import axios from 'axios';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

/**
 * api_key-disposition feature tools, executed by the MCP server itself.
 *
 * On the normal chain the demo MCP gateway intercepts these by name and does
 * the credential swap (drops the OAuth bearer, calls the backend with a
 * service API key) — see demo_mcp_gateway/src/apiKeyDispatch.ts. On a
 * gateway-less hop (the Privilege/Procyon AI Gateway client talks straight to
 * this server) the registry still advertises them, so this module performs the
 * same swap here: the resolved OAuth token is ignored and the backend is
 * called with X-API-Key only. Scope enforcement already happened upstream
 * (transport bearer validation, or the external gateway on the open-access hop).
 *
 * Route map mirrors APIKEY_BACKEND_ROUTES in demo_mcp_gateway/src/router.ts —
 * that file is the source of truth; keep the two in sync when adding a tool.
 */
const APIKEY_FEATURE_ROUTES: Record<string, string> = {
  show_mortgage:       'mortgage',
  show_investment:     'invest',
  show_large_purchase: 'retail',
  show_health_record:  'healthcare',
  show_gear_order:     'gear',
  show_gear_warranty:  'gearWarranty',
  show_expense_report: 'expense',
  show_permit:         'permit',
  show_enrollment:     'enrollment',
  show_work_order:     'workOrder',
};

function handlerNameFor(toolName: string): string {
  const camel = toolName.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  return `execute${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function makeApiKeyFeatureHandler(toolName: string): HandlerFn {
  return async (deps, _token, _params) => {
    // show_investment lives on the invest resource server with its own key;
    // every other feature record is served by the demo data service.
    const isInvest = toolName === 'show_investment';
    const base = isInvest
      ? (process.env.MCP_RESOURCE_SERVER_HTTP_URL || 'http://localhost:8081')
      : (process.env.API_RESOURCE_SERVER_URL || 'http://localhost:8082');
    const apiKey = (isInvest
      ? (process.env.DEMO_MCP_RESOURCE_SERVER_KEY || process.env.DEMO_API_RESOURCE_SERVER_KEY)
      : process.env.DEMO_API_RESOURCE_SERVER_KEY) || '';
    const url = `${base}/${APIKEY_FEATURE_ROUTES[toolName]}`;

    deps.logger.info(`[ApiKeyFeature] ${toolName}: service API key call to ${url} (OAuth bearer dropped)`);
    let resp;
    try {
      resp = await axios.get(url, {
        headers: { 'X-API-Key': apiKey },
        timeout: 5000,
        validateStatus: (s: number) => s < 500,
      });
    } catch {
      return createErrorResult(`${toolName} backend unreachable at ${url}`);
    }
    if (resp.status === 401) {
      return createErrorResult(`${toolName} backend rejected the service API key`);
    }
    if (resp.status >= 400) {
      return createErrorResult(`${toolName} backend returned ${resp.status}`);
    }
    return createSuccessResult(JSON.stringify(resp.data, null, 2), resp.data);
  };
}

/** handler-name → HandlerFn for every api_key feature tool (e.g. executeShowHealthRecord). */
export const apiKeyFeatureHandlerMap: Record<string, HandlerFn> = Object.keys(APIKEY_FEATURE_ROUTES).reduce(
  (acc, toolName) => {
    acc[handlerNameFor(toolName)] = makeApiKeyFeatureHandler(toolName);
    return acc;
  },
  {} as Record<string, HandlerFn>,
);
