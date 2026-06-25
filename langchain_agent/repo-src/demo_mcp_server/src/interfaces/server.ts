/**
 * Core server interfaces
 */

import { MCPRequest, MCPResponse, MCPTool, MCPToolCall, MCPToolResult } from '../types/mcp';
import { AuthenticationProvider, SecureSession } from '../types/auth';
import { BankingOperations } from '../types/banking';

export interface MCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleRequest(request: MCPRequest): Promise<MCPResponse>;
  registerTool(tool: MCPTool, handler: ToolHandler): void;
  getTools(): MCPTool[];
}

export interface ToolHandler {
  (call: MCPToolCall, session?: SecureSession): Promise<MCPToolResult>;
}

export interface MCPServerConfig {
  port?: number;
  host?: string;
  authentication: {
    required: boolean;
    provider?: AuthenticationProvider;
  };
  banking: {
    provider: BankingOperations;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
  };
}

export interface ServerContext {
  config: MCPServerConfig;
  authProvider?: AuthenticationProvider;
  bankingProvider: BankingOperations;
  sessions: Map<string, SecureSession>;
}