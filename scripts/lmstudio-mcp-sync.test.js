#!/usr/bin/env node
/**
 * Tests for lmstudio-mcp-sync.js.
 * Run: node --test scripts/lmstudio-mcp-sync.test.js
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'lmstudio-mcp-sync.js');
const { planAdditions } = require('./lmstudio-mcp-sync');

let tmpDir;
let targetFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-mcp-sync-'));
  targetFile = path.join(tmpDir, 'mcp.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LMSTUDIO_MCP_JSON_PATH: targetFile },
  });
}

describe('planAdditions', () => {
  it('proposes all known doors when mcpServers is empty', () => {
    const { toAdd, alreadyPresent } = planAdditions({ mcpServers: {} });
    assert.equal(alreadyPresent.length, 0);
    assert.equal(toAdd.length, 3);
  });

  it('skips a door whose url already exists under a different key', () => {
    const { toAdd, alreadyPresent } = planAdditions({
      mcpServers: { 'My Own Grafana Alias': { url: 'https://mcpgw.ai-demo.ping-devops.com/mcp-grafana/mcp' } },
    });
    assert.equal(alreadyPresent.length, 1);
    assert.equal(alreadyPresent[0].key, 'MCP Privilege-Grafana');
    assert.equal(toAdd.length, 2);
  });
});

describe('CLI: dry run (default)', () => {
  it('never writes the file, even when it does not exist yet', () => {
    const res = run([]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /would add "MCP Privilege-Banking"/);
    assert.match(res.stdout, /Dry run only/);
    assert.equal(fs.existsSync(targetFile), false);
  });

  it('reports doors already present and does not re-propose them', () => {
    fs.writeFileSync(targetFile, JSON.stringify({
      mcpServers: { Existing: { url: 'https://mcpgw.ai-demo.ping-devops.com/mcp-grafana/mcp' } },
    }));
    const res = run([]);
    assert.match(res.stdout, /already present — https:\/\/mcpgw\.ai-demo\.ping-devops\.com\/mcp-grafana\/mcp/);
    assert.doesNotMatch(res.stdout, /would add "MCP Privilege-Grafana"/);
  });
});

describe('CLI: --apply', () => {
  it('backs up the existing file and merges new entries without touching existing ones', () => {
    fs.writeFileSync(targetFile, JSON.stringify({
      mcpServers: { 'Unrelated Server': { url: 'https://example.test/mcp' } },
    }, null, 2));

    const res = run(['--apply']);
    assert.equal(res.status, 0);

    const written = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    assert.equal(written.mcpServers['Unrelated Server'].url, 'https://example.test/mcp');
    assert.equal(written.mcpServers['MCP Privilege-Banking'].url, 'https://mcpgw.ai-demo.ping-devops.com/openapi2/mcp');
    assert.equal(written.mcpServers['MCP Privilege-Brave'].url, 'https://mcpgw.ai-demo.ping-devops.com/mcp-brave-search/mcp');
    // No auth/headers field — see the script's own header comment on why.
    assert.equal('headers' in written.mcpServers['MCP Privilege-Banking'], false);

    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('mcp.json.bak-'));
    assert.equal(backups.length, 1);
    const backedUp = JSON.parse(fs.readFileSync(path.join(tmpDir, backups[0]), 'utf8'));
    assert.deepEqual(backedUp.mcpServers, { 'Unrelated Server': { url: 'https://example.test/mcp' } });
  });

  it('creates the file (no backup) when none exists yet', () => {
    const res = run(['--apply']);
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(targetFile), true);
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('mcp.json.bak-'));
    assert.equal(backups.length, 0);
  });

  it('is idempotent — a second run adds nothing new', () => {
    run(['--apply']);
    const before = fs.readFileSync(targetFile, 'utf8');
    const res = run(['--apply']);
    assert.match(res.stdout, /Nothing to add/);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), before);
  });
});
