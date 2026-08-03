import * as tls from 'tls';
import * as crypto from 'crypto';

export type MtlsVerifier = (socket: tls.TLSSocket) => void;

export interface MtlsVerifierOptions {
  enabled: boolean;
  gatewayCertPem: string;
}

function certFingerprint(pemCert: string): string {
  const der = Buffer.from(
    pemCert
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s/g, ''),
    'base64',
  );
  return crypto.createHash('sha256').update(der).digest('hex');
}

export function createMtlsVerifier(opts: MtlsVerifierOptions): MtlsVerifier | null {
  if (!opts.enabled) return null;
  if (!opts.gatewayCertPem) {
    throw new Error('MCP_MTLS_ENABLED=true but no gateway cert found at MCP_MTLS_GATEWAY_CERT_PATH');
  }

  const expectedFingerprint = certFingerprint(opts.gatewayCertPem);

  return (socket: tls.TLSSocket): void => {
    const peerCert = socket.getPeerCertificate();
    if (!peerCert || !peerCert.raw) {
      throw new Error('mTLS: no client certificate presented');
    }
    const actualFingerprint = crypto.createHash('sha256').update(peerCert.raw).digest('hex');
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error('mTLS: client certificate does not match pinned gateway cert');
    }
  };
}
