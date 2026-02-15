#!/usr/bin/env node

/**
 * MCP Server for All-in-One Transcription - SSE Transport
 * รวม YouTube, Audio, Video transcript + Translation, Summarization, Chapters, Subtitles, Batch
 */

import http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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

interface ActiveConnection {
  server: Server;
  transport: SSEServerTransport;
}

const activeTransports = new Map<string, ActiveConnection>();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      transport: 'sse',
      whisper_model: config.WHISPER_MODEL,
      tools: TOOLS.map(t => t.name),
      tool_count: TOOLS.length,
    }));
    return;
  }

  if (url.pathname === '/sse') {
    console.log('New SSE connection');

    const server = createMCPServer();
    const transport = new SSEServerTransport('/messages', res);

    const connectionId = Date.now().toString();
    activeTransports.set(connectionId, { server, transport });

    res.on('close', () => {
      console.log('SSE connection closed');
      activeTransports.delete(connectionId);
    });

    await server.connect(transport);
    return;
  }

  if (url.pathname === '/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        for (const [, { transport }] of activeTransports) {
          if (transport.handlePostMessage) {
            await transport.handlePostMessage(req, res, body);
            return;
          }
        }
        res.writeHead(404);
        res.end('No active session');
      } catch (error) {
        console.error('Error handling message:', error);
        res.writeHead(500);
        res.end('Internal error');
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: {
      '/sse': 'SSE connection endpoint',
      '/messages': 'Message endpoint (POST)',
      '/health': 'Health check',
    },
  }));
});

async function main(): Promise<void> {
  httpServer.listen(config.PORT, config.HOST, () => {
    console.log(`Transcript MCP Server v2.0 (SSE)`);
    console.log(`Listening on http://${config.HOST}:${config.PORT}`);
    console.log(`SSE endpoint: http://${config.HOST}:${config.PORT}/sse`);
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
