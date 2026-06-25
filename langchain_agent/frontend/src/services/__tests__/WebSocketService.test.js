// Import the class directly for testing
import { WebSocketService } from '../WebSocketService';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data) {
    if (this.readyState === WebSocket.OPEN) {
      // Simulate message sent
      return true;
    }
    throw new Error('WebSocket is not open');
  }

  close(code, reason) {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason, wasClean: true });
    }
  }
}

// Mock WebSocket constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket;
global.WebSocket.CONNECTING = 0;
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSING = 2;
global.WebSocket.CLOSED = 3;

describe('WebSocketService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService();
  });

  afterEach(() => {
    if (service) {
      service.disconnect();
    }
  });

  test('should create WebSocket service instance', () => {
    expect(service).toBeDefined();
    expect(service.isConnected()).toBe(false);
  });

  test('should connect to WebSocket', async () => {
    const connectPromise = service.connect();
    
    expect(service.getConnectionState()).toBe('connecting');
    
    await connectPromise;
    
    expect(service.isConnected()).toBe(true);
    expect(service.getConnectionState()).toBe('connected');
  });

  test('should send message when connected', async () => {
    await service.connect();
    
    const result = service.send({ type: 'test', data: 'hello' });
    
    expect(result).toBe(true);
  });

  test('should not send message when disconnected', () => {
    const result = service.send({ type: 'test', data: 'hello' });
    
    expect(result).toBe(false);
  });

  test('should send chat message', async () => {
    await service.connect();
    
    const result = service.sendMessage('Hello, world!', 'session123');
    
    expect(result).toBe(true);
  });

  test('should handle event listeners', () => {
    const mockCallback = jest.fn();
    
    service.on('test-event', mockCallback);
    service.emit('test-event', { data: 'test' });
    
    expect(mockCallback).toHaveBeenCalledWith({ data: 'test' });
  });

  test('should remove event listeners', () => {
    const mockCallback = jest.fn();
    
    service.on('test-event', mockCallback);
    service.off('test-event', mockCallback);
    service.emit('test-event', { data: 'test' });
    
    expect(mockCallback).not.toHaveBeenCalled();
  });

  test('should disconnect WebSocket', async () => {
    await service.connect();
    expect(service.isConnected()).toBe(true);
    
    service.disconnect();
    
    expect(service.isConnected()).toBe(false);
  });

  test('should return correct connection states', () => {
    expect(service.getConnectionState()).toBe('disconnected');
    
    // Test with mock WebSocket in different states
    service.ws = { 
      readyState: WebSocket.CONNECTING,
      close: jest.fn()
    };
    expect(service.getConnectionState()).toBe('connecting');
    
    service.ws = { 
      readyState: WebSocket.OPEN,
      close: jest.fn()
    };
    expect(service.getConnectionState()).toBe('connected');
    
    service.ws = { 
      readyState: WebSocket.CLOSING,
      close: jest.fn()
    };
    expect(service.getConnectionState()).toBe('closing');
    
    service.ws = { 
      readyState: WebSocket.CLOSED,
      close: jest.fn()
    };
    expect(service.getConnectionState()).toBe('disconnected');
  });
});