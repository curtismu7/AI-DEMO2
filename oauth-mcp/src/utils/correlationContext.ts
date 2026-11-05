import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore { correlationId: string; activeVertical?: string; }

const als = new AsyncLocalStorage<CorrelationStore>();

// A vertical id as the BFF validates it (parseVerticalParam).
const VERTICAL_ID = /^[a-z][a-z0-9-]{0,63}$/;

/** The X-Active-Vertical header value when it is a well-formed vertical id, else undefined. */
export function activeVerticalFrom(header: unknown): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && VERTICAL_ID.test(value.trim()) ? value.trim() : undefined;
}

export function runWithCorrelation<T>(correlationId: string, fn: () => T, extra: { activeVertical?: string } = {}): T {
  return als.run({ correlationId, ...(extra.activeVertical ? { activeVertical: extra.activeVertical } : {}) }, fn);
}

export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

/**
 * The vertical the caller's session is on, as the BFF stamped it on this MCP
 * request. Forwarded on the BFF calls made for this request so they act on
 * that vertical's data, not the BFF's process-wide default.
 */
export function getActiveVertical(): string | undefined {
  return als.getStore()?.activeVertical;
}

export { als };
