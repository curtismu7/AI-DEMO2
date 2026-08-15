'use strict';

/**
 * JSON-RPC proxy: forward a single request to a backend MCP server over WebSocket.
 *
 * Opens a fresh WebSocket connection per request (stateless proxy model — no
 * persistent connection pool needed for demo scale; add pooling for production).
 *
 * Protocol: MCP 2025-11-25 handshake (initialize → notifications/initialized → method → close).
 */

import * as https from 'https';
import WebSocket from 'ws';
import axios from 'axios';
import { getCorrelationId } from './correlationContext';

export interface MtlsOptions {
  cert: string; // PEM client certificate
  key: string;  // PEM client private key
}

export function buildUpstreamHeaders(
  backendToken: string,
  xTratContext: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${backendToken}` };
  if (xTratContext) headers['X-TraT-Context'] = xTratContext;
  return headers;
}

export const MCP_PROTOCOL_VERSION = '2025-11-25';
const HANDSHAKE_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = parseInt(process.env.GW_TOOL_CALL_TIMEOUT_MS || '30000', 10);

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function proxyJsonRpc(
  backendWsUrl: string,
  backendToken: string,
  request: JsonRpcRequest,
  xTratContext?: string,
  tlsOptions?: MtlsOptions,
  // MCP spec: called for each interim notifications/progress frame the
  // backend emits while the call is in flight (a notification, so it has no
  // `id` and would otherwise never match the final-response check below and
  // be silently dropped). Not called for the final response.
  onProgress?: (params: unknown) => void,
  // MCP spec: notifications/cancelled. Aborting terminates the backend
  // connection and rejects with a distinguishable { code: 'cancelled' }
  // error instead of waiting out CALL_TIMEOUT_MS.
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    // Guards every settle path against acting twice (e.g. an abort() that
    // races the final response) — resolve/reject themselves are idempotent,
    // but ws.terminate() on an already-closed socket is not something to do
    // twice, and the abort listener must know not to fire post-settle.
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      ws.terminate();
      reject(new Error(`Proxy timeout after ${CALL_TIMEOUT_MS}ms for ${request.method}`));
    }, CALL_TIMEOUT_MS);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(handshakeTimer);
      ws.terminate();
      reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }));
    };
    signal?.addEventListener('abort', onAbort);

    const wsOptions: WebSocket.ClientOptions = {
      headers: buildUpstreamHeaders(backendToken, xTratContext),
    };
    if (tlsOptions) {
      wsOptions.agent = new https.Agent({
        cert: tlsOptions.cert,
        key: tlsOptions.key,
        rejectUnauthorized: false, // dev-only: accept self-signed server cert
      });
    }
    const ws = new WebSocket(backendWsUrl, wsOptions);

    let initialized = false;
    // WR-04: capture the handshake timer so it can be cleared on every
    // settle path. Without this, each proxied call leaves a dangling 10s
    // timer + closure over ws/reject alive until it fires (resource leak
    // proportional to request volume; avoidable late-terminate race).
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    ws.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(handshakeTimer);
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    ws.on('open', () => {
      // MCP handshake: initialize
      const _cid = getCorrelationId();
      const initParams: Record<string, unknown> = {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'banking-mcp-gateway', version: '1.0.0' },
      };
      if (_cid) initParams.correlationId = _cid;
      const initMsg = {
        jsonrpc: '2.0',
        id: 'gw-init',
        method: 'initialize',
        params: initParams,
      };
      ws.send(JSON.stringify(initMsg));

      // Handshake timeout guard
      handshakeTimer = setTimeout(() => {
        if (!initialized) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          ws.terminate();
          reject(new Error('MCP handshake timeout'));
        }
      }, HANDSHAKE_TIMEOUT_MS);
    });

    ws.on('message', (raw) => {
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Step 1: handle initialize response → send notifications/initialized → send real request
      if (!initialized && msg.id === 'gw-init') {
        initialized = true;
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));
        const _cid2 = getCorrelationId();
        let outRequest: JsonRpcRequest = request;
        if (_cid2 && request.params !== undefined) {
          const existingParams = request.params as Record<string, unknown>;
          if (!existingParams.correlationId) {
            outRequest = { ...request, params: { ...existingParams, correlationId: _cid2 } };
          }
        } else if (_cid2 && request.params === undefined) {
          outRequest = { ...request, params: { correlationId: _cid2 } as unknown };
        }
        ws.send(JSON.stringify(outRequest));
        return;
      }

      // Step 1b: an interim notifications/progress frame — no `id`, so it
      // would never match Step 2 below. Forward it and keep waiting.
      if (msg.id === undefined && (msg as unknown as { method?: string }).method === 'notifications/progress') {
        onProgress?.((msg as unknown as { params?: unknown }).params);
        return;
      }

      // Step 2: match the real request's id
      if (msg.id === request.id) {
        settled = true;
        clearTimeout(timer);
        clearTimeout(handshakeTimer);
        signal?.removeEventListener('abort', onAbort);
        ws.close();
        resolve(msg);
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      clearTimeout(handshakeTimer);
    });
  });
}

const MCP_SESSION_HEADER = 'mcp-session-id';
const MCP_PROTO_HEADER = 'mcp-protocol-version';

/**
 * JSON-RPC proxy: forward a single request to a backend MCP server over
 * Streamable HTTP (MCP 2025-11-25 §Streamable HTTP), for backends that speak
 * HTTP instead of WebSocket (e.g. demo_mcp_jwt_verifier / FastMCP). Mirrors
 * proxyJsonRpc's WS handshake (initialize → notifications/initialized →
 * method) so it's a drop-in HTTP sibling with the same request/response
 * contract.
 */
export async function proxyJsonRpcHttp(
  backendHttpUrl: string,
  backendToken: string,
  request: JsonRpcRequest,
  xTratContext?: string,
): Promise<JsonRpcResponse> {
  const upstreamUrl = `${backendHttpUrl.replace(/\/$/, '')}/mcp`;
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${backendToken}`,
    [MCP_PROTO_HEADER]: MCP_PROTOCOL_VERSION,
  };
  if (xTratContext) baseHeaders['X-TraT-Context'] = xTratContext;

  const _cid = getCorrelationId();
  const initParams: Record<string, unknown> = {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'banking-mcp-gateway', version: '1.0.0' },
  };
  if (_cid) initParams.correlationId = _cid;

  const initResp = await axios.post(
    upstreamUrl,
    JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', method: 'initialize', params: initParams }),
    { headers: baseHeaders, timeout: HANDSHAKE_TIMEOUT_MS, validateStatus: () => true },
  );

  const headers = { ...baseHeaders };
  const sessionId = initResp.headers[MCP_SESSION_HEADER] as string | undefined;
  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
    await axios.post(
      upstreamUrl,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      { headers, timeout: HANDSHAKE_TIMEOUT_MS, validateStatus: () => true },
    );
  }

  let outRequest: JsonRpcRequest = request;
  if (_cid) {
    const existingParams = (request.params as Record<string, unknown>) || {};
    if (!existingParams.correlationId) {
      outRequest = { ...request, params: { ...existingParams, correlationId: _cid } };
    }
  }

  const response = await axios.post(upstreamUrl, JSON.stringify(outRequest), {
    headers,
    timeout: CALL_TIMEOUT_MS,
    validateStatus: () => true,
  });
  return response.data as JsonRpcResponse;
}
