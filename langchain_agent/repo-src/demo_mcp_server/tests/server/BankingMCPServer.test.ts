/**
 * Banking MCP Server Tests
 * Unit tests for WebSocket server and connection handling
 */

import WebSocket from 'ws';
import { BankingMCPServer, ServerConfig } from '../../src/server/BankingMCPServer';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { PingOneConfig } from '../../src/interfaces/auth';

// Mock dependencies
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');
jest.mock('../../src/tools/BankingToolProvider');

describe('BankingMCPServer', () => {
  let server: BankingMCPServer;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockToolProvider: jest.Mocked<BankingToolProvider>;
  let config: ServerConfig;

  beforeEach(() => {
    // Create mock instances
    const mockPingOneConfig: PingOneConfig = {
      baseUrl: 'https://openam-dna.forgeblocks.com:443',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      tokenIntrospectionEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      authorizationEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      tokenEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token'
    };

    mockAuthManager = new BankingAuthenticationManager(mockPingOneConfig) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('test-path', 'test-key') as jest.Mocked<BankingSessionManager>;
    mockToolProvider = {} as jest.Mocked<BankingToolProvider>;

    config = {
      host: 'localhost',
      port: 0, // Use random port for testing
      maxConnections: 10,
      sessionTimeout: 3600,
      enableLogging: false
    };

    server = new BankingMCPServer(config, mockAuthManager, mockSessionManager, mockToolProvider);
  });

  afterEach(async () => {
    if (server.isServerRunning()) {
      await server.stopServer();
    }
  });

  describe('Server Lifecycle', () => {
    it('should start server successfully', async () => {
      const startPromise = server.startServer();
      
      // Listen for server started event
      const serverStartedPromise = new Promise((resolve) => {
        server.once('serverStarted', resolve);
      });

      await startPromise;
      await serverStartedPromise;

      expect(server.isServerRunning()).toBe(true);
      
      const stats = server.getServerStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.activeConnections).toBe(0);
    });

    it('should stop server successfully', async () => {
      await server.startServer();
      expect(server.isServerRunning()).toBe(true);

      const stopPromise = server.stopServer();
      
      // Listen for server stopped event
      const serverStoppedPromise = new Promise((resolve) => {
        server.once('serverStopped', resolve);
      });

      await stopPromise;
      await serverStoppedPromise;

      expect(server.isServerRunning()).toBe(false);
    });

    it('should throw error when starting already running server', async () => {
      await server.startServer();
      
      await expect(server.startServer()).rejects.toThrow('Server is already running');
    });

    it('should handle stop when server is not running', async () => {
      expect(server.isServerRunning()).toBe(false);
      
      // Should not throw
      await expect(server.stopServer()).resolves.toBeUndefined();
    });
  });

  describe('Connection Handling', () => {
    let serverPort: number;

    beforeEach(async () => {
      await server.startServer();
      // Get the actual port assigned
      serverPort = server.getActualPort() || 8080; // Fallback for testing
    });

    it('should handle new WebSocket connections', async () => {
      const connectionPromise = new Promise((resolve) => {
        server.once('connectionOpened', resolve);
      });

      // Create WebSocket client
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise((resolve) => {
        ws.once('open', resolve);
      });

      const connectionEvent = await connectionPromise;
      expect(connectionEvent).toHaveProperty('connectionId');
      expect(connectionEvent).toHaveProperty('activeConnections', 1);

      const stats = server.getServerStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.activeConnections).toBe(1);

      ws.close();
    });

    it('should handle connection closure', async () => {
      const connectionOpenedPromise = new Promise((resolve) => {
        server.once('connectionOpened', resolve);
      });

      const connectionClosedPromise = new Promise((resolve) => {
        server.once('connectionClosed', resolve);
      });

      // Create and close WebSocket client
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise((resolve) => {
        ws.once('open', resolve);
      });

      await connectionOpenedPromise;

      ws.close();
      
      const closeEvent = await connectionClosedPromise;
      expect(closeEvent).toHaveProperty('connectionId');
      expect(closeEvent).toHaveProperty('activeConnections', 0);

      const stats = server.getServerStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.activeConnections).toBe(0);
    });

    it('should reject connections when at maximum capacity', async () => {
      // Set low connection limit
      const limitedConfig = { ...config, maxConnections: 1 };
      const limitedServer = new BankingMCPServer(limitedConfig, mockAuthManager, mockSessionManager, mockToolProvider);
      
      await limitedServer.startServer();
      const limitedServerPort = limitedServer.getActualPort() || 8080;

      try {
        // Create first connection (should succeed)
        const ws1 = new WebSocket(`ws://localhost:${limitedServerPort}`);
        await new Promise((resolve) => {
          ws1.once('open', resolve);
        });

        // Create second connection (should be rejected)
        const ws2 = new WebSocket(`ws://localhost:${limitedServerPort}`);
        
        const closePromise = new Promise((resolve) => {
          ws2.once('close', (code) => {
            resolve(code);
          });
        });

        const closeCode = await closePromise;
        expect(closeCode).toBe(1013); // Server at maximum capacity

        ws1.close();
      } finally {
        await limitedServer.stopServer();
      }
    });

    it('should handle connection errors gracefully', async () => {
      void new Promise((resolve) => {
        server.once('messageError', resolve);
      });

      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise((resolve) => {
        ws.once('open', resolve);
      });

      // Send invalid JSON
      ws.send('invalid json');

      // Should handle the error without crashing
      await new Promise((resolve) => setTimeout(resolve, 100));

      ws.close();
    });
  });

  describe('Message Processing', () => {
    let serverPort: number;
    let ws: WebSocket;

    beforeEach(async () => {
      await server.startServer();
      serverPort = server.getActualPort() || 8080;
      
      ws = new WebSocket(`ws://localhost:${serverPort}`);
      await new Promise((resolve) => {
        ws.once('open', resolve);
      });
    });

    afterEach(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it('should handle valid MCP messages', async () => {
      // Complete MCP lifecycle before testing method routing (spec SHOULD: init before requests)
      await new Promise<void>((resolve) => {
        ws.once('message', () => resolve());
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 'setup-init',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        }));
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));

      const messagePromise = new Promise((resolve) => {
        const handler = (event: any) => {
          if (event.method === 'test_method') {
            server.off('messageProcessed', handler);
            resolve(event);
          }
        };
        server.on('messageProcessed', handler);
      });

      const responsePromise = new Promise((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send valid MCP message
      const message = {
        id: 'test-1',
        method: 'test_method',
        params: {}
      };

      ws.send(JSON.stringify(message));

      const messageEvent = await messagePromise;
      expect(messageEvent).toHaveProperty('method', 'test_method');
      expect(messageEvent).toHaveProperty('messageId', 'test-1');

      const response = await responsePromise as any;
      expect(response).toHaveProperty('id', 'test-1');
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe(-32601); // Method not found (expected for now)
    });

    it('should handle invalid JSON messages', async () => {
      const responsePromise = new Promise((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send invalid JSON
      ws.send('invalid json');

      const response = await responsePromise as any;
      expect(response).toHaveProperty('id', 'parse_error');
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe(-32700); // Parse error
    });

    it('should handle invalid MCP message structure', async () => {
      const responsePromise = new Promise((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send message missing required fields
      const invalidMessage = {
        id: 'test-2'
        // Missing method field
      };

      ws.send(JSON.stringify(invalidMessage));

      const response = await responsePromise as any;
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe(-32600); // Invalid Request
    });

    it('should update connection statistics on message processing', async () => {
      const initialStats = server.getServerStats();
      
      const message = {
        id: 'test-3',
        method: 'test_method',
        params: {}
      };

      ws.send(JSON.stringify(message));

      // Wait for message processing
      await new Promise((resolve) => {
        server.once('messageProcessed', resolve);
      });

      const updatedStats = server.getServerStats();
      expect(updatedStats.totalMessages).toBe(initialStats.totalMessages + 1);
    });
  });

  describe('Server Statistics', () => {
    it('should track server statistics correctly', async () => {
      const initialStats = server.getServerStats();
      expect(initialStats.totalConnections).toBe(0);
      expect(initialStats.activeConnections).toBe(0);
      expect(initialStats.totalMessages).toBe(0);
      expect(initialStats.uptime).toBe(0);

      await server.startServer();

      // Add a small delay to ensure uptime > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const runningStats = server.getServerStats();
      expect(runningStats.uptime).toBeGreaterThan(0);
      expect(runningStats.startTime).toBeInstanceOf(Date);
    });

    it('should provide connection information', async () => {
      await server.startServer();
      
      const ws = new WebSocket(`ws://localhost:${server.getActualPort() || 8080}`);
      
      const connectionPromise = new Promise((resolve) => {
        server.once('connectionOpened', (event) => {
          resolve(event.connectionId);
        });
      });

      await new Promise((resolve) => {
        ws.once('open', resolve);
      });

      const connectionId = await connectionPromise as string;
      
      const connectionInfo = server.getConnectionInfo(connectionId);
      expect(connectionInfo).toBeTruthy();
      expect(connectionInfo!.id).toBe(connectionId);
      expect(connectionInfo!.connectedAt).toBeInstanceOf(Date);
      expect(connectionInfo!.messageCount).toBe(0);

      const allConnections = server.getActiveConnections();
      expect(allConnections).toHaveLength(1);
      expect(allConnections[0].id).toBe(connectionId);

      ws.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle server startup errors gracefully', async () => {
      // Try to start server on invalid port
      const invalidConfig = { ...config, port: -1 };
      const invalidServer = new BankingMCPServer(invalidConfig, mockAuthManager, mockSessionManager, mockToolProvider);

      await expect(invalidServer.startServer()).rejects.toThrow('Failed to start server');
    });

    it('should emit server error events', async () => {
      await server.startServer();

      const errorPromise = new Promise((resolve) => {
        server.once('serverError', resolve);
      });

      // Simulate server error by accessing private server instance
      const serverInstance = (server as any).server;
      if (serverInstance) {
        serverInstance.emit('error', new Error('Test server error'));
      }

      const errorEvent = await errorPromise;
      expect(errorEvent).toHaveProperty('error', 'Test server error');
    });
  });

  describe('Lifecycle gate (spec SHOULD — pre-init rejection)', () => {
    let serverPort: number;
    let ws: WebSocket;

    beforeEach(async () => {
      await server.startServer();
      serverPort = server.getActualPort() || 8080;
      ws = new WebSocket(`ws://localhost:${serverPort}`);
      await new Promise<void>((resolve) => { ws.once('open', () => resolve()); });
    });

    afterEach(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    it('should reject tools/list with -32600 if sent before notifications/initialized', async () => {
      // Complete initialize (required first step) but do NOT send notifications/initialized
      await new Promise<void>((resolve) => {
        ws.once('message', () => resolve());
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 'init-1',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        }));
      });

      // Send tools/list WITHOUT notifications/initialized
      const responsePromise = new Promise<any>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'premature-list', method: 'tools/list', params: {} }));

      const response = await responsePromise;
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toMatch(/not initialized/i);
    });

    it('should allow tools/list after notifications/initialized is sent', async () => {
      // Full lifecycle: initialize → notifications/initialized → tools/list
      await new Promise<void>((resolve) => {
        ws.once('message', () => resolve());
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 'init-2',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        }));
      });

      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      // Small delay for notification to be processed
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const responsePromise = new Promise<any>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'list-after-init', method: 'tools/list', params: {} }));

      const response = await responsePromise;
      // Response should NOT be a lifecycle gate error (-32600).
      // (tools/list may return an error from the unmocked tool provider — that is fine;
      //  the gate must have been passed for it to reach the handler at all.)
      expect(response.error?.code).not.toBe(-32600);
      expect(response.id).toBe('list-after-init');
    });

    it('should allow ping before notifications/initialized', async () => {
      // ping is always permitted (even before lifecycle completes)
      await new Promise<void>((resolve) => {
        ws.once('message', () => resolve());
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 'init-ping',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        }));
      });

      const pingPromise = new Promise<any>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'ping-early', method: 'ping', params: {} }));

      const response = await pingPromise;
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });
  });
});