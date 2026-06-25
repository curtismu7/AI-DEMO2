import * as fs from 'fs/promises';
import * as path from 'path';
import { EncryptedTokenStorage } from '../../src/storage/EncryptedTokenStorage';

describe('EncryptedTokenStorage', () => {
  const testStoragePath = path.join(__dirname, 'test-storage');
  const testEncryptionKey = 'test-encryption-key-with-sufficient-length-for-security';
  let storage: EncryptedTokenStorage;

  beforeEach(async () => {
    storage = new EncryptedTokenStorage(testStoragePath, testEncryptionKey);
    
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  describe('constructor', () => {
    it('should create storage with valid encryption key', () => {
      expect(() => new EncryptedTokenStorage(testStoragePath, testEncryptionKey)).not.toThrow();
    });

    it('should throw error with invalid encryption key', () => {
      expect(() => new EncryptedTokenStorage(testStoragePath, 'short')).toThrow('Encryption key must be at least 32 characters long');
    });
  });

  describe('basic operations', () => {
    it('should store and retrieve data', async () => {
      const testData = { token: 'test-token', userId: '123' };
      
      await storage.store('test-key', testData);
      const retrieved = await storage.retrieve('test-key');
      
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', async () => {
      const result = await storage.retrieve('non-existent');
      expect(result).toBeNull();
    });

    it('should check if key exists', async () => {
      await storage.store('test-key', 'test-data');
      
      expect(await storage.exists('test-key')).toBe(true);
      expect(await storage.exists('non-existent')).toBe(false);
    });

    it('should remove data', async () => {
      await storage.store('test-key', 'test-data');
      await storage.remove('test-key');
      
      expect(await storage.retrieve('test-key')).toBeNull();
      expect(await storage.exists('test-key')).toBe(false);
    });

    it('should handle removal of non-existent keys gracefully', async () => {
      await expect(storage.remove('non-existent')).resolves.not.toThrow();
    });
  });

  describe('data encryption', () => {
    it('should encrypt data on disk', async () => {
      const testData = { secret: 'sensitive-information' };
      await storage.store('test-key', testData);
      
      // Read raw file content
      const files = await fs.readdir(testStoragePath);
      expect(files.length).toBe(1);
      
      const rawContent = await fs.readFile(path.join(testStoragePath, files[0]), 'utf8');
      
      // Raw content should not contain the original data
      expect(rawContent).not.toContain('sensitive-information');
      expect(rawContent).not.toContain('secret');
    });

    it(
      'should handle different data types',
      async () => {
        const testCases = [
          { key: 'string', data: 'test-string' },
          { key: 'number', data: 12345 },
          { key: 'boolean', data: true },
          { key: 'object', data: { nested: { value: 'test' } } },
          { key: 'array', data: [1, 2, 'three', { four: 4 }] },
          { key: 'null', data: null }
        ];

        for (const testCase of testCases) {
          await storage.store(testCase.key, testCase.data);
          const retrieved = await storage.retrieve(testCase.key);
          expect(retrieved).toEqual(testCase.data);
        }
      },
      15000
    );
  });

  describe('expiration handling', () => {
    it('should handle expired data', async () => {
      const testData = { token: 'expired-token' };
      await storage.store('test-key', testData);
      
      // Set expiration in the past
      const pastDate = new Date(Date.now() - 1000);
      await storage.setExpiration('test-key', pastDate);
      
      const retrieved = await storage.retrieve('test-key');
      expect(retrieved).toBeNull();
      
      // Should also remove the expired data
      expect(await storage.exists('test-key')).toBe(false);
    });

    it('should handle future expiration', async () => {
      const testData = { token: 'valid-token' };
      await storage.store('test-key', testData);
      
      // Set expiration in the future
      const futureDate = new Date(Date.now() + 60000);
      await storage.setExpiration('test-key', futureDate);
      
      const retrieved = await storage.retrieve('test-key');
      expect(retrieved).toEqual(testData);
    });

    it('should throw error when setting expiration for non-existent key', async () => {
      const futureDate = new Date(Date.now() + 60000);
      await expect(storage.setExpiration('non-existent', futureDate)).rejects.toThrow('Token data not found');
    });
  });

  describe('cleanup operations', () => {
    it('should clean up expired tokens', async () => {
      // Store some tokens
      await storage.store('valid-token', { data: 'valid' });
      await storage.store('expired-token', { data: 'expired' });
      
      // Set one to expire
      const pastDate = new Date(Date.now() - 1000);
      await storage.setExpiration('expired-token', pastDate);
      
      await storage.cleanup();
      
      expect(await storage.exists('valid-token')).toBe(true);
      expect(await storage.exists('expired-token')).toBe(false);
    });

    it('should remove corrupted files during cleanup', async () => {
      // Create a corrupted file
      await fs.mkdir(testStoragePath, { recursive: true });
      const corruptedFile = path.join(testStoragePath, 'corrupted.enc');
      await fs.writeFile(corruptedFile, 'corrupted-data');
      
      await storage.cleanup();
      
      // Corrupted file should be removed
      const files = await fs.readdir(testStoragePath);
      expect(files).not.toContain('corrupted.enc');
    });
  });

  describe('key management', () => {
    it('should get all stored keys', async () => {
      await storage.store('key1', 'data1');
      await storage.store('key2', 'data2');
      await storage.store('key3', 'data3');
      
      const keys = await storage.getAllKeys();
      expect(keys).toHaveLength(3);
      
      // Keys should be hashed for security
      expect(keys).not.toContain('key1');
      expect(keys).not.toContain('key2');
      expect(keys).not.toContain('key3');
    });

    it('should handle empty storage directory', async () => {
      const keys = await storage.getAllKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should handle storage directory creation', async () => {
      const deepPath = path.join(testStoragePath, 'deep', 'nested', 'path');
      const deepStorage = new EncryptedTokenStorage(deepPath, testEncryptionKey);
      
      await deepStorage.store('test-key', 'test-data');
      const retrieved = await deepStorage.retrieve('test-key');
      
      expect(retrieved).toBe('test-data');
    });

    it('should handle decryption errors gracefully', async () => {
      await storage.store('test-key', 'test-data');
      
      // Create storage with different key
      const differentKeyStorage = new EncryptedTokenStorage(testStoragePath, 'different-key-with-sufficient-length');
      
      await expect(differentKeyStorage.retrieve('test-key')).rejects.toThrow('Failed to retrieve token data');
    });
  });
});