/**
 * MCP Error Codes
 */
export enum McpErrorCode {
  // Standard JSON-RPC errors
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,

  // MCP-specific errors
  ServerNotInitialized = -32000,
  UnknownErrorCode = -32001,

  // Application errors
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  RateLimited = 429,
  ServiceUnavailable = 503
}

/**
 * MCP Error Object
 */
export interface MCPError {
  code: McpErrorCode | number;
  message: string;
  data?: unknown;
}

/**
 * MCP Request (JSON-RPC 2.0)
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP Response (JSON-RPC 2.0)
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: any;
    }>;
    required: string[];
  };
}

/**
 * MCP Initialize Result
 */
export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

/**
 * MCP Tools List Result
 */
export interface MCPToolsListResult {
  tools: MCPTool[];
}

/**
 * MCP Tool Call Result
 */
export interface MCPToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    uri?: string;
  }>;
  isError?: boolean;
}
