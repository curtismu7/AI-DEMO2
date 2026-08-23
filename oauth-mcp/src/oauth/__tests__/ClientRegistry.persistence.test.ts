import { ClientRegistry, OAuthClient } from '../ClientRegistry';
import { SigningKeyManager } from '../SigningKeyManager';
import { IEncryptedTokenStorage } from '../../storage/interfaces';
import * as crypto from 'crypto';

/** In-memory stand-in with the same contract as EncryptedTokenStorage. */
function fakeStorage(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed };
  const storage: IEncryptedTokenStorage & { data: Record<string, unknown> } = {
    data,
    store: async (k: string, v: unknown) => { data[k] = v; },
    retrieve: async (k: string) => (k in data ? data[k] : null),
    remove: async (k: string) => { delete data[k]; },
    exists: async (k: string) => k in data,
    cleanup: async () => {},
    getAllKeys: async () => Object.keys(data),
  } as never;
  return storage;
}

const DYNAMIC: OAuthClient = {
  client_id: 'dyn-1',
  client_secret: 's3cret',
  client_name: 'ChatGPT',
  grant_types: ['authorization_code'],
  redirect_uris: ['https://chatgpt.com/cb'],
  token_endpoint_auth_method: 'none',
  scope: 'mcp:invoke read',
};

describe('ClientRegistry persistence', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  it('survives a restart: a registered client is still there in a fresh registry', async () => {
    const storage = fakeStorage();

    const first = new ClientRegistry();
    first.initialize();
    await first.attachStorage(storage);
    first.registerClient(DYNAMIC);
    await new Promise((r) => setImmediate(r)); // registerClient persists fire-and-forget

    // "restart" — brand new registry, same storage
    const second = new ClientRegistry();
    second.initialize();
    await second.attachStorage(storage);

    expect(second.getClient('dyn-1')?.client_name).toBe('ChatGPT');
  });

  it('without storage the client is lost on restart (the bug this fixes)', async () => {
    const first = new ClientRegistry();
    first.initialize();
    first.registerClient(DYNAMIC);
    expect(first.getClient('dyn-1')).toBeDefined();

    const second = new ClientRegistry();
    second.initialize();
    expect(second.getClient('dyn-1')).toBeUndefined();
  });

  it('does not persist statically-configured clients — config restores those', async () => {
    const storage = fakeStorage();
    const registry = new ClientRegistry();
    registry.initialize();               // seeds mcp-inspector + privilege-cloud
    await registry.attachStorage(storage);
    registry.registerClient(DYNAMIC);
    await new Promise((r) => setImmediate(r));

    const persisted = storage.data['oauth-dynamic-clients'] as OAuthClient[];
    expect(persisted.map((c) => c.client_id)).toEqual(['dyn-1']);
  });

  it('a storage failure does not fail the registration', async () => {
    const broken = fakeStorage();
    (broken as { store: unknown }).store = async () => { throw new Error('disk full'); };
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new ClientRegistry();
    registry.initialize();
    await registry.attachStorage(broken);

    expect(() => registry.registerClient(DYNAMIC)).not.toThrow();
    expect(registry.getClient('dyn-1')).toBeDefined();
  });

  it('tolerates unreadable storage and starts empty rather than throwing', async () => {
    const broken = fakeStorage();
    (broken as { retrieve: unknown }).retrieve = async () => { throw new Error('corrupt'); };
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new ClientRegistry();
    registry.initialize();
    await expect(registry.attachStorage(broken)).resolves.toBeUndefined();
  });
});

describe('SigningKeyManager key stability', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('same PEM in, same kid out across instances (tokens survive a restart)', async () => {
    process.env.OAUTH_SIGNING_KEY_PEM = pem;
    const a = new SigningKeyManager(); await a.initialize();
    const b = new SigningKeyManager(); await b.initialize();
    expect(a.getKid()).toBe(b.getKid());
  });

  it('accepts base64-encoded PEM, since .env cannot hold newlines', async () => {
    process.env.OAUTH_SIGNING_KEY_PEM = pem;
    const raw = new SigningKeyManager(); await raw.initialize();

    process.env.OAUTH_SIGNING_KEY_PEM = Buffer.from(pem, 'utf8').toString('base64');
    const b64 = new SigningKeyManager(); await b64.initialize();

    expect(b64.getKid()).toBe(raw.getKid());
  });

  it('without the env var each instance gets a different key', async () => {
    delete process.env.OAUTH_SIGNING_KEY_PEM;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const a = new SigningKeyManager(); await a.initialize();
    const b = new SigningKeyManager(); await b.initialize();
    expect(a.getKid()).not.toBe(b.getKid());
  });
});
