import * as crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

/**
 * Encryption utilities for secure token storage
 */
export class EncryptionUtils {
  private static readonly ALGORITHM = 'aes-256-cbc';
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  /**
   * Derives a key from a password using scrypt
   */
  private static async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return (await scryptAsync(password, salt, EncryptionUtils.KEY_LENGTH)) as Buffer;
  }

  /**
   * Encrypts data using AES-256-CBC
   */
  static async encrypt(data: string, password: string): Promise<string> {
    try {
      const salt = crypto.randomBytes(EncryptionUtils.SALT_LENGTH);
      const iv = crypto.randomBytes(EncryptionUtils.IV_LENGTH);
      const key = await EncryptionUtils.deriveKey(password, salt);

      const cipher = crypto.createCipheriv(EncryptionUtils.ALGORITHM, key, iv);

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Combine salt, iv, and encrypted data
      const result = Buffer.concat([
        salt,
        iv,
        Buffer.from(encrypted, 'hex')
      ]);

      return result.toString('base64');
    } catch (error) {
      throw Object.assign(new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  /**
   * Decrypts data using AES-256-CBC
   */
  static async decrypt(encryptedData: string, password: string): Promise<string> {
    try {
      const data = Buffer.from(encryptedData, 'base64');
      
      // Extract components
      const salt = data.subarray(0, EncryptionUtils.SALT_LENGTH);
      const iv = data.subarray(EncryptionUtils.SALT_LENGTH, EncryptionUtils.SALT_LENGTH + EncryptionUtils.IV_LENGTH);
      const encrypted = data.subarray(EncryptionUtils.SALT_LENGTH + EncryptionUtils.IV_LENGTH);

      const key = await EncryptionUtils.deriveKey(password, salt);

      const decipher = crypto.createDecipheriv(EncryptionUtils.ALGORITHM, key, iv);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw Object.assign(new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
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
    return key.length >= 32; // Minimum 32 characters for security
  }
}