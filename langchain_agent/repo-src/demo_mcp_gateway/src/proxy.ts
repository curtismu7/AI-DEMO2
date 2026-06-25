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

const MCP_PROTOCOL_VERSION = '2025-11-25';
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
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Proxy timeout after ${CALL_TIMEOUT_MS}ms for ${request.method}`));
    }, CALL_TIMEOUT_MS);

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
      clearTimeout(timer);
      clearTimeout(handshakeTimer);
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

      // Step 2: match the real request's id
      if (msg.id === request.id) {
        clearTimeout(timer);
        clearTimeout(handshakeTimer);
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
