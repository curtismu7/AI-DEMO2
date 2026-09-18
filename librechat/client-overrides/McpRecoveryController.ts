import { normalizeMcpServerNames, type RecoveryResult } from './McpErrorRecovery';

export interface McpInitializationResult {
  success: boolean;
  oauthRequired?: boolean;
}

export interface McpRecoveryControllerOptions {
  serverNames: readonly string[];
  initializeServer: (serverName: string, force: boolean) => Promise<McpInitializationResult>;
  deleteMessage: () => Promise<void>;
  timeoutMs: number;
}

type InitializationOutcome = 'recovered' | 'authentication-required' | 'reconnect-failed' | 'timeout';

function initializeWithTimeout(
  initialization: Promise<McpInitializationResult>,
  timeoutMs: number,
): Promise<InitializationOutcome> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const outcome = initialization
    .then((result): InitializationOutcome => {
      if (result.oauthRequired) {
        return 'authentication-required';
      }
      return result.success ? 'recovered' : 'reconnect-failed';
    })
    .catch((): InitializationOutcome => 'reconnect-failed');

  const timeout = new Promise<InitializationOutcome>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  return Promise.race([outcome, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

export function createMcpRecoveryController({
  serverNames,
  initializeServer,
  deleteMessage,
  timeoutMs,
}: McpRecoveryControllerOptions) {
  let inFlight: Promise<RecoveryResult> | undefined;
  const serverOperations = new Map<string, Promise<McpInitializationResult>>();

  function initialize(serverName: string): Promise<McpInitializationResult> {
    const operation = Promise.resolve().then(() => initializeServer(serverName, true));
    serverOperations.set(serverName, operation);
    const releaseOperation = () => {
      if (serverOperations.get(serverName) === operation) {
        serverOperations.delete(serverName);
      }
    };
    operation.then(releaseOperation, releaseOperation);
    return operation;
  }

  async function recoverOnce(): Promise<RecoveryResult> {
    const normalizedServerNames = normalizeMcpServerNames(serverNames);
    if (normalizedServerNames.length === 0) {
      return { status: 'no-server' };
    }
    if (normalizedServerNames.some((serverName) => serverOperations.has(serverName))) {
      return { status: 'in-flight' };
    }

    const results = await Promise.all(
      normalizedServerNames.map((serverName) => initializeWithTimeout(initialize(serverName), timeoutMs)),
    );

    if (results.includes('authentication-required')) {
      return { status: 'authentication-required' };
    }
    if (results.includes('timeout')) {
      return { status: 'timeout' };
    }
    if (results.includes('reconnect-failed')) {
      return { status: 'reconnect-failed' };
    }

    try {
      await deleteMessage();
      return { status: 'recovered' };
    } catch {
      return { status: 'delete-failed' };
    }
  }

  return {
    async recover(): Promise<RecoveryResult> {
      if (inFlight) {
        return { status: 'in-flight' };
      }

      const attempt = recoverOnce();
      inFlight = attempt;
      try {
        return await attempt;
      } finally {
        if (inFlight === attempt) {
          inFlight = undefined;
        }
      }
    },
  };
}
