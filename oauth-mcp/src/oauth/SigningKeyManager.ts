import * as crypto from 'crypto';
import * as jose from 'jose';

export interface JWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

/**
 * Manages RSA signing keys for the OAuth AS.
 * Generates a key pair on startup (or loads from env).
 */
export class SigningKeyManager {
  private privateKey!: crypto.KeyObject;
  private publicKey!: crypto.KeyObject;
  private kid!: string;

  async initialize(): Promise<void> {
    const pemEnv = process.env.OAUTH_SIGNING_KEY_PEM;
    if (pemEnv) {
      // Accept base64 as well as raw PEM: a PEM is multi-line and .env files
      // carry it badly, so the deployable form is a single base64 line. Without
      // a stable key every restart mints a new one, silently invalidating every
      // token already issued and rotating /jwks under clients that cached it.
      this.privateKey = crypto.createPrivateKey(SigningKeyManager.decodeKeyMaterial(pemEnv));
      this.publicKey = crypto.createPublicKey(this.privateKey);
    } else {
      console.warn(
        '[SigningKeyManager] OAUTH_SIGNING_KEY_PEM is unset — generating an ephemeral key. ' +
        'Every restart will invalidate all issued tokens and rotate /jwks.'
      );
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    }
    const jwk = await jose.exportJWK(this.publicKey);
    this.kid = crypto.createHash('sha256')
      .update(JSON.stringify(jwk))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Return PEM text whether the caller supplied raw PEM or base64-encoded PEM.
   * Anything that does not decode to a PEM header is passed through untouched
   * so crypto reports the real parse error rather than a confusing one.
   */
  static decodeKeyMaterial(value: string): string {
    const trimmed = value.trim();
    if (trimmed.includes('-----BEGIN')) return trimmed;
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) return decoded;
    } catch {
      // fall through
    }
    return trimmed;
  }

  getKid(): string {
    return this.kid;
  }

  getPrivateKey(): crypto.KeyObject {
    return this.privateKey;
  }

  getPublicKey(): crypto.KeyObject {
    return this.publicKey;
  }

  async getJWKS(): Promise<{ keys: JWK[] }> {
    const jwk = await jose.exportJWK(this.publicKey);
    return {
      keys: [{
        ...jwk,
        kid: this.kid,
        use: 'sig',
        alg: 'RS256',
      } as JWK],
    };
  }
}
