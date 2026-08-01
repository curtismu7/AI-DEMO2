import * as fs from 'fs/promises';
import * as path from 'path';
import { IEncryptedTokenStorage, StoredTokenData } from './interfaces';
import { EncryptionUtils } from '../utils/encryption';

/**
 * File-based encrypted token storage
 */
export class EncryptedTokenStorage implements IEncryptedTokenStorage {
  private readonly storagePath: string;
  private readonly encryptionKey: string;

  constructor(storagePath: string, encryptionKey: string) {
    if (!EncryptionUtils.validateEncryptionKey(encryptionKey)) {
      throw new Error('Encryption key must be at least 32 characters long');
    }

    this.storagePath = storagePath;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Initialize storage directory
   */
  private async ensureStorageDirectory(): Promise<void> {
    try {
      await fs.access(this.storagePath);
    } catch {
      await fs.mkdir(this.storagePath, { recursive: true });
    }
  }

  /**
   * Get file path for a storage key
   */
  private getFilePath(key: string): string {
    const hashedKey = EncryptionUtils.hashToken(key);
    return path.join(this.storagePath, `${hashedKey}.enc`);
  }

  /**
   * Store encrypted token data
   */
  async store(key: string, data: any): Promise<void> {
    await this.ensureStorageDirectory();

    const tokenData: StoredTokenData = {
      data,
      createdAt: new Date(),
      metadata: {
        keyHash: EncryptionUtils.hashToken(key)
      }
    };

    const serializedData = JSON.stringify(tokenData);
    const encryptedData = await EncryptionUtils.encrypt(serializedData, this.encryptionKey);
    
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, encryptedData, 'utf8');
  }

  /**
   * Retrieve and decrypt token data
   */
  async retrieve(key: string): Promise<any | null> {
    try {
      const filePath = this.getFilePath(key);
      const encryptedData = await fs.readFile(filePath, 'utf8');
      
      const decryptedData = await EncryptionUtils.decrypt(encryptedData, this.encryptionKey);
      const tokenData: StoredTokenData = JSON.parse(decryptedData);
      
      // Check if data has expired
      if (tokenData.expiresAt && new Date() > new Date(tokenData.expiresAt)) {
        await this.remove(key);
        return null;
      }

      return tokenData.data;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw Object.assign(new Error(`Failed to retrieve token data: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  /**
   * Remove token data
   */
  async remove(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw Object.assign(new Error(`Failed to remove token data: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
      }
    }
  }

  /**
   * Check if token data exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanup(): Promise<void> {
    try {
      await this.ensureStorageDirectory();
      const files = await fs.readdir(this.storagePath);
      
      const cleanupPromises = files
        .filter(file => file.endsWith('.enc'))
        .map(async (file) => {
          try {
            const filePath = path.join(this.storagePath, file);
            const encryptedData = await fs.readFile(filePath, 'utf8');
            const decryptedData = await EncryptionUtils.decrypt(encryptedData, this.encryptionKey);
            const tokenData: StoredTokenData = JSON.parse(decryptedData);
            
            // Remove if expired
            if (tokenData.expiresAt && new Date() > new Date(tokenData.expiresAt)) {
              await fs.unlink(filePath);
            }
          } catch (error) {
            // If we can't decrypt or parse, remove the corrupted file
            const filePath = path.join(this.storagePath, file);
            await fs.unlink(filePath);
          }
        });

      await Promise.all(cleanupPromises);
    } catch (error) {
      throw Object.assign(new Error(`Failed to cleanup expired tokens: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  /**
   * Get all stored keys (returns hashed keys for security)
   */
  async getAllKeys(): Promise<string[]> {
    try {
      await this.ensureStorageDirectory();
      const files = await fs.readdir(this.storagePath);
      
      return files
        .filter(file => file.endsWith('.enc'))
        .map(file => file.replace('.enc', ''));
    } catch (error) {
      throw Object.assign(new Error(`Failed to get all keys: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause: error });
    }
  }

  /**
   * Set expiration for stored token data
   */
  async setExpiration(key: string, expiresAt: Date): Promise<void> {
    const existingData = await this.retrieve(key);
    if (existingData === null) {
      throw new Error('Token data not found');
    }

    const tokenData: StoredTokenData = {
      data: existingData,
      createdAt: new Date(),
      expiresAt,
      metadata: {
        keyHash: EncryptionUtils.hashToken(key)
      }
    };

    const serializedData = JSON.stringify(tokenData);
    const encryptedData = await EncryptionUtils.encrypt(serializedData, this.encryptionKey);
    
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, encryptedData, 'utf8');
  }
}