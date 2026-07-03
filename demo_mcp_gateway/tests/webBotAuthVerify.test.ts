'use strict';

/**
 * Web Bot Auth (draft-meunier-web-bot-auth-architecture profile of RFC 9421)
 * verifier tests — full profile: Signature-Agent directory lookup, Ed25519
 * verification, created/expires window, tag=web-bot-auth, nonce replay.
 *
 * The underlying canonicalization/crypto is separately validated against the
 * RFC 9421 Appendix B vectors in httpMessageSignature.test.ts.
 */

import * as crypto from 'crypto';
import { jwkThumbprint } from '../src/httpMessageSignature';
import { verifyWebBotAuth, DIRECTORY_PATH, _resetWbaCachesForTest } from '../src/webBotAuthVerify';

const AGENT_ORIGIN = 'https://agent.ping.demo';
const AUTHORITY = 'gateway.ping.demo:3005';

// ── Test agent key + signer (mirrors the BFF-side signer format) ────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
const KEYID = jwkThumbprint(publicJwk);

function signHeaders(opts: {
  authority?: string;
  agent?: string;
  created?: number;
  expires?: number;
  nonce?: string;
  tag?: string;
  keyid?: string;
  key?: crypto.KeyObject;
  label?: string;
} = {}): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const authority = opts.authority ?? AUTHORITY;
  const agentValue = `"${opts.agent ?? AGENT_ORIGIN}"`;
  const created = opts.created ?? now;
  const expires = opts.expires ?? now + 300;
  const nonce = opts.nonce ?? crypto.randomBytes(32).toString('base64');
  const tag = opts.tag ?? 'web-bot-auth';
  const keyid = opts.keyid ?? KEYID;
  const label = opts.label ?? 'sig1';
  const params =
    `("@authority" "signature-agent");created=${created};expires=${expires}` +
    `;keyid="${keyid}";nonce="${nonce}";tag="${tag}"`;
  const base =
    `"@authority": ${authority.toLowerCase()}\n` +
    `"signature-agent": ${agentValue}\n` +
    `"@signature-params": ${params}`;
  const sig = crypto.sign(null, Buffer.from(base, 'utf-8'), opts.key ?? privateKey);
  return {
    host: authority,
    'signature-agent': agentValue,
    'signature-input': `${label}=${params}`,
    signature: `${label}=:${sig.toString('base64')}:`,
  };
}

const fetchJwks = jest.fn(async (_url: string) => ({ keys: [publicJwk] }));

function verify(headers: Record<string, string>, extra: Record<string, unknown> = {}) {
  return verifyWebBotAuth({
    headers,
    method: 'POST',
    path: '/mcp',
    fetchJwks,
    ...extra,
  });
}

beforeEach(() => {
  _resetWbaCachesForTest();
  fetchJwks.mockClear();
});

describe('verifyWebBotAuth — happy path', () => {
  it('verifies a correctly signed request and resolves the key via the directory', async () => {
    const r = await verify(signHeaders());
    expect(r.reason).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.keyid).toBe(KEYID);
    expect(r.signatureAgent).toBe(AGENT_ORIGIN);
    expect(fetchJwks).toHaveBeenCalledWith(`${AGENT_ORIGIN}${DIRECTORY_PATH}`);
  });

  it('caches the JWKS directory between verifications', async () => {
    await verify(signHeaders());
    await verify(signHeaders());
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });
});

describe('verifyWebBotAuth — missing/invalid material', () => {
  it('fails when unsigned (no headers at all)', async () => {
    const r = await verify({ host: AUTHORITY });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signature-agent/i);
  });

  it('fails when Signature-Input is missing', async () => {
    const h = signHeaders();
    delete (h as Record<string, string | undefined>)['signature-input'];
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signature-input/i);
  });

  it('fails when no signature is tagged web-bot-auth', async () => {
    const r = await verify(signHeaders({ tag: 'other-tag' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/web-bot-auth/);
  });

  it('fails when the covered components omit @authority', async () => {
    const h = signHeaders();
    // Re-label the inner list without @authority (signature will not match either,
    // but the component check must fire first with a precise reason).
    h['signature-input'] = h['signature-input'].replace('("@authority" "signature-agent")', '("signature-agent")');
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/@authority/);
  });

  it('fails when the keyid is not in the agent directory', async () => {
    const r = await verify(signHeaders({ keyid: 'unknown-key-thumbprint' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/keyid|key/i);
  });

  it('fails when the directory fetch errors', async () => {
    fetchJwks.mockRejectedValueOnce(new Error('boom'));
    const r = await verify(signHeaders());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/directory/i);
  });

  it('fails on a tampered signature', async () => {
    const h = signHeaders();
    // Flip a byte in the signature byte-sequence.
    h.signature = h.signature.replace(/:(.)/, (_, c: string) => `:${c === 'A' ? 'B' : 'A'}`);
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signature/i);
  });

  it('fails when the authority differs from what was signed (stolen headers)', async () => {
    const h = signHeaders({ authority: 'other-host.example' });
    h.host = AUTHORITY; // message actually targets the gateway
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/signature/i);
  });
});

describe('verifyWebBotAuth — time window + replay', () => {
  it('fails when the signature has expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verify(signHeaders({ created: now - 600, expires: now - 300 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expired/i);
  });

  it('fails when created is in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verify(signHeaders({ created: now + 600, expires: now + 900 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/future/i);
  });

  it('fails when the signature lifetime is implausibly long', async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await verify(signHeaders({ created: now, expires: now + 24 * 3600 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lifetime/i);
  });

  it('rejects a replayed nonce', async () => {
    const h = signHeaders();
    expect((await verify(h)).ok).toBe(true);
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/replay/i);
  });

  it('fails when the nonce param is absent', async () => {
    const h = signHeaders();
    // Strip the nonce param from both the params and re-sign is impossible here;
    // instead build headers manually without nonce.
    const now = Math.floor(Date.now() / 1000);
    const params = `("@authority" "signature-agent");created=${now};expires=${now + 300};keyid="${KEYID}";tag="web-bot-auth"`;
    const base = `"@authority": ${AUTHORITY.toLowerCase()}\n"signature-agent": "${AGENT_ORIGIN}"\n"@signature-params": ${params}`;
    const sig = crypto.sign(null, Buffer.from(base), privateKey);
    h['signature-input'] = `sig1=${params}`;
    h.signature = `sig1=:${sig.toString('base64')}:`;
    const r = await verify(h);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/nonce/i);
  });
});
