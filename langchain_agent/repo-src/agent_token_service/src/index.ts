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

  return app;
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

  const app = createApp(config, logger);
  app.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port, client_id: config.clientId, scope: config.scope },
      'agent_token_service listening',
    );
  });
}
