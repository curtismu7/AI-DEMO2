'use strict';

/**
 * mtls.ts — self-signed mTLS cert generation for the gateway (dev-only).
 *
 * Generates a CA + client cert keypair at startup. The gateway uses the client
 * cert when connecting to MCP servers (mTLS). MCP servers pin the gateway's
 * client cert (read from MCP_MTLS_GATEWAY_CERT_PATH) and reject connections
 * that don't present it.
 *
 * All certs are in-memory; the client cert PEM is optionally written to disk
 * so MCP servers can read it at startup.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generate } from 'selfsigned';

export interface GatewayCerts {
  clientCert: string;  // PEM-encoded client certificate
  clientKey: string;   // PEM-encoded client private key
}

export interface GenerateCertsOptions {
  writeCertTo?: string;  // path to write client cert PEM (default: /tmp/gw-client.crt)
  commonName?: string;   // CN for the client cert (default: 'banking-mcp-gateway')
  validityDays?: number; // cert validity in days (default: 1)
}

/**
 * Generate a self-signed client certificate for gateway → MCP server mTLS.
 *
 * Uses the `selfsigned` package (Node crypto + x509 extension support).
 * Writes the client cert PEM to `writeCertTo` so MCP servers can pin it.
 */
export async function generateGatewayCerts(opts?: GenerateCertsOptions): Promise<GatewayCerts> {
  const commonName = opts?.commonName ?? 'banking-mcp-gateway';
  const validityDays = opts?.validityDays ?? 1;
  const writeCertTo = opts?.writeCertTo ?? '/tmp/gw-client.crt';

  const attrs = [{ name: 'commonName', value: commonName }];
  const certOptions = {
    days: validityDays,
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false } as const,
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true } as const,
      { name: 'extKeyUsage', clientAuth: true } as const,
    ],
  };

  const pems = await generate(attrs, certOptions);

  const clientCert: string = pems.cert;
  const clientKey: string = pems.private;

  // Write client cert to disk for MCP server to pin
  const certDir = path.dirname(writeCertTo);
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  fs.writeFileSync(writeCertTo, clientCert, 'utf-8');

  return { clientCert, clientKey };
}
