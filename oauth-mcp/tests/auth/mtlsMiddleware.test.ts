import { createMtlsVerifier, MtlsVerifier } from '../../src/auth/mtlsMiddleware';

const FAKE_GATEWAY_CERT = `-----BEGIN CERTIFICATE-----
MIIBpTCCAQ6gAwIBAgIJAKFakeTestCert
-----END CERTIFICATE-----`;

describe('createMtlsVerifier', () => {
  it('returns null when disabled', () => {
    const verifier = createMtlsVerifier({ enabled: false, gatewayCertPem: '' });
    expect(verifier).toBeNull();
  });

  it('throws when enabled but gatewayCertPem is empty', () => {
    expect(() => createMtlsVerifier({ enabled: true, gatewayCertPem: '' }))
      .toThrow('MCP_MTLS_ENABLED=true but no gateway cert found');
  });

  it('returns a verifier function when enabled with a cert', () => {
    const verifier = createMtlsVerifier({ enabled: true, gatewayCertPem: FAKE_GATEWAY_CERT });
    expect(typeof verifier).toBe('function');
  });

  it('verifier rejects when no client cert presented', () => {
    const verifier = createMtlsVerifier({ enabled: true, gatewayCertPem: FAKE_GATEWAY_CERT }) as MtlsVerifier;
    const fakeSocket = { getPeerCertificate: () => ({}) } as any;
    expect(() => verifier(fakeSocket)).toThrow('mTLS: no client certificate presented');
  });

  // ── SPIFFE Phase D: comma-separated SPIFFE ID list + trust-bundle chaining ──

  it('accepts a comma-separated allowedSpiffeId list on a URI-SAN match (no bundle configured)', () => {
    const verifier = createMtlsVerifier({
      enabled: true,
      allowedSpiffeId: 'spiffe://bxfinance.demo/mcp-gateway,spiffe://bxfinance.demo/bff',
    }) as MtlsVerifier;
    const fakeSocket = {
      getPeerCertificate: () => ({
        raw: Buffer.from('irrelevant'),
        subjectaltname: 'URI:spiffe://bxfinance.demo/bff',
      }),
    } as any;
    expect(() => verifier(fakeSocket)).not.toThrow();
  });

  it('rejects a cert whose URI SAN is not in the allowed list', () => {
    const verifier = createMtlsVerifier({
      enabled: true,
      allowedSpiffeId: 'spiffe://bxfinance.demo/mcp-gateway,spiffe://bxfinance.demo/bff',
    }) as MtlsVerifier;
    const fakeSocket = {
      getPeerCertificate: () => ({
        raw: Buffer.from('irrelevant'),
        subjectaltname: 'URI:spiffe://other.domain/rogue',
      }),
    } as any;
    expect(() => verifier(fakeSocket)).toThrow('not for spiffe://');
  });


});
