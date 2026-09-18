import { normalizeMcpServerNames, type RecoveryResult } from './McpErrorRecovery';

export interface McpInitializationResult {
  success: boolean;
  oauthRequired?: boolean;
}

export interface McpRecoveryInputs {
  serverNames: readonly string[] | (() => readonly string[]);
  initializeServer: (serverName: string, force: boolean) => Promise<McpInitializationResult>;
  deleteMessage: () => Promise<void>;
}

export type McpRecoveryControllerOptions =
  | (McpRecoveryInputs & {
      timeoutMs: number;
    })
  | {
      getRecoveryInputs: () => McpRecoveryInputs;
      timeoutMs: number;
    };

function getRecoveryInputs(options: McpRecoveryControllerOptions): McpRecoveryInputs {
  if ('getRecoveryInputs' in options) {
    return options.getRecoveryInputs();
  }
  return options;
}

interface RecoveryTimeoutOptions {
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

export function createMcpRecoveryController(options: McpRecoveryControllerOptions) {
  const { timeoutMs } = options as RecoveryTimeoutOptions;
  let inFlight: Promise<RecoveryResult> | undefined;
  const serverOperations = new Map<string, Promise<McpInitializationResult>>();

  function initialize(
    serverName: string,
    initializeServer: McpRecoveryInputs['initializeServer'],
  ): Promise<McpInitializationResult> {
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
    const recoveryInputs = getRecoveryInputs(options);
    const normalizedServerNames = normalizeMcpServerNames(
      typeof recoveryInputs.serverNames === 'function'
        ? recoveryInputs.serverNames()
        : recoveryInputs.serverNames,
    );
    if (normalizedServerNames.length === 0) {
      return { status: 'no-server' };
    }
    if (normalizedServerNames.some((serverName) => serverOperations.has(serverName))) {
      return { status: 'in-flight' };
    }

    const results = await Promise.all(
      normalizedServerNames.map((serverName) =>
        initializeWithTimeout(initialize(serverName, recoveryInputs.initializeServer), timeoutMs),
      ),
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
      await recoveryInputs.deleteMessage();
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
