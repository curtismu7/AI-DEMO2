/**
 * The registry fetch over a REAL TLS socket: it must send the shared bearer,
 * verify the BFF's certificate (no rejectUnauthorized:false), and keep the last
 * good list when TLS or auth fails.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { refreshRegistry, resetTrustedIdpsForTests, trustedIdps } from '../IdJagTrustedIdps';

const IDP = { id: 'okta', issuer: 'https://x.okta.com', jwksUrl: 'https://x.okta.com/keys', clientAliases: {}, scopes: '' };

let dir: string;
let server: https.Server;
let status = 200;
let seenAuth: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idjag-reg-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')],
  { stdio: 'ignore' });
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
    (req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { idps: [IDP] } : { error: 'unauthorized' }));
    });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.ENTERPRISE_IDP_REGISTRY_URL = `https://localhost:${(server.address() as AddressInfo).port}/registry`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ENTERPRISE_IDP_REGISTRY_URL;
});

beforeEach(() => {
  resetTrustedIdpsForTests();
  delete process.env.ENTERPRISE_IDP_ISSUER;
  delete process.env.ENTERPRISE_IDP_JWKS_URL;
  process.env.ID_JAG_REGISTRY_TOKEN = 'test-registry-token';
  process.env.ID_JAG_REGISTRY_CA_FILE = path.join(dir, 'cert.pem');
  status = 200;
  seenAuth = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.ID_JAG_REGISTRY_TOKEN;
  delete process.env.ID_JAG_REGISTRY_CA_FILE;
});

it('sends the bearer and trusts the pinned CA file', async () => {
  await refreshRegistry();
  expect(seenAuth).toBe('Bearer test-registry-token');
  expect(trustedIdps().map((i) => i.id)).toEqual(['okta']);
});

it('refuses an unverifiable certificate (no CA pinned, self-signed) and trusts nobody', async () => {
  delete process.env.ID_JAG_REGISTRY_CA_FILE;
  await refreshRegistry();
  expect(seenAuth).toBeUndefined(); // the request never got past the handshake
  expect(trustedIdps()).toEqual([]);
  expect(String((console.warn as jest.Mock).mock.calls[0][0])).toMatch(/self[- ]signed/i);
});

it('keeps the last good list on a TLS failure or a 401', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  await refreshRegistry();
  expect(trustedIdps()).toHaveLength(1);

  jest.setSystemTime(Date.now() + 60_000);
  status = 401;
  await refreshRegistry();
  expect(seenAuth).toBe('Bearer test-registry-token');
  expect(trustedIdps().map((i) => i.id)).toEqual(['okta']);

  jest.setSystemTime(Date.now() + 60_000);
  status = 200;
  delete process.env.ID_JAG_REGISTRY_CA_FILE;
  await refreshRegistry();
  expect(trustedIdps().map((i) => i.id)).toEqual(['okta']);
});
