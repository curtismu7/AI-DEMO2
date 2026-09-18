import { createMcpRecoveryController } from './McpRecoveryController';

type InitializeResult = { success: boolean; oauthRequired?: boolean };

function createController(options: {
  serverNames?: string[];
  initializeServer?: jest.Mock<Promise<InitializeResult>, [string, boolean]>;
  deleteMessage?: jest.Mock<Promise<void>, []>;
  timeoutMs?: number;
} = {}) {
  const initializeServer =
    options.initializeServer ?? jest.fn<Promise<InitializeResult>, [string, boolean]>().mockResolvedValue({ success: true });
  const deleteMessage = options.deleteMessage ?? jest.fn<Promise<void>, []>().mockResolvedValue();

  return {
    initializeServer,
    deleteMessage,
    controller: createMcpRecoveryController({
      serverNames: options.serverNames ?? ['super-sports-gateway'],
      initializeServer,
      deleteMessage,
      timeoutMs: options.timeoutMs ?? 100,
    }),
  };
}

describe('MCP recovery controller', () => {
  test('does not initialize or delete when no MCP servers are selected', async () => {
    const { controller, initializeServer, deleteMessage } = createController({ serverNames: [] });

    await expect(controller.recover()).resolves.toEqual({ status: 'no-server' });
    expect(initializeServer).toHaveBeenCalledTimes(0);
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  test('reports an in-flight result for a duplicate click', async () => {
    let resolveInitialization: ((result: InitializeResult) => void) | undefined;
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>(
      () => new Promise((resolve) => {
        resolveInitialization = resolve;
      }),
    );
    const { controller } = createController({ initializeServer });

    const first = controller.recover();
    const second = controller.recover();

    await expect(second).resolves.toEqual({ status: 'in-flight' });
    resolveInitialization?.({ success: true });
    await expect(first).resolves.toEqual({ status: 'recovered' });
    expect(initializeServer).toHaveBeenCalledTimes(1);
  });

  test('keeps the message when authentication is required', async () => {
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>().mockResolvedValue({
      success: false,
      oauthRequired: true,
    });
    const { controller, deleteMessage } = createController({ initializeServer });

    await expect(controller.recover()).resolves.toEqual({ status: 'authentication-required' });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  test('deletes only after a successful reconnect', async () => {
    const { controller, initializeServer, deleteMessage } = createController();

    await expect(controller.recover()).resolves.toEqual({ status: 'recovered' });
    expect(initializeServer).toHaveBeenCalledWith('super-sports-gateway', true);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  test('initializes each unique server once', async () => {
    const { controller, initializeServer } = createController({
      serverNames: ['super-sports-gateway', ' super-sports-gateway ', 'aidemo-mcp'],
    });

    await expect(controller.recover()).resolves.toEqual({ status: 'recovered' });
    expect(initializeServer).toHaveBeenCalledTimes(2);
    expect(initializeServer).toHaveBeenNthCalledWith(1, 'super-sports-gateway', true);
    expect(initializeServer).toHaveBeenNthCalledWith(2, 'aidemo-mcp', true);
  });

  test('keeps the message when initialization rejects', async () => {
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>().mockRejectedValue(new Error('offline'));
    const { controller, deleteMessage } = createController({ initializeServer });

    await expect(controller.recover()).resolves.toEqual({ status: 'reconnect-failed' });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  test('allows a later explicit retry after a failed attempt', async () => {
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ success: true });
    const { controller } = createController({ initializeServer });

    await expect(controller.recover()).resolves.toEqual({ status: 'reconnect-failed' });
    await expect(controller.recover()).resolves.toEqual({ status: 'recovered' });
    expect(initializeServer).toHaveBeenCalledTimes(2);
  });

  test('times out an initialization without waiting in real time', async () => {
    jest.useFakeTimers();
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>(
      () => new Promise(() => undefined),
    );
    const { controller, deleteMessage } = createController({ initializeServer, timeoutMs: 100 });

    const recovery = controller.recover();
    await jest.advanceTimersByTimeAsync(100);

    await expect(recovery).resolves.toEqual({ status: 'timeout' });
    expect(deleteMessage).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('does not start another initialization after a timeout until the original settles', async () => {
    jest.useFakeTimers();
    const resolvers: Array<(result: InitializeResult) => void> = [];
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>(
      () => new Promise((resolve) => {
        resolvers.push(resolve);
      }),
    );
    const { controller } = createController({ initializeServer, timeoutMs: 100 });

    try {
      const firstRecovery = controller.recover();
      await jest.advanceTimersByTimeAsync(100);
      await expect(firstRecovery).resolves.toEqual({ status: 'timeout' });

      const laterRecovery = controller.recover();
      await jest.advanceTimersByTimeAsync(0);

      expect(initializeServer).toHaveBeenCalledTimes(1);
      resolvers[0]({ success: true });
      await expect(laterRecovery).resolves.toEqual({ status: 'in-flight' });
    } finally {
      resolvers.forEach((resolve) => resolve({ success: true }));
      await jest.runAllTimersAsync();
      jest.useRealTimers();
    }
  });

  test('keeps the message when one selected server fails', async () => {
    const initializeServer = jest.fn<Promise<InitializeResult>, [string, boolean]>()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    const { controller, deleteMessage } = createController({
      serverNames: ['super-sports-gateway', 'aidemo-mcp'],
      initializeServer,
    });

    await expect(controller.recover()).resolves.toEqual({ status: 'reconnect-failed' });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  test('reports a deletion failure after every server reconnects', async () => {
    const deleteMessage = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('delete failed'));
    const { controller } = createController({ deleteMessage });

    await expect(controller.recover()).resolves.toEqual({ status: 'delete-failed' });
  });
});
