#!/usr/bin/env node
/**
 * stdio transport — for Claude Desktop, Claude Code, or any local MCP host.
 *
 * Identity comes from env (MCP_USERNAME / MCP_PASSWORD), because stdio has no
 * per-request headers. Give the service account the least role that works.
 */
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './createServer.js';

const server = createServer({
  username: process.env.MCP_USERNAME,
  password: process.env.MCP_PASSWORD,
});

const transport = new StdioServerTransport();

await server.connect(transport);

// Never write to stdout here — stdout is the MCP wire protocol.
console.error('[mcp] address-book MCP server ready on stdio');
