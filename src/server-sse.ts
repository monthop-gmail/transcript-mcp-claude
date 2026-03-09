#!/usr/bin/env node

/**
 * MCP Server for All-in-One Transcription - Streamable HTTP Transport
 * รวม YouTube, Audio, Video transcript + Translation, Summarization, Chapters, Subtitles, Batch
 */

import http from 'http';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { TOOLS, handleToolCall } from './tools/index.js';

function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'transcript-mcp-claude',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args as Record<string, unknown>);
  });

  return server;
}

const transports = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      server: 'transcript-mcp-claude',
      version: '2.0.0',
      transport: 'streamable-http',
      whisper_model: config.WHISPER_MODEL,
      tools: TOOLS.map(t => t.name),
      tool_count: TOOLS.length,
    }));
    return;
  }

  // Streamable HTTP endpoint
  if (url.pathname === '/mcp') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk; });
      req.on('end', async () => {
        try {
          const jsonBody = JSON.parse(body);
          const sessionId = req.headers['mcp-session-id'] as string;

          let transport: StreamableHTTPServerTransport;

          if (sessionId && transports.has(sessionId)) {
            transport = transports.get(sessionId)!.transport;
          } else if (!sessionId && isInitializeRequest(jsonBody)) {
            const server = createMCPServer();
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (sid) => {
                transports.set(sid, { server, transport });
              },
            });
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) transports.delete(sid);
            };
            await server.connect(transport);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: No valid session ID' },
              id: null,
            }));
            return;
          }

          await transport.handleRequest(req, res, jsonBody);
        } catch (error) {
          console.error('Error handling MCP request:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      return;
    }

    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
        return;
      }
      await transports.get(sessionId)!.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
        return;
      }
      await transports.get(sessionId)!.transport.handleRequest(req, res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: {
      '/mcp': 'Streamable HTTP endpoint (GET, POST, DELETE)',
      '/health': 'Health check',
    },
  }));
});

async function main(): Promise<void> {
  httpServer.listen(config.PORT, config.HOST, () => {
    console.log(`Transcript MCP Server v2.0 (Streamable HTTP)`);
    console.log(`Listening on http://${config.HOST}:${config.PORT}`);
    console.log(`MCP endpoint: http://${config.HOST}:${config.PORT}/mcp`);
    console.log(`Health check: http://${config.HOST}:${config.PORT}/health`);
    console.log(`Tools: ${TOOLS.length}`);
    console.log(`Whisper model: ${config.WHISPER_MODEL}`);
  });
}

process.on('SIGINT', () => {
  console.log('Shutting down...');
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  httpServer.close();
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
