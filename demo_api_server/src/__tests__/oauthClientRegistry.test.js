/**
 * OAuth Client Registry Service Tests
 * Comprehensive test suite for OAuth client registration and management
 * 
 * Phase 57-01: OAuth Client Registration System
 * Extensive testing to ensure no service disruption
 */

const {
  registerOAuthClient,
  getClient,
  updateClient,
  deleteClient,
  rotateClientSecret,
  listClients,
  validateClientCredentials,
  getClientStatistics,
  clearRegistry
} = require('../../services/oauthClientRegistry');

describe('OAuth Client Registry Service', () => {
  beforeEach(() => {
    // Clear registry before each test
    clearRegistry();
  });

  describe('Client Registration', () => {
    test('should register a valid client successfully', async () => {
      const request = {
        client_name: 'Test MCP Server',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read', 'write'],
        token_endpoint_auth_method: 'client_secret_basic'
      };

      const client = await registerOAuthClient(request, {
        sourceIP: '127.0.0.1',
        userAgent: 'test-agent',
        requestId: 'test-123'
      });

      expect(client).toHaveProperty('client_id');
      expect(client).toHaveProperty('client_secret');
      expect(client).toHaveProperty('registration_access_token');
      expect(client.client_id).toMatch(/^mcp-client-/);
      expect(client.client_secret).toMatch(/^[a-f0-9]{64}$/);
      expect(client.scope).toBe('read write');
    });

    test('should reject registration with invalid client name', async () => {
      const request = {
        client_name: '', // Empty name
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      };

      await expect(registerOAuthClient(request))
        .rejects.toThrow('Client registration validation failed');
    });

    test('should reject registration with invalid client type', async () => {
      const request = {
        client_name: 'Test Client',
        client_type: 'public', // Not allowed
        grant_types: ['client_credentials'],
        scope: ['read']
      };

      await expect(registerOAuthClient(request))
        .rejects.toThrow('Client registration validation failed');
    });

    test('should reject registration with invalid grant types', async () => {
      const request = {
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['authorization_code'], // Not allowed
        scope: ['read']
      };

      await expect(registerOAuthClient(request))
        .rejects.toThrow('Client registration validation failed');
    });

    test('should reject registration with unknown scopes', async () => {
      const request = {
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['unknown:scope'] // Invalid scope
      };

      await expect(registerOAuthClient(request))
        .rejects.toThrow('Client registration validation failed');
    });

    test('should accept registration with valid MCP tool scopes', async () => {
      const request = {
        client_name: 'MCP Banking Agent',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: [
          'read',
          'write',
          'ai_agent'
        ]
      };

      const client = await registerOAuthClient(request);
      expect(client.scope).toBe('read write ai_agent');
    });

    test('should handle registration with admin scopes', async () => {
      const request = {
        client_name: 'Admin Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['admin:read', 'users:read']
      };

      const client = await registerOAuthClient(request);
      expect(client.scope).toBe('admin:read users:read');
    });

    test('should reject registration with invalid redirect URIs', async () => {
      const request = {
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read'],
        redirect_uris: ['invalid-url'] // Invalid URI
      };

      await expect(registerOAuthClient(request))
        .rejects.toThrow('Client registration validation failed');
    });

    test('should accept registration with valid redirect URIs', async () => {
      const request = {
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read'],
        redirect_uris: ['https://example.com/callback']
      };

      const client = await registerOAuthClient(request);
      expect(client).toHaveProperty('client_id');
    });
  });

  describe('Client Retrieval', () => {
    let clientId;

    beforeEach(async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });
      clientId = client.client_id;
    });

    test('should retrieve existing client', () => {
      const client = getClient(clientId);
      
      expect(client).toHaveProperty('client_id', clientId);
      expect(client).toHaveProperty('client_name', 'Test Client');
      expect(client).toHaveProperty('client_type', 'confidential');
      expect(client).toHaveProperty('scope');
      expect(client).not.toHaveProperty('client_secret'); // Secret not included by default
    });

    test('should throw error for non-existent client', () => {
      expect(() => getClient('non-existent-client'))
        .toThrow('Client not found');
    });
  });

  describe('Client Updates', () => {
    let clientId;

    beforeEach(async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });
      clientId = client.client_id;
    });

    test('should update client name successfully', () => {
      const updates = { client_name: 'Updated Client' };
      const client = updateClient(clientId, updates, {
        updatedBy: 'test-user',
        sourceIP: '127.0.0.1'
      });

      expect(client.client_name).toBe('Updated Client');
      expect(client).toHaveProperty('updated_at');
    });

    test('should update client scopes successfully', () => {
      const updates = { scope: 'read write' };
      const client = updateClient(clientId, updates);

      expect(client.scope).toEqual(['read', 'write']);
    });

    test('should reject update with invalid scopes', () => {
      const updates = { scope: 'invalid:scope' };

      expect(() => updateClient(clientId, updates))
        .toThrow('Client update validation failed');
    });

    test('should throw error when updating non-existent client', () => {
      expect(() => updateClient('non-existent-client', { client_name: 'Test' }))
        .toThrow('Client not found');
    });
  });

  describe('Client Deletion', () => {
    let clientId;

    beforeEach(async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });
      clientId = client.client_id;
    });

    test('should delete client successfully', () => {
      deleteClient(clientId, {
        deletedBy: 'test-user',
        sourceIP: '127.0.0.1'
      });

      expect(() => getClient(clientId))
        .toThrow('Client not found');
    });

    test('should throw error when deleting non-existent client', () => {
      expect(() => deleteClient('non-existent-client'))
        .toThrow('Client not found');
    });
  });

  describe('Client Secret Rotation', () => {
    let clientId;
    let originalSecret;

    beforeEach(async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });
      clientId = client.client_id;
      originalSecret = client.client_secret;
    });

    test('should rotate client secret successfully', () => {
      const result = rotateClientSecret(clientId, {
        rotatedBy: 'test-user',
        sourceIP: '127.0.0.1',
        reason: 'security'
      });

      expect(result).toHaveProperty('client_id', clientId);
      expect(result).toHaveProperty('client_secret');
      expect(result.client_secret).not.toBe(originalSecret);
      expect(result).toHaveProperty('client_secret_rotated_at');
    });

    test('should throw error when rotating non-existent client', () => {
      expect(() => rotateClientSecret('non-existent-client'))
        .toThrow('Client not found');
    });

    test('should track rotation count', () => {
      rotateClientSecret(clientId);
      rotateClientSecret(clientId);
      
      const client = getClient(clientId, true);
      expect(client.client_secret_rotation_count).toBe(2);
    });
  });

  describe('Client Listing', () => {
    beforeEach(async () => {
      // Register multiple clients for testing
      await registerOAuthClient({
        client_name: 'Client 1',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      await registerOAuthClient({
        client_name: 'Client 2',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read', 'write']
      });
    });

    test('should list all clients', () => {
      const clients = listClients();
      expect(clients).toHaveLength(2);
      expect(clients[0]).toHaveProperty('client_id');
      expect(clients[0]).toHaveProperty('client_name');
      expect(clients[0]).not.toHaveProperty('client_secret');
    });

    test('should filter clients by status', () => {
      const clients = listClients({ status: 'active' });
      expect(clients).toHaveLength(2);
    });

    test('should filter clients by type', () => {
      const clients = listClients({ client_type: 'confidential' });
      expect(clients).toHaveLength(2);
    });
  });

  describe('Client Credential Validation', () => {
    let clientId;
    let clientSecret;

    beforeEach(async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });
      clientId = client.client_id;
      clientSecret = client.client_secret;
    });

    test('should validate correct credentials', () => {
      const result = validateClientCredentials(clientId, clientSecret);
      
      expect(result.valid).toBe(true);
      expect(result).toHaveProperty('client');
      expect(result.client).toHaveProperty('client_id', clientId);
    });

    test('should reject invalid client ID', () => {
      const result = validateClientCredentials('invalid-id', clientSecret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Client not found');
    });

    test('should reject invalid client secret', () => {
      const result = validateClientCredentials(clientId, 'invalid-secret');
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid client secret');
    });

    test('should update usage tracking on successful validation', () => {
      validateClientCredentials(clientId, clientSecret);
      
      const client = getClient(clientId, true);
      expect(client.usage_count).toBe(1);
      expect(client.last_used).toBeDefined();
    });
  });

  describe('Client Statistics', () => {
    beforeEach(async () => {
      // Register various types of clients
      await registerOAuthClient({
        client_name: 'Banking Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read', 'write']
      });

      await registerOAuthClient({
        client_name: 'Admin Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['admin:read', 'users:read']
      });

      await registerOAuthClient({
        client_name: 'AI Agent Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['ai_agent', 'read']
      });
    });

    test('should generate comprehensive statistics', () => {
      const stats = getClientStatistics();
      
      expect(stats).toHaveProperty('total_clients', 3);
      expect(stats).toHaveProperty('active_clients', 3);
      expect(stats).toHaveProperty('clients_by_type');
      expect(stats).toHaveProperty('scope_usage');
      expect(stats).toHaveProperty('registrations_by_month');
      expect(stats).toHaveProperty('recent_registrations');
    });

    test('should count clients by type correctly', () => {
      const stats = getClientStatistics();
      
      expect(stats.clients_by_type.confidential).toBe(3);
    });

    test('should count scope usage correctly', () => {
      const stats = getClientStatistics();
      
      expect(stats.scope_usage['read']).toBe(2);
      expect(stats.scope_usage['write']).toBe(1);
      expect(stats.scope_usage['admin:read']).toBe(1);
      expect(stats.scope_usage['ai_agent']).toBe(1);
    });
  });

  describe('Security Validation', () => {
    test('should generate cryptographically secure client IDs', async () => {
      const client1 = await registerOAuthClient({
        client_name: 'Client 1',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      const client2 = await registerOAuthClient({
        client_name: 'Client 2',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      // Client IDs should be unique
      expect(client1.client_id).not.toBe(client2.client_id);
      
      // Client IDs should follow expected format
      expect(client1.client_id).toMatch(/^mcp-client-[a-f0-9]{32}$/);
      expect(client2.client_id).toMatch(/^mcp-client-[a-f0-9]{32}$/);
    });

    test('should generate cryptographically secure client secrets', async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      // Client secret should be 64 hex characters (32 bytes)
      expect(client.client_secret).toMatch(/^[a-f0-9]{64}$/);
      expect(client.client_secret).toHaveLength(64);
    });

    test('should generate secure registration access tokens', async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      // Registration access token should be 64 hex characters
      expect(client.registration_access_token).toMatch(/^[a-f0-9]{64}$/);
      expect(client.registration_access_token).toHaveLength(64);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    test('should handle maximum length client name', async () => {
      const longName = 'A'.repeat(100);
      
      const client = await registerOAuthClient({
        client_name: longName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      expect(client).toHaveProperty('client_id');
    });

    test('should reject client name exceeding maximum length', async () => {
      const tooLongName = 'A'.repeat(101);
      
      await expect(registerOAuthClient({
        client_name: tooLongName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      })).rejects.toThrow('Client registration validation failed');
    });

    test('should handle minimum length client name', async () => {
      const shortName = 'ABC';
      
      const client = await registerOAuthClient({
        client_name: shortName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      expect(client).toHaveProperty('client_id');
    });

    test('should reject client name below minimum length', async () => {
      const tooShortName = 'AB';
      
      await expect(registerOAuthClient({
        client_name: tooShortName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      })).rejects.toThrow('Client registration validation failed');
    });

    test('should handle special characters in client name', async () => {
      const specialName = 'Test-Client_123';
      
      const client = await registerOAuthClient({
        client_name: specialName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      expect(client).toHaveProperty('client_id');
    });

    test('should reject invalid characters in client name', async () => {
      const invalidName = 'Test@Client#123';
      
      await expect(registerOAuthClient({
        client_name: invalidName,
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      })).rejects.toThrow('Client registration validation failed');
    });
  });

  describe('Performance Tests', () => {
    test('should handle multiple concurrent registrations', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(registerOAuthClient({
          client_name: `Client ${i}`,
          client_type: 'confidential',
          grant_types: ['client_credentials'],
          scope: ['read']
        }));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      
      // All client IDs should be unique
      const clientIds = results.map(r => r.client_id);
      const uniqueIds = new Set(clientIds);
      expect(uniqueIds.size).toBe(10);
    });

    test('should handle rapid credential validation', async () => {
      const client = await registerOAuthClient({
        client_name: 'Test Client',
        client_type: 'confidential',
        grant_types: ['client_credentials'],
        scope: ['read']
      });

      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        validateClientCredentials(client.client_id, client.client_secret);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete 100 validations in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
