'use strict';

/**
 * Credential-injecting relay for PingOne's OAuth endpoints.
 *
 * A caller builds the request it would send to PingOne (a token, PAR or introspection form)
 * for a client this sidecar manages, leaves the client's secret out, and posts it here. The
 * relay adds the client's authentication, forwards the form to PingOne, and returns PingOne's
 * status and body UNCHANGED, so the caller's existing response and error handling keep working.
 * The caller never holds the secret.
 *
 *   POST /as/token | /as/par | /as/introspect   (x-api-key, form-encoded, client_id in the form)
 *   GET  /v1/clients                            ids of the managed clients (never secrets)
 *
 * Only those three endpoints and only managed client ids are served, and a caller cannot
 * supply credentials of its own: a request carrying client_secret or a client assertion is
 * refused, so this cannot be used to authenticate as a client it was not configured for.
 */

import axios from 'axios';
import express, { type Express } from 'express';
import type pino from 'pino';
import { makeApiKeyAuth } from './apiKeyAuth';
import type { BrokerConfig, ManagedClient } from './config';

const KINDS = new Set(['token', 'par', 'introspect']);
const CALLER_CREDENTIALS = ['client_secret', 'client_assertion', 'client_assertion_type'];
const TIMEOUT_MS = 15000;

/** The primary identity (unless it uses private_key_jwt, which has no secret to inject) plus the extras. */
export function managedClientsOf(config: BrokerConfig): ManagedClient[] {
  const primary: ManagedClient[] =
    config.usePkiCreds || !config.clientSecret
      ? []
      : [{ id: config.clientId, secret: config.clientSecret, authMethod: config.tokenAuthMethod }];
  return [...primary, ...(config.managedClients ?? [])];
}

/** https://auth.pingone.com/<env>/as/token -> https://auth.pingone.com/<env>/as */
export function upstreamBase(tokenEndpoint: string): string {
  return tokenEndpoint.replace(/\/token\/?$/, '');
}

export function mountRelay(app: Express, config: BrokerConfig, logger: pino.Logger): void {
  const clients = new Map(managedClientsOf(config).map((c) => [c.id, c]));
  const auth = makeApiKeyAuth(config.apiKey);
  const base = upstreamBase(config.tokenEndpoint);

  app.get('/v1/clients', auth, (_req, res) => {
    res.json({ clients: [...clients.keys()] });
  });

  app.post(
    '/as/:kind',
    auth,
    express.urlencoded({ extended: false, limit: '64kb' }),
    async (req, res) => {
      const kind = String(req.params.kind);
      if (!KINDS.has(kind)) {
        res.status(404).json({ error: 'unknown_endpoint' });
        return;
      }

      const body = (req.body || {}) as Record<string, string | string[]>;
      const clientId = Array.isArray(body.client_id) ? body.client_id[0] : body.client_id;
      const client = clientId && clients.has(clientId) ? clients.get(clientId) : undefined;
      if (!client) {
        res.status(400).json({
          error: 'invalid_client',
          error_description: 'client is not managed by this sidecar',
        });
        return;
      }
      if (CALLER_CREDENTIALS.some((k) => k in body)) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'the caller must not send client credentials; the sidecar adds them',
        });
        return;
      }

      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        for (const value of Array.isArray(v) ? v : [v]) form.append(k, value);
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (client.authMethod === 'basic') {
        form.delete('client_id');
        headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`;
      } else {
        form.set('client_secret', client.secret);
      }

      let upstream;
      try {
        upstream = await axios.post(`${base}/${kind}`, form.toString(), {
          headers,
          timeout: TIMEOUT_MS,
          // Relay every status, errors included: the caller reads PingOne's own error body.
          validateStatus: () => true,
          responseType: 'text',
          transformResponse: (d) => d,
        });
      } catch (err) {
        // Axios errors carry the request config (and so the secret): log the message only.
        logger.error({ client_id: client.id, kind, detail: err instanceof Error ? err.message : 'unknown' }, 'relay upstream unreachable');
        res.status(502).json({ error: 'upstream_unreachable' });
        return;
      }

      logger.info({ client_id: client.id, kind, upstream_status: upstream.status }, 'relayed');
      res
        .status(upstream.status)
        .set('Content-Type', String(upstream.headers['content-type'] || 'application/json'))
        .send(upstream.data);
    },
  );
}
