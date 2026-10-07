'use strict';

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createApp, listen } from '../src';
import type { BrokerConfig } from '../src/config';

const baseConfig: BrokerConfig = {
  port: 0,
  host: '127.0.0.1',
  apiKey: 'test-key',
  tokenEndpoint: 'https://auth.pingone.com/env/as/token',
  clientId: 'agent-client',
  clientSecret: 'super-secret-value',
  tokenAuthMethod: 'post',
  scope: 'agent:invoke',
  audience: '',
  resource: '',
  usePkiCreds: false,
  agentCertPath: '',
  targets: {},
};

const logger = pino({ level: 'silent' });
let dir: string;
let servers: http.Server[] = [];

const whenListening = (s: http.Server) =>
  new Promise<void>((resolve) => (s.listening ? resolve() : s.once('listening', () => resolve())));

const get = (opts: http.RequestOptions) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get(opts, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode as number, body }));
      })
      .on('error', reject);
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ats-sock-'));
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(undefined)))));
  servers = [];
  rmSync(dir, { recursive: true, force: true });
});

test('with a socketPath it serves on the socket and on loopback TCP', async () => {
  const socketPath = path.join(dir, 'sidecar.sock');
  servers = listen(createApp(baseConfig, logger), { ...baseConfig, socketPath }, logger);
  await Promise.all(servers.map(whenListening));

  const viaSocket = await get({ socketPath, path: '/healthz' });
  expect(viaSocket.status).toBe(200);
  expect(JSON.parse(viaSocket.body)).toEqual({ status: 'ok' });

  const port = (servers[0].address() as AddressInfo).port;
  const viaTcp = await get({ host: '127.0.0.1', port, path: '/healthz' });
  expect(viaTcp.status).toBe(200);
});

test('the socket is world-connectable: its volume, not its mode, limits who can reach it', async () => {
  const socketPath = path.join(dir, 'sidecar.sock');
  servers = listen(createApp(baseConfig, logger), { ...baseConfig, socketPath }, logger);
  await Promise.all(servers.map(whenListening));
  expect(statSync(socketPath).mode & 0o777).toBe(0o666);
});

test('a stale file at the socket path does not stop the sidecar from starting', async () => {
  const socketPath = path.join(dir, 'sidecar.sock');
  writeFileSync(socketPath, 'left behind by a previous run');
  servers = listen(createApp(baseConfig, logger), { ...baseConfig, socketPath }, logger);
  await Promise.all(servers.map(whenListening));
  expect((await get({ socketPath, path: '/healthz' })).status).toBe(200);
});

test('without a socketPath only the TCP listener exists (behaviour unchanged)', async () => {
  servers = listen(createApp(baseConfig, logger), baseConfig, logger);
  await Promise.all(servers.map(whenListening));
  expect(servers).toHaveLength(1);
});
