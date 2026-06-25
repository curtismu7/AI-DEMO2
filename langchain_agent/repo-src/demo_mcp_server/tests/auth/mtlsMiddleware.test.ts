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
});
