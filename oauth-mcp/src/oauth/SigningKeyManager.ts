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
      this.privateKey = crypto.createPrivateKey(pemEnv);
      this.publicKey = crypto.createPublicKey(this.privateKey);
    } else {
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
