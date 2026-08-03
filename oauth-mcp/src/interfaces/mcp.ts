/**
 * MCP Protocol Interfaces
 * Core interfaces for Model Context Protocol communication
 */

export interface MCPMessage {
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export interface MCPResponse {
  jsonrpc?: '2.0';
  id: string | number | null;
  result?: Record<string, any>;
  error?: MCPError;
}

export interface MCPError {
  code: MCPErrorCode;
  message: string;
  data?: {
    type?: string;
    details?: any;
    stack?: string;
    timestamp?: string;
    requestId?: string;
  };
}

export enum MCPErrorCode {
  // JSON-RPC Standard Errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // MCP-Specific Errors
  UNAUTHORIZED = -32001,
  FORBIDDEN = -32002,
  INVALID_TOKEN = -32003,
  TOKEN_EXPIRED = -32004,
  INSUFFICIENT_SCOPE = -32005,
  TOOL_NOT_FOUND = -32006,
  TOOL_EXECUTION_ERROR = -32007,
  RATE_LIMITED = -32008,
  
  // Banking-Specific Errors
  ACCOUNT_NOT_FOUND = -32050,
  INSUFFICIENT_FUNDS = -32051,
  TRANSACTION_FAILED = -32052,
  INVALID_AMOUNT = -32053,
  ACCOUNT_LOCKED = -32054
}

export interface HandshakeMessage extends MCPMessage {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    clientInfo?: {
      name: string;
      version: string;
      /** Optional human-readable description (spec 2025-11-25). */
      description?: string;
    };
    agentToken?: string;
  };
}

export interface HandshakeResponse extends MCPResponse {
  result: {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: ServerInfo;
  };
}

export interface ListToolsMessage extends MCPMessage {
  method: 'tools/list';
  params?: {
    cursor?: string;
  };
}

export interface ListToolsResponse extends MCPResponse {
  result: {
    tools: ToolDefinition[];
    nextCursor?: string;
    ttlMs?: number;                    // Cache duration in milliseconds (2026-07-28 SEP-2549)
    cacheScope?: 'shared' | 'user';    // Cache scope for multi-user environments
  };
}

export interface ToolCallMessage extends MCPMessage {
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, any>;
  };
}

export interface ToolCallResponse extends MCPResponse {
  result: {
    content: ToolResult[];
    isError?: boolean;
    /**
     * MCP-spec extension slot for server-defined data. The OAuth authorization
     * challenge (when a tool needs more scope) is published here as
     * `_meta.authChallenge` — the canonical (and only) location.
     */
    _meta?: Record<string, unknown>;
  };
}

export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  logging?: Record<string, never>;
  prompts?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
}

export interface ServerInfo {
  name: string;
  version: string;
  description?: string;
}

export interface ToolDefinition {
  name: string;
  /** Optional human-readable display name shown in UIs (spec 2025-11-25). */
  title?: string;
  description: string;
  inputSchema: JSONSchema;
  /** Optional JSON Schema 2020-12 for structured output. When present, tool results MUST include structuredContent. */
  outputSchema?: JSONSchema;
  /** Optional display icons (spec 2025-11-25). */
  icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
  /** Optional metadata about tool behaviour. Treat as untrusted unless from a trusted server. */
  annotations?: Record<string, any>;
  /** Task-augmented execution support (spec 2025-11-25). Default: 'forbidden'. */
  execution?: {
    taskSupport?: 'forbidden' | 'optional' | 'required';
  };
  requiresUserAuth: boolean;
  requiredScopes: string[];
}

export interface ToolResult {
  type: 'text' | 'image' | 'audio' | 'resource' | 'resource_link';
  text?: string;
  data?: string;
  mimeType?: string;
  /** For resource_link: URI of the referenced resource. */
  uri?: string;
  /** For resource_link: display name. */
  name?: string;
  /** Structured output object when the tool declared an outputSchema (spec 2025-11-25). */
  structuredContent?: Record<string, any>;
  /** Optional annotations (audience, priority, lastModified) per spec. */
  annotations?: Record<string, any>;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  expiresAt: Date;
  codeVerifier?: string; // For PKCE flow
}