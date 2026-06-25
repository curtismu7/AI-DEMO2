import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateGatewayCerts } from '../src/mtls';

describe('generateGatewayCerts', () => {
  it('returns cert and key PEM strings', async () => {
    const writeCertTo = path.join(os.tmpdir(), `gw-test-${Date.now()}.crt`);
    const certs = await generateGatewayCerts({ writeCertTo, validityDays: 1 });
    expect(certs.clientCert).toMatch(/-----BEGIN CERTIFICATE-----/);
    expect(certs.clientKey).toMatch(/-----BEGIN/);
    expect(fs.existsSync(writeCertTo)).toBe(true);
    fs.unlinkSync(writeCertTo);
  });

  it('defaults CN to banking-mcp-gateway', async () => {
    const writeCertTo = path.join(os.tmpdir(), `gw-test-cn-${Date.now()}.crt`);
    const certs = await generateGatewayCerts({ writeCertTo });
    expect(certs.clientCert).toMatch(/-----BEGIN CERTIFICATE-----/);
    fs.unlinkSync(writeCertTo);
  });
});
