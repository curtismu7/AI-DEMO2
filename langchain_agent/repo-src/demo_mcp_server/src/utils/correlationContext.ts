import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore { correlationId: string; }

const als = new AsyncLocalStorage<CorrelationStore>();

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

export { als };
