import * as tls from 'tls';
import * as crypto from 'crypto';

export type MtlsVerifier = (socket: tls.TLSSocket) => void;

export interface MtlsVerifierOptions {
  enabled: boolean;
  gatewayCertPem?: string;
  allowedSpiffeId?: string;
  /** SPIRE trust bundle PEM. When set with allowedSpiffeId, the peer cert must
   * chain to the SPIRE CA (attested identity, not just a self-asserted URI). */
  spiffeBundlePem?: string;
}

/** Accepts one id or a comma-separated list ("spiffe://a,spiffe://b"). */
function allowedSpiffeIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function derToPem(der: Buffer): string {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
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
  if (!opts.gatewayCertPem && !opts.allowedSpiffeId) {
    throw new Error('MCP_MTLS_ENABLED=true but no gateway cert found at MCP_MTLS_GATEWAY_CERT_PATH');
  }

  const expectedFingerprint = opts.gatewayCertPem ? certFingerprint(opts.gatewayCertPem) : null;
  const spiffeBundleCerts = (opts.spiffeBundlePem ?? '')
    .split(/(?=-----BEGIN CERTIFICATE-----)/)
    .map((p) => p.trim())
    .filter((p) => p.includes('-----BEGIN CERTIFICATE-----'))
    .map((p) => new crypto.X509Certificate(p));

  /** True when the peer cert chains to (and is currently valid per) the SPIRE
   * trust bundle — the SPIFFE attestation step, beyond a bare URI SAN match. */
  function chainsToSpiffeBundle(peerPem: string): boolean {
    if (spiffeBundleCerts.length === 0) return false;
    try {
      const leaf = new crypto.X509Certificate(peerPem);
      const now = Date.now();
      if (leaf.validFromDate.getTime() > now || leaf.validToDate.getTime() < now) return false;
      return spiffeBundleCerts.some((ca) => leaf.verify(ca.publicKey));
    } catch {
      return false;
    }
  }

  return (socket: tls.TLSSocket): void => {
    const peerCert = socket.getPeerCertificate();
    if (!peerCert || !peerCert.raw) {
      throw new Error('mTLS: no client certificate presented');
    }
    const actualFingerprint = crypto.createHash('sha256').update(peerCert.raw).digest('hex');
    if (expectedFingerprint && actualFingerprint === expectedFingerprint) return;
    const spiffeIds = allowedSpiffeIds(opts.allowedSpiffeId);
    if (spiffeIds.length > 0 && typeof peerCert.subjectaltname === 'string') {
      const uris = peerCert.subjectaltname.split(',').map((part) => part.trim().replace(/^URI:/, ''));
      if (uris.some((u) => spiffeIds.includes(u))) {
        if (spiffeBundleCerts.length > 0 && !chainsToSpiffeBundle(derToPem(peerCert.raw))) {
          throw new Error('mTLS: client certificate does not chain to the SPIRE trust bundle');
        }
        return;
      }
    }
    if (!expectedFingerprint && spiffeIds.length > 0) {
      throw new Error(`mTLS: client certificate is not for ${spiffeIds.join(' or ')}`);
    }
    if (expectedFingerprint) {
      throw new Error('mTLS: client certificate does not match pinned gateway cert');
    }
  };
}
