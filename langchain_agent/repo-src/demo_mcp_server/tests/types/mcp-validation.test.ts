/**
 * Unit tests for MCP protocol model validation
 */

import {
  validateMCPMessage,
  validateMCPResponse,
  validateMCPError,
  validateToolDefinition,
  validateJSONSchema,
  validateToolResult,
  validateHandshakeMessage,
  validateToolCallMessage,
  validateMCPMethod
} from '../../src/types/validation';
import {
  MCPMessage,
  MCPResponse,
  MCPError,
  MCPErrorCode,
  ToolDefinition,
  ToolResult,
  HandshakeMessage,
  ToolCallMessage,
  JSONSchema
} from '../../src/interfaces/mcp';

describe('MCP Protocol Model Validation', () => {
  describe('validateMCPMessage', () => {
    const validMessage: MCPMessage = {
      id: 'msg-123',
      method: 'tools/list',
      params: { cursor: 'abc' }
    };

    it('should validate a correct MCPMessage', () => {
      expect(validateMCPMessage(validMessage)).toBe(true);
    });

    it('should validate message without params', () => {
      const messageWithoutParams = {
        id: 'msg-123',
        method: 'tools/list'
      };
      expect(validateMCPMessage(messageWithoutParams)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateMCPMessage(null)).toBe(false);
      expect(validateMCPMessage(undefined)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(validateMCPMessage('string')).toBe(false);
      expect(validateMCPMessage(123)).toBe(false);
      expect(validateMCPMessage([])).toBe(false);
    });

    it('should reject invalid id', () => {
      expect(validateMCPMessage({ ...validMessage, id: '' })).toBe(false);
      expect(validateMCPMessage({ ...validMessage, id: 123 })).toBe(false);
    });

    it('should reject invalid method', () => {
      expect(validateMCPMessage({ ...validMessage, method: '' })).toBe(false);
      expect(validateMCPMessage({ ...validMessage, method: 123 })).toBe(false);
    });

    it('should reject invalid params', () => {
      expect(validateMCPMessage({ ...validMessage, params: 'not-object' })).toBe(false);
      expect(validateMCPMessage({ ...validMessage, params: null })).toBe(false);
    });
  });

  describe('validateMCPResponse', () => {
    const validResponse: MCPResponse = {
      id: 'msg-123',
      result: { data: 'test' }
    };

    const validErrorResponse: MCPResponse = {
      id: 'msg-123',
      error: {
        // Phase 167+: MCPError.code is now strongly typed as MCPErrorCode enum.
        code: MCPErrorCode.INTERNAL_ERROR,
        message: 'Test error'
      }
    };

    it('should validate a correct MCPResponse with result', () => {
      expect(validateMCPResponse(validResponse)).toBe(true);
    });

    it('should validate a correct MCPResponse with error', () => {
      expect(validateMCPResponse(validErrorResponse)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateMCPResponse(null)).toBe(false);
      expect(validateMCPResponse(undefined)).toBe(false);
    });

    it('should reject invalid id', () => {
      expect(validateMCPResponse({ ...validResponse, id: '' })).toBe(false);
      expect(validateMCPResponse({ ...validResponse, id: 123 })).toBe(false);
    });

    it('should reject response with both result and error', () => {
      expect(validateMCPResponse({
        id: 'msg-123',
        result: { data: 'test' },
        error: { code: -1, message: 'error' }
      })).toBe(false);
    });

    it('should reject response with neither result nor error', () => {
      expect(validateMCPResponse({ id: 'msg-123' })).toBe(false);
    });

    it('should reject response with invalid error', () => {
      expect(validateMCPResponse({
        id: 'msg-123',
        error: { code: 'not-number', message: 'error' }
      })).toBe(false);
    });
  });

  describe('validateMCPError', () => {
    const validError: MCPError = {
      code: MCPErrorCode.INTERNAL_ERROR,
      message: 'Test error',
      data: { details: 'error details' }
    };

    it('should validate a correct MCPError', () => {
      expect(validateMCPError(validError)).toBe(true);
    });

    it('should validate error without data', () => {
      const errorWithoutData = {
        code: -1,
        message: 'Test error'
      };
      expect(validateMCPError(errorWithoutData)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateMCPError(null)).toBe(false);
      expect(validateMCPError(undefined)).toBe(false);
    });

    it('should reject invalid code', () => {
      expect(validateMCPError({ ...validError, code: 'not-number' })).toBe(false);
      expect(validateMCPError({ ...validError, code: null })).toBe(false);
    });

    it('should reject invalid message', () => {
      expect(validateMCPError({ ...validError, message: '' })).toBe(false);
      expect(validateMCPError({ ...validError, message: 123 })).toBe(false);
    });
  });

  describe('validateToolDefinition', () => {
    const validTool: ToolDefinition = {
      name: 'get_account_balance',
      description: 'Get account balance',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' }
        },
        required: ['account_id']
      },
      requiresUserAuth: true,
      requiredScopes: ['read']
    };

    it('should validate a correct ToolDefinition', () => {
      expect(validateToolDefinition(validTool)).toBe(true);
    });

    it('should validate tool with empty scopes', () => {
      const toolWithEmptyScopes = {
        ...validTool,
        requiredScopes: []
      };
      expect(validateToolDefinition(toolWithEmptyScopes)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateToolDefinition(null)).toBe(false);
      expect(validateToolDefinition(undefined)).toBe(false);
    });

    it('should reject invalid name', () => {
      expect(validateToolDefinition({ ...validTool, name: '' })).toBe(false);
      expect(validateToolDefinition({ ...validTool, name: 123 })).toBe(false);
    });

    it('should reject invalid description', () => {
      expect(validateToolDefinition({ ...validTool, description: '' })).toBe(false);
      expect(validateToolDefinition({ ...validTool, description: null })).toBe(false);
    });

    it('should reject invalid inputSchema', () => {
      expect(validateToolDefinition({ ...validTool, inputSchema: 'not-schema' })).toBe(false);
      expect(validateToolDefinition({ ...validTool, inputSchema: { type: '' } })).toBe(false);
    });

    it('should reject invalid requiresUserAuth', () => {
      expect(validateToolDefinition({ ...validTool, requiresUserAuth: 'true' })).toBe(false);
      expect(validateToolDefinition({ ...validTool, requiresUserAuth: 1 })).toBe(false);
    });

    it('should reject invalid requiredScopes', () => {
      expect(validateToolDefinition({ ...validTool, requiredScopes: 'not-array' })).toBe(false);
      expect(validateToolDefinition({ ...validTool, requiredScopes: [123, 'valid'] })).toBe(false);
    });
  });

  describe('validateJSONSchema', () => {
    const validSchema: JSONSchema = {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        amount: { type: 'number' }
      },
      required: ['account_id'],
      additionalProperties: false
    };

    it('should validate a correct JSONSchema', () => {
      expect(validateJSONSchema(validSchema)).toBe(true);
    });

    it('should validate minimal schema', () => {
      const minimalSchema = { type: 'string' };
      expect(validateJSONSchema(minimalSchema)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateJSONSchema(null)).toBe(false);
      expect(validateJSONSchema(undefined)).toBe(false);
    });

    it('should reject invalid type', () => {
      expect(validateJSONSchema({ ...validSchema, type: '' })).toBe(false);
      expect(validateJSONSchema({ ...validSchema, type: 123 })).toBe(false);
    });

    it('should reject invalid properties', () => {
      expect(validateJSONSchema({ ...validSchema, properties: 'not-object' })).toBe(false);
      expect(validateJSONSchema({ ...validSchema, properties: null })).toBe(false);
    });

    it('should reject invalid required', () => {
      expect(validateJSONSchema({ ...validSchema, required: 'not-array' })).toBe(false);
      expect(validateJSONSchema({ ...validSchema, required: [123, 'valid'] })).toBe(false);
    });
  });

  describe('validateToolResult', () => {
    const validResult: ToolResult = {
      type: 'text',
      text: 'Result text'
    };

    it('should validate a correct ToolResult', () => {
      expect(validateToolResult(validResult)).toBe(true);
    });

    it('should validate different result types', () => {
      expect(validateToolResult({ type: 'image', data: 'base64data' })).toBe(true);
      expect(validateToolResult({ type: 'resource', mimeType: 'application/json' })).toBe(true);
    });

    it('should validate result with error', () => {
      const errorResult = {
        type: 'text',
        error: 'Something went wrong',
        success: false
      };
      expect(validateToolResult(errorResult)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateToolResult(null)).toBe(false);
      expect(validateToolResult(undefined)).toBe(false);
    });

    it('should reject invalid type', () => {
      expect(validateToolResult({ ...validResult, type: 'invalid' })).toBe(false);
      expect(validateToolResult({ ...validResult, type: 123 })).toBe(false);
    });

    it('should reject invalid optional string fields', () => {
      expect(validateToolResult({ ...validResult, text: 123 })).toBe(false);
      expect(validateToolResult({ ...validResult, error: null })).toBe(false);
    });

    it('should reject invalid success field', () => {
      expect(validateToolResult({ ...validResult, success: 'true' })).toBe(false);
      expect(validateToolResult({ ...validResult, success: 1 })).toBe(false);
    });
  });

  describe('validateHandshakeMessage', () => {
    const validHandshake: HandshakeMessage = {
      id: 'handshake-1',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          logging: {}
        }
      }
    };

    it('should validate a correct HandshakeMessage', () => {
      expect(validateHandshakeMessage(validHandshake)).toBe(true);
    });

    it('should reject non-handshake method', () => {
      expect(validateHandshakeMessage({
        ...validHandshake,
        method: 'tools/list'
      })).toBe(false);
    });

    it('should reject missing params', () => {
      expect(validateHandshakeMessage({
        id: 'handshake-1',
        method: 'initialize'
      })).toBe(false);
    });

    it('should reject invalid protocolVersion', () => {
      expect(validateHandshakeMessage({
        ...validHandshake,
        params: {
          ...validHandshake.params,
          protocolVersion: ''
        }
      })).toBe(false);
    });

    it('should reject missing capabilities', () => {
      expect(validateHandshakeMessage({
        ...validHandshake,
        params: {
          protocolVersion: '2024-11-05'
        }
      })).toBe(false);
    });
  });

  describe('validateToolCallMessage', () => {
    const validToolCall: ToolCallMessage = {
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'get_account_balance',
        arguments: {
          account_id: 'acc-123'
        }
      }
    };

    it('should validate a correct ToolCallMessage', () => {
      expect(validateToolCallMessage(validToolCall)).toBe(true);
    });

    it('should validate tool call without arguments', () => {
      const callWithoutArgs = {
        ...validToolCall,
        params: {
          name: 'get_my_accounts'
        }
      };
      expect(validateToolCallMessage(callWithoutArgs)).toBe(true);
    });

    it('should reject non-tools/call method', () => {
      expect(validateToolCallMessage({
        ...validToolCall,
        method: 'handshake'
      })).toBe(false);
    });

    it('should reject missing params', () => {
      expect(validateToolCallMessage({
        id: 'call-1',
        method: 'tools/call'
      })).toBe(false);
    });

    it('should reject invalid name', () => {
      expect(validateToolCallMessage({
        ...validToolCall,
        params: {
          ...validToolCall.params,
          name: ''
        }
      })).toBe(false);
    });

    it('should reject invalid arguments', () => {
      expect(validateToolCallMessage({
        ...validToolCall,
        params: {
          ...validToolCall.params,
          arguments: 'not-object'
        }
      })).toBe(false);
    });
  });

  describe('validateMCPMethod', () => {
    it('should validate correct MCP methods', () => {
      const validMethods = [
        'handshake',
        'tools/list',
        'tools/call',
        'logging/setLevel',
        'prompts/list',
        'prompts/get',
        'resources/list',
        'resources/read',
        'resources/subscribe',
        'resources/unsubscribe'
      ];

      validMethods.forEach(method => {
        expect(validateMCPMethod(method)).toBe(true);
      });
    });

    it('should reject invalid methods', () => {
      expect(validateMCPMethod('')).toBe(false);
      expect(validateMCPMethod('invalid/method')).toBe(false);
      expect(validateMCPMethod('custom/tool')).toBe(false);
    });

    it('should reject non-string methods', () => {
      expect(validateMCPMethod(123 as any)).toBe(false);
      expect(validateMCPMethod(null as any)).toBe(false);
      expect(validateMCPMethod(undefined as any)).toBe(false);
    });
  });
});