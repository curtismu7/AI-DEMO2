'use strict';

import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Front-door auth for the broker. Callers (e.g. a Copilot Studio REST/MCP tool)
 * must present the shared key in the `x-api-key` header. The comparison is
 * constant-time so the endpoint doesn't leak the key length/prefix via timing.
 */
export function makeApiKeyAuth(expectedKey: string) {
  // Pre-encode the expected key once.
  const expected = Buffer.from(expectedKey);

  return function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    const provided = req.header('x-api-key') || '';
    const providedBuf = Buffer.from(provided);

    // timingSafeEqual throws if lengths differ, so length-check first but still
    // run the compare against a fixed-length buffer to keep timing uniform.
    const ok =
      providedBuf.length === expected.length && timingSafeEqual(providedBuf, expected);

    if (!ok) {
      res.status(401).json({ error: 'invalid_api_key' });
      return;
    }
    next();
  };
}
