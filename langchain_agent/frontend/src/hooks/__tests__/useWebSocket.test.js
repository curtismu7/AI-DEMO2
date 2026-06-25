/* eslint-disable import/first */
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../useWebSocket';

// Mock the WebSocketService
jest.mock('../../services/WebSocketService', () => {
  const mockService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendMessage: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    isConnected: jest.fn(),
    getConnectionState: jest.fn()
  };
  return mockService;
});

import webSocketService from '../../services/WebSocketService';

describe('useWebSocket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webSocketService.connect.mockResolvedValue();
    webSocketService.sendMessage.mockReturnValue(true);
    webSocketService.isConnected.mockReturnValue(false);
    webSocketService.getConnectionState.mockReturnValue('disconnected');
  });

  test('should initialize with default state', () => {
    const { result } = renderHook(() => useWebSocket());

    // The hook starts connecting immediately, so it might be in connecting state
    expect(['disconnected', 'connecting']).toContain(result.current.connectionState);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.lastMessage).toBe(null);
    expect(result.current.sessionId).toBeDefined();
  });

  test('should attempt to connect on mount', () => {
    renderHook(() => useWebSocket());

    expect(webSocketService.connect).toHaveBeenCalled();
    expect(webSocketService.on).toHaveBeenCalledWith('connected', expect.any(Function));
    expect(webSocketService.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    expect(webSocketService.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(webSocketService.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('should send message', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      const success = result.current.sendMessage('Hello, world!');
      expect(success).toBe(true);
    });

    expect(webSocketService.sendMessage).toHaveBeenCalledWith('Hello, world!', expect.any(String));
  });

  test('should handle reconnect', async () => {
    const { result } = renderHook(() => useWebSocket());

    await act(async () => {
      await result.current.reconnect();
    });

    expect(webSocketService.connect).toHaveBeenCalledTimes(2); // Once on mount, once on reconnect
  });

  test('should handle disconnect', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.disconnect();
    });

    expect(webSocketService.disconnect).toHaveBeenCalled();
    expect(result.current.connectionState).toBe('disconnected');
  });

  test('should clean up event listeners on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket());

    unmount();

    expect(webSocketService.off).toHaveBeenCalledWith('connected', expect.any(Function));
    expect(webSocketService.off).toHaveBeenCalledWith('disconnected', expect.any(Function));
    expect(webSocketService.off).toHaveBeenCalledWith('message', expect.any(Function));
    expect(webSocketService.off).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('should generate unique session ID', () => {
    const { result: result1 } = renderHook(() => useWebSocket());
    const { result: result2 } = renderHook(() => useWebSocket());

    expect(result1.current.sessionId).toBeDefined();
    expect(result2.current.sessionId).toBeDefined();
    expect(result1.current.sessionId).not.toBe(result2.current.sessionId);
  });
});