import * as crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

// Ciphertext format version byte. Legacy CBC data has no version prefix
// (first byte is a random salt byte); 0x01 marks GCM format.
const VERSION_GCM = 0x01;

/**
 * Encryption utilities for secure token storage
 */
export class EncryptionUtils {
  private static readonly KEY_LENGTH = 32;
  private static readonly SALT_LENGTH = 32;
  // GCM: 12-byte IV is the NIST-recommended size.
  private static readonly GCM_IV_LENGTH = 12;
  private static readonly GCM_AUTH_TAG_LENGTH = 16;
  // Legacy CBC constants — decrypt only, no new CBC is written.
  private static readonly CBC_IV_LENGTH = 16;

  private static async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return (await scryptAsync(password, salt, EncryptionUtils.KEY_LENGTH)) as Buffer;
  }

  /**
   * Encrypts data using AES-256-GCM.
   * Layout: [0x01][salt(32)][iv(12)][authTag(16)][ciphertext] → base64
   */
  static async encrypt(data: string, password: string): Promise<string> {
    try {
      const salt = crypto.randomBytes(EncryptionUtils.SALT_LENGTH);
      const iv = crypto.randomBytes(EncryptionUtils.GCM_IV_LENGTH);
      const key = await EncryptionUtils.deriveKey(password, salt);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return Buffer.concat([
        Buffer.from([VERSION_GCM]),
        salt,
        iv,
        authTag,
        encrypted,
      ]).toString('base64');
    } catch (error) {
      throw Object.assign(new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  /**
   * Decrypts data. Handles both GCM (version 0x01) and legacy CBC ciphertext.
   * New writes always use GCM; CBC support is read-only for migration.
   */
  static async decrypt(encryptedData: string, password: string): Promise<string> {
    try {
      const buf = Buffer.from(encryptedData, 'base64');

      if (buf[0] === VERSION_GCM) {
        return await EncryptionUtils._decryptGcm(buf, password);
      }
      // Legacy CBC path — existing sessions written before this change.
      return await EncryptionUtils._decryptCbc(buf, password);
    } catch (error) {
      throw Object.assign(new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  private static async _decryptGcm(buf: Buffer, password: string): Promise<string> {
    // Skip version byte, then: salt | iv | authTag | ciphertext
    const salt = buf.subarray(1, 1 + EncryptionUtils.SALT_LENGTH);
    const iv = buf.subarray(1 + EncryptionUtils.SALT_LENGTH, 1 + EncryptionUtils.SALT_LENGTH + EncryptionUtils.GCM_IV_LENGTH);
    const authTag = buf.subarray(
      1 + EncryptionUtils.SALT_LENGTH + EncryptionUtils.GCM_IV_LENGTH,
      1 + EncryptionUtils.SALT_LENGTH + EncryptionUtils.GCM_IV_LENGTH + EncryptionUtils.GCM_AUTH_TAG_LENGTH,
    );
    const ciphertext = buf.subarray(1 + EncryptionUtils.SALT_LENGTH + EncryptionUtils.GCM_IV_LENGTH + EncryptionUtils.GCM_AUTH_TAG_LENGTH);

    const key = await EncryptionUtils.deriveKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  private static async _decryptCbc(buf: Buffer, password: string): Promise<string> {
    const salt = buf.subarray(0, EncryptionUtils.SALT_LENGTH);
    const iv = buf.subarray(EncryptionUtils.SALT_LENGTH, EncryptionUtils.SALT_LENGTH + EncryptionUtils.CBC_IV_LENGTH);
    const ciphertext = buf.subarray(EncryptionUtils.SALT_LENGTH + EncryptionUtils.CBC_IV_LENGTH);
    const key = await EncryptionUtils.deriveKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Creates a secure hash of a token for storage/comparison
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a cryptographically secure random string
   */
  static generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Validates that a password meets minimum security requirements
   */
  static validateEncryptionKey(key: string): boolean {
    return key.length >= 32;
  }
}
