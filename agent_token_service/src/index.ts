'use strict';

/**
 * agent_token_service — entry point.
 *
 * A standalone, reusable broker that mints a PingOne AI_AGENT client-credentials
 * token and returns it to API-key-authenticated callers. Built for a Microsoft
 * Copilot Studio REST/MCP tool (its OAuth Token URL points here), but usable by
 * any application that needs a PingOne agent token without holding the PingOne
 * client secret itself.
 *
 * Surface:
 *   POST /token   — (x-api-key gated) → { access_token, token_type, expires_in, scope }
 *   GET  /healthz — liveness probe (unauthenticated; does not call PingOne)
 */

import dotenv from 'dotenv';
dotenv.config();

import { chmodSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { loadConfig, type BrokerConfig } from './config';
import { makeApiKeyAuth } from './apiKeyAuth';
import { acquireAgentToken, type Logger } from './pingoneAgentToken';

export function createApp(config: BrokerConfig, logger: pino.Logger): Express {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      // Never log the API key or any Authorization header.
      redact: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    }),
  );

  // Liveness — unauthenticated, no PingOne call.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Token issuance — API-key gated.
  const tokenLogger: Logger = {
    info: (obj, msg) => logger.info(obj as object, msg),
    error: (obj, msg) => logger.error(obj as object, msg),
  };

  app.post('/token', makeApiKeyAuth(config.apiKey), async (_req, res) => {
    try {
      const token = await acquireAgentToken(config, tokenLogger);
      res.json({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
      });
    } catch (err) {
      // Error message is already scrubbed of credentials by pingoneAgentToken.
      const detail = err instanceof Error ? err.message : 'unknown';
      logger.error({ detail }, 'token issuance failed');
      res.status(502).json({ error: 'token_issuance_failed', detail });
    }
  });

  // Sidecar endpoint — the agent names a target, the sidecar owns scope/audience.
  app.post('/v1/token', makeApiKeyAuth(config.apiKey), express.json(), async (req, res) => {
    const target = req.body?.target;
    if (target !== undefined && typeof target !== 'string') {
      res.status(400).json({ error: 'invalid_target' });
      return;
    }
    if (target !== undefined && !Object.prototype.hasOwnProperty.call(config.targets, target)) {
      res.status(400).json({ error: 'unknown_target' });
      return;
    }
    const effective = target === undefined ? config : { ...config, ...config.targets[target] };
    try {
      const token = await acquireAgentToken(effective, tokenLogger);
      res.json({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown';
      logger.error({ detail, target }, 'token issuance failed');
      res.status(502).json({ error: 'token_issuance_failed', detail });
    }
  });

  return app;
}

/**
 * Serve on host:port and, when SOCKET_PATH is set, on that Unix socket as well.
 *
 * With a socket, keep HOST on loopback: the TCP listener is then reachable only from inside
 * this container (the health check), and callers use the socket, so reaching the sidecar needs
 * the volume it lives on, not just a place on the compose network.
 */
export function listen(app: Express, config: BrokerConfig, logger: pino.Logger): Server[] {
  const servers: Server[] = [
    app.listen(config.port, config.host, () => {
      logger.info(
        { host: config.host, port: config.port, client_id: config.clientId, scope: config.scope },
        'agent_token_service listening',
      );
    }),
  ];
  if (config.socketPath) {
    const socketPath = config.socketPath;
    // A socket file left by a previous run makes listen() fail with EADDRINUSE.
    rmSync(socketPath, { force: true });
    servers.push(
      app.listen(socketPath, () => {
        // 0666: the socket's volume, not its mode, is what limits who can connect.
        chmodSync(socketPath, 0o666);
        logger.info({ socketPath }, 'agent_token_service listening on unix socket');
      }),
    );
  }
  return servers;
}

// Bootstrap only when run directly (not when imported by tests).
if (require.main === module) {
  const logger = pino(
    process.env.NODE_ENV === 'production'
      ? {}
      : { transport: { target: 'pino-pretty' } },
  );

  let config: BrokerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error(
      { detail: err instanceof Error ? err.message : err },
      'configuration error — refusing to start',
    );
    process.exit(1);
  }

  listen(createApp(config, logger), config, logger);
}
