/**
 * Tests for MCP type definitions
 */

import { MCPRequest, MCPResponse, MCPTool } from '../../src/types/mcp';

describe('MCP Types', () => {
  describe('MCPRequest', () => {
    it('should have required properties', () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test'
      };

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe(1);
      expect(request.method).toBe('test');
    });
  });

  describe('MCPResponse', () => {
    it('should have required properties', () => {
      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true }
      };

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ success: true });
    });
  });

  describe('MCPTool', () => {
    it('should define tool structure correctly', () => {
      const tool: MCPTool = {
        name: 'get_balance',
        description: 'Get account balance',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: { type: 'string' }
          },
          required: ['accountId']
        }
      };

      expect(tool.name).toBe('get_balance');
      expect(tool.description).toBe('Get account balance');
      expect(tool.inputSchema.type).toBe('object');
    });
  });
});