import { Application } from 'express';
import {
  handleInitialize,
  handlePing,
  handleToolsList,
  handleToolsCall
} from './mcp.controller.js';

/**
 * Configure MCP (Model Context Protocol) routes
 *
 * These routes implement the Model Context Protocol for AI assistant integration.
 * The MCP endpoint allows AI assistants (Claude Code, Cursor, etc.) to interact
 * with NextMavens services through a standardized JSON-RPC 2.0 interface.
 *
 * @param app - Express application instance
 */
export function configureMCPRoutes(app: Application): void {
  /**
   * POST /mcp
   *
   * Main MCP endpoint that handles all JSON-RPC 2.0 requests.
   * Routes requests to appropriate handlers based on the method.
   */
  app.post('/mcp', async (req, res) => {
    const { method } = req.body;

    // Validate JSON-RPC 2.0 request format
    if (!req.body.jsonrpc || req.body.jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: req.body.id || null,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc version must be "2.0"'
        }
      });
    }

    if (!req.body.method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: req.body.id || null,
        error: {
          code: -32600,
          message: 'Invalid Request: method is required'
        }
      });
    }

    // Route to appropriate handler based on method
    switch (method) {
      case 'initialize':
        return handleInitialize(req, res);

      case 'ping':
        return handlePing(req, res);

      case 'tools/list':
        return handleToolsList(req, res);

      case 'tools/call':
        return await handleToolsCall(req, res);

      default:
        return res.status(404).json({
          jsonrpc: '2.0',
          id: req.body.id || null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
    }
  });

  /**
   * GET /mcp
   *
   * Returns MCP server information for discovery
   */
  app.get('/mcp', (_req, res) => {
    res.json({
      name: 'nextmavens-mcp-server',
      version: '1.0.0',
      description: 'Model Context Protocol server for NextMavens platform',
      endpoints: {
        mcp: '/mcp',
        health: '/health'
      },
      tools: [
        'nextmavens_query',
        'nextmavens_insert',
        'nextmavens_update',
        'nextmavens_delete',
        'nextmavens_signin',
        'nextmavens_signup',
        'nextmavens_file_info',
        'nextmavens_file_download_url',
        'nextmavens_list_files',
        'nextmavens_graphql',
        'nextmavens_graphql_introspect'
      ],
      documentation: 'https://nextmavens.cloud/mcp'
    });
  });
}
