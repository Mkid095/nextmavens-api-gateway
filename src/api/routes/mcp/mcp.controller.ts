import { Request, Response } from 'express';
import { MCPError, McpErrorCode } from './mcp.types.js';

/**
 * MCP Tool Property Schema
 */
interface MCPToolProperty {
  type: string;
  description: string;
  enum?: string[];
  properties?: Record<string, unknown>;
  items?: MCPToolProperty;
}

/**
 * MCP Tool Definition
 */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPToolProperty>;
    required: string[];
  };
}

/**
 * All available MCP Tools
 */
const MCP_TOOLS: MCPTool[] = [
  // Database Tools
  {
    name: 'nextmavens_query',
    description: 'Execute a database query on NextMavens. Supports SELECT operations with filters.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to query' },
        filters: {
          type: 'array',
          description: 'Array of filters to apply',
          items: {
            type: 'object',
            description: 'Filter object with column, operator, and value',
            properties: {
              column: { type: 'string', description: 'Column name' },
              operator: { type: 'string', description: 'Operator (eq, neq, gt, gte, lt, lte, like, ilike, in)' },
              value: { type: 'string', description: 'Filter value' }
            }
          }
        },
        limit: { type: 'number', description: 'Maximum number of results' },
        offset: { type: 'number', description: 'Number of results to skip' },
        orderBy: {
          type: 'object',
          description: 'Order by clause',
          properties: {
            column: { type: 'string', description: 'Column to order by' },
            ascending: { type: 'boolean', description: 'Sort direction' }
          }
        }
      },
      required: ['table']
    }
  },
  {
    name: 'nextmavens_insert',
    description: 'Insert a row into a database table',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to insert into' },
        data: { type: 'object', description: 'Data to insert (key-value pairs)' }
      },
      required: ['table', 'data']
    }
  },
  {
    name: 'nextmavens_update',
    description: 'Update rows in a database table',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to update' },
        data: { type: 'object', description: 'Data to update (key-value pairs)' },
        filters: {
          type: 'array',
          description: 'Filters to identify rows to update',
          items: {
            type: 'object',
            description: 'Filter object',
            properties: {
              column: { type: 'string', description: 'Column name' },
              operator: { type: 'string', description: 'Operator' },
              value: { type: 'string', description: 'Filter value' }
            }
          }
        }
      },
      required: ['table', 'data', 'filters']
    }
  },
  {
    name: 'nextmavens_delete',
    description: 'Delete rows from a database table',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to delete from' },
        filters: {
          type: 'array',
          description: 'Filters to identify rows to delete',
          items: {
            type: 'object',
            description: 'Filter object',
            properties: {
              column: { type: 'string', description: 'Column name' },
              operator: { type: 'string', description: 'Operator' },
              value: { type: 'string', description: 'Filter value' }
            }
          }
        }
      },
      required: ['table', 'filters']
    }
  },
  // Auth Tools
  {
    name: 'nextmavens_signin',
    description: 'Sign in a user with email and password',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email' },
        password: { type: 'string', description: 'User password' }
      },
      required: ['email', 'password']
    }
  },
  {
    name: 'nextmavens_signup',
    description: 'Sign up a new user',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email' },
        password: { type: 'string', description: 'User password' },
        name: { type: 'string', description: 'User display name' },
        tenantId: { type: 'string', description: 'Tenant ID for multi-tenancy' }
      },
      required: ['email', 'password']
    }
  },
  // Storage Tools
  {
    name: 'nextmavens_file_info',
    description: 'Get information about a file by ID',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'File ID from Telegram storage' }
      },
      required: ['fileId']
    }
  },
  {
    name: 'nextmavens_file_download_url',
    description: 'Get a download URL for a file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'File ID from Telegram storage' }
      },
      required: ['fileId']
    }
  },
  {
    name: 'nextmavens_list_files',
    description: 'List files with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', description: 'Filter by tenant ID' },
        fileType: { type: 'string', description: 'Filter by file type' },
        limit: { type: 'number', description: 'Maximum results to return' },
        offset: { type: 'number', description: 'Number of results to skip' }
      },
      required: []
    }
  },
  // GraphQL Tools
  {
    name: 'nextmavens_graphql',
    description: 'Execute a GraphQL query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GraphQL query' },
        variables: { type: 'object', description: 'GraphQL variables' }
      },
      required: ['query']
    }
  },
  {
    name: 'nextmavens_graphql_introspect',
    description: 'Get GraphQL schema introspection for exploring available types and fields',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

/**
 * Handle MCP initialize request
 */
export function handleInitialize(_req: Request, res: Response): void {
  res.json({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'nextmavens-mcp-server',
        version: '1.0.0'
      }
    }
  });
}

/**
 * Handle MCP tools/list request
 */
export function handleToolsList(_req: Request, res: Response): void {
  res.json({
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: MCP_TOOLS
    }
  });
}

/**
 * Handle MCP tools/call request
 */
export async function handleToolsCall(req: Request, res: Response): Promise<void> {
  const { name, arguments: args } = req.body.params;
  const requestId = req.body.id;

  // Extract API key from Authorization header
  const authHeader = req.headers.authorization;
  const apiKey = authHeader?.replace('Bearer ', '') || req.headers['x-api-key'] as string;

  if (!apiKey) {
    const error: MCPError = {
      code: McpErrorCode.InvalidRequest,
      message: 'API key required. Include Authorization header or X-API-Key header.'
    };
    res.json({
      jsonrpc: '2.0',
      id: requestId,
      error
    });
    return;
  }

  // Determine service URL based on tool
  const getServiceUrl = (toolName: string): string => {
    if (toolName.startsWith('nextmavens_graphql')) {
      return process.env.GRAPHQL_SERVICE_URL || 'http://graphql:4004/graphql';
    }
    if (toolName.startsWith('nextmavens_signin') || toolName.startsWith('nextmavens_signup')) {
      return process.env.AUTH_SERVICE_URL || 'http://auth-service:4000';
    }
    if (toolName.includes('file')) {
      return process.env.STORAGE_SERVICE_URL || 'http://telegram-storage:4005';
    }
    // Default to database API
    return process.env.DATABASE_SERVICE_URL || 'http://postgrest:3000';
  };

  const serviceUrl = getServiceUrl(name);

  try {
    // Build the request based on the tool
    let requestOptions: RequestInit = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      }
    };

    let url = serviceUrl;

    // Configure request based on tool
    switch (name) {
      case 'nextmavens_query': {
        const { table, filters = [], limit, offset, orderBy } = args as any;
        url = `${serviceUrl}/${table}`;
        const params = new URLSearchParams();

        filters.forEach((f: any) => {
          const value = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
          params.append(`${f.column}.${f.operator}`, value);
        });

        if (limit) params.append('limit', String(limit));
        if (offset) params.append('offset', String(offset));
        if (orderBy) {
          const order = orderBy.ascending ? 'asc' : 'desc';
          params.append('order', `${orderBy.column}.${order}`);
        }

        if (params.toString()) url += `?${params.toString()}`;
        break;
      }

      case 'nextmavens_insert': {
        const { table, data } = args as any;
        url = `${serviceUrl}/${table}`;
        requestOptions.method = 'POST';
        requestOptions.body = JSON.stringify(data);
        break;
      }

      case 'nextmavens_update': {
        const { table, data } = args as any;
        url = `${serviceUrl}/${table}`;
        requestOptions.method = 'PATCH';
        requestOptions.body = JSON.stringify(data);
        (requestOptions.headers as Record<string, string>)['Prefer'] = 'return=representation';
        break;
      }

      case 'nextmavens_delete': {
        const { table } = args as any;
        url = `${serviceUrl}/${table}`;
        requestOptions.method = 'DELETE';
        break;
      }

      case 'nextmavens_signin': {
        const { email, password } = args as any;
        url = `${serviceUrl}/api/auth/login`;
        requestOptions.method = 'POST';
        requestOptions.body = JSON.stringify({ email, password });
        break;
      }

      case 'nextmavens_signup': {
        const { email, password, name, tenantId } = args as any;
        url = `${serviceUrl}/api/auth/signup`;
        requestOptions.method = 'POST';
        requestOptions.body = JSON.stringify({
          email,
          password,
          name,
          tenant_id: tenantId
        });
        break;
      }

      case 'nextmavens_file_info': {
        const { fileId } = args as any;
        url = `${serviceUrl}/api/files/${fileId}`;
        break;
      }

      case 'nextmavens_file_download_url': {
        const { fileId } = args as any;
        url = `${serviceUrl}/api/files/${fileId}/download`;
        break;
      }

      case 'nextmavens_list_files': {
        const { tenantId, fileType, limit, offset } = args as any;
        url = `${serviceUrl}/api/files`;
        const params = new URLSearchParams();
        if (tenantId) params.append('tenant_id', tenantId);
        if (fileType) params.append('file_type', fileType);
        if (limit) params.append('limit', String(limit));
        if (offset) params.append('offset', String(offset));
        if (params.toString()) url += `?${params.toString()}`;
        break;
      }

      case 'nextmavens_graphql': {
        const { query, variables } = args as any;
        requestOptions.method = 'POST';
        requestOptions.body = JSON.stringify({
          query,
          variables: variables || {}
        });
        break;
      }

      case 'nextmavens_graphql_introspect': {
        const introspectionQuery = `
          {
            __schema {
              queryType {
                name
                fields {
                  name
                  description
                  type {
                    name
                    kind
                  }
                }
              }
              mutationType {
                name
                fields {
                  name
                  description
                }
              }
            }
          }
        `;
        requestOptions.method = 'POST';
        requestOptions.body = JSON.stringify({ query: introspectionQuery });
        break;
      }

      default: {
        const error: MCPError = {
          code: McpErrorCode.MethodNotFound,
          message: `Unknown tool: ${name}`
        };
        res.json({
          jsonrpc: '2.0',
          id: requestId,
          error
        });
        return;
      }
    }

    // Make the request to the service
    const response = await fetch(url, requestOptions);
    const data = await response.json() as any;

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Request failed');
    }

    // Format response for MCP
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };

    res.json({
      jsonrpc: '2.0',
      id: requestId,
      result
    });

  } catch (error: any) {
    console.error(`[MCP] Error executing ${name}:`, error);

    const mcpError: MCPError = {
      code: McpErrorCode.InternalError,
      message: `Error executing ${name}: ${error.message || 'Unknown error'}`
    };

    res.json({
      jsonrpc: '2.0',
      id: requestId,
      error: mcpError
    });
  }
}

/**
 * Handle MCP ping request
 */
export function handlePing(_req: Request, res: Response): void {
  res.json({
    jsonrpc: '2.0',
    id: 1,
    result: {}
  });
}
