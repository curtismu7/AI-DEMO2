import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { ErrorMessage } from './MessageContent';
import { createMcpRecoveryController } from './McpRecoveryController';

jest.mock('./McpRecoveryController', () => {
  const actual = jest.requireActual('./McpRecoveryController');
  return {
    ...actual,
    createMcpRecoveryController: jest.fn(actual.createMcpRecoveryController),
  };
});

const mockInitializeFirst = jest.fn();
const mockInitializeSecond = jest.fn();
const mockGetMessages = jest.fn();
const mockSetMessages = jest.fn();
let mockResolveInitialization: ((result: { success: boolean }) => void) | undefined;
let mockCurrentMcpManager = {
  initializeServer: mockInitializeFirst,
  mcpValues: ['first-server'],
};

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { enableUserMsgMarkdown: {}, collapseLongUserMessages: {} },
}));

jest.mock('~/hooks/Messages/useSmoothStreaming', () => () => false);

jest.mock('~/Providers', () => ({
  useMessageContext: () => ({}),
  useMessagesOperations: () => ({ getMessages: mockGetMessages, setMessages: mockSetMessages }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useMCPServerManager: () => mockCurrentMcpManager,
}));

jest.mock('./Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('~/components/Messages/Content/Error', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));

jest.mock('./MarkdownLite', () => ({ __esModule: true, default: () => null }));
jest.mock('./Markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('./EditMessage', () => ({ __esModule: true, default: () => null }));
jest.mock('./Parts/Thinking', () => ({ __esModule: true, default: () => null }));
jest.mock('./Parts/EmptyText', () => ({ __esModule: true, default: () => null }));
jest.mock('./ToolCallLimitNotice', () => ({ __esModule: true, default: () => null }));

const firstMessage = {
  messageId: 'message-first',
  conversationId: 'conversation-first',
  isCreatedByUser: false,
} as TMessage;

const secondMessage = {
  messageId: 'message-second',
  conversationId: 'conversation-second',
  isCreatedByUser: false,
} as TMessage;

describe('MCP recovery ErrorMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentMcpManager = {
      initializeServer: mockInitializeFirst,
      mcpValues: ['first-server'],
    };
    mockInitializeFirst.mockImplementation(
      () => new Promise((resolve) => {
        mockResolveInitialization = resolve;
      }),
    );
    mockInitializeSecond.mockResolvedValue({ success: true });
    mockGetMessages.mockReturnValue([firstMessage, secondMessage]);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  test('keeps a recovery bound to the original message across a rerender', async () => {
    const { rerender } = render(
      <ErrorMessage text="AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE" message={firstMessage} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear error & reconnect' }));
    await waitFor(() => expect(mockInitializeFirst).toHaveBeenCalledWith('first-server', true));

    mockCurrentMcpManager = {
      initializeServer: mockInitializeSecond,
      mcpValues: ['second-server'],
    };
    rerender(<ErrorMessage text="AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE" message={secondMessage} />);

    expect(screen.getByRole('button', { name: 'Reconnecting…' })).toBeDisabled();
    // Exercise the real controller used by the mounted UI directly: a disabled
    // button (and the handler's state guard) would otherwise mask a lost lock.
    const controllerFactory = jest.mocked(createMcpRecoveryController);
    expect(controllerFactory).toHaveBeenCalledTimes(1);
    const controller = controllerFactory.mock.results[0].value;
    const secondDelete = jest.fn().mockResolvedValue(undefined);
    await expect(controller.recover(secondDelete)).resolves.toEqual({ status: 'in-flight' });
    expect(secondDelete).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockInitializeFirst).toHaveBeenCalledTimes(1);
    expect(mockInitializeSecond).not.toHaveBeenCalled();
    mockResolveInitialization?.({ success: true });

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/messages/conversation-first/message-first',
        { method: 'DELETE', credentials: 'include' },
      ),
    );
    expect(mockInitializeSecond).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(secondDelete).not.toHaveBeenCalled();
    expect(mockSetMessages).toHaveBeenCalledWith([secondMessage]);
  });
});
