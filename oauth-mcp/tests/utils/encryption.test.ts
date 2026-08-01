import { EncryptionUtils } from '../../src/utils/encryption';

describe('EncryptionUtils', () => {
  const testPassword = 'test-encryption-key-with-sufficient-length';
  const testData = 'sensitive-token-data-to-encrypt';

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt data successfully', async () => {
      const encrypted = await EncryptionUtils.encrypt(testData, testPassword);
      const decrypted = await EncryptionUtils.decrypt(encrypted, testPassword);
      
      expect(decrypted).toBe(testData);
    });

    it('should produce different encrypted output for same input', async () => {
      const encrypted1 = await EncryptionUtils.encrypt(testData, testPassword);
      const encrypted2 = await EncryptionUtils.encrypt(testData, testPassword);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail to decrypt with wrong password', async () => {
      const encrypted = await EncryptionUtils.encrypt(testData, testPassword);
      
      await expect(
        EncryptionUtils.decrypt(encrypted, 'wrong-password')
      ).rejects.toThrow('Decryption failed');
    });

    it('should fail to decrypt corrupted data', async () => {
      const encrypted = await EncryptionUtils.encrypt(testData, testPassword);
      const corrupted = encrypted.slice(0, -10) + 'corrupted';
      
      await expect(
        EncryptionUtils.decrypt(corrupted, testPassword)
      ).rejects.toThrow('Decryption failed');
    });

    it('should handle empty string encryption', async () => {
      const encrypted = await EncryptionUtils.encrypt('', testPassword);
      const decrypted = await EncryptionUtils.decrypt(encrypted, testPassword);
      
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', async () => {
      const unicodeData = '🔐 Secure token with émojis and spëcial chars 中文';
      const encrypted = await EncryptionUtils.encrypt(unicodeData, testPassword);
      const decrypted = await EncryptionUtils.decrypt(encrypted, testPassword);
      
      expect(decrypted).toBe(unicodeData);
    });
  });

  describe('hashToken', () => {
    it('should create consistent hash for same token', () => {
      const token = 'test-token-123';
      const hash1 = EncryptionUtils.hashToken(token);
      const hash2 = EncryptionUtils.hashToken(token);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 character hex string
    });

    it('should create different hashes for different tokens', () => {
      const token1 = 'test-token-123';
      const token2 = 'test-token-456';
      
      const hash1 = EncryptionUtils.hashToken(token1);
      const hash2 = EncryptionUtils.hashToken(token2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty token', () => {
      const hash = EncryptionUtils.hashToken('');
      expect(hash).toHaveLength(64);
    });
  });

  describe('generateSecureRandom', () => {
    it('should generate random string of default length', () => {
      const random = EncryptionUtils.generateSecureRandom();
      expect(random).toHaveLength(64); // 32 bytes = 64 hex characters
    });

    it('should generate random string of specified length', () => {
      const random = EncryptionUtils.generateSecureRandom(16);
      expect(random).toHaveLength(32); // 16 bytes = 32 hex characters
    });

    it('should generate different random strings', () => {
      const random1 = EncryptionUtils.generateSecureRandom();
      const random2 = EncryptionUtils.generateSecureRandom();
      
      expect(random1).not.toBe(random2);
    });
  });

  describe('validateEncryptionKey', () => {
    it('should validate key with sufficient length', () => {
      const validKey = 'this-is-a-valid-encryption-key-with-32-plus-characters';
      expect(EncryptionUtils.validateEncryptionKey(validKey)).toBe(true);
    });

    it('should reject key with insufficient length', () => {
      const shortKey = 'short-key';
      expect(EncryptionUtils.validateEncryptionKey(shortKey)).toBe(false);
    });

    it('should validate key with exactly 32 characters', () => {
      const exactKey = '12345678901234567890123456789012'; // exactly 32 chars
      expect(EncryptionUtils.validateEncryptionKey(exactKey)).toBe(true);
    });

    it('should reject empty key', () => {
      expect(EncryptionUtils.validateEncryptionKey('')).toBe(false);
    });
  });
});