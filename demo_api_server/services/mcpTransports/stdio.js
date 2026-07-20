'use strict';
/**
 * mcpTransports/stdio.js — spawns a local MCP server process (a saved profile's
 * command/args/env, e.g. `npx -y @brave/brave-search-mcp-server --transport
 * stdio` with BRAVE_API_KEY) and speaks the MCP stdio transport: newline-
 * delimited JSON-RPC on stdin/stdout. One process per call — simplest thing
 * that works for an inspector page; not pooled/kept warm.
 */
const { spawn } = require('child_process');

// npx cold-starts (first-run registry fetch) can take several seconds.
const SPAWN_TIMEOUT_MS = 30_000;
const INIT_ID = 1;
const FOLLOW_ID = 2;

function runStdioRpc(profile, followMethod, followParams) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(profile.command, profile.args || [], {
        env: { ...process.env, ...(profile.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`Failed to start MCP server: ${err.message}`));
      return;
    }

    let buffer = '';
    let stderrTail = '';
    let phase = 'awaiting_init';
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error(`MCP stdio server timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (err) reject(err);
      else resolve(result);
    }

    function send(obj) {
      child.stdin.write(JSON.stringify(obj) + '\n');
    }

    function handleMessage(msg) {
      if (phase === 'awaiting_init') {
        if (msg.id !== INIT_ID) return;
        if (msg.error) {
          finish(new Error(msg.error.message || 'MCP initialize error'));
          return;
        }
        phase = 'awaiting_follow';
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: FOLLOW_ID, method: followMethod, params: followParams });
        return;
      }
      if (phase === 'awaiting_follow') {
        if (msg.id !== FOLLOW_ID) return;
        if (msg.error) {
          finish(new Error(msg.error.message || 'MCP RPC error'));
          return;
        }
        finish(null, msg.result);
      }
    }

    child.on('error', (err) => finish(new Error(`Failed to start MCP server: ${err.message}`)));
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.on('exit', (code) => {
      if (!settled) {
        finish(new Error(`MCP server exited (code ${code}) before responding${stderrTail ? `: ${stderrTail.trim().slice(-300)}` : ''}`));
      }
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // ignore non-JSON stdout noise (banners, warnings)
        }
        handleMessage(msg);
      }
    });

    send({
      jsonrpc: '2.0',
      id: INIT_ID,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'demo-api-server-generic-inspector', version: '1.0.0' },
      },
    });
  });
}

async function listTools(profile) {
  const result = await runStdioRpc(profile, 'tools/list', {});
  return { tools: (result && result.tools) || [] };
}

async function callTool(profile, tool, params) {
  return runStdioRpc(profile, 'tools/call', { name: tool, arguments: params || {} });
}

module.exports = { listTools, callTool };
