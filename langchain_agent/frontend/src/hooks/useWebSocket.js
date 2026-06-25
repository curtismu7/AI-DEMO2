import { useState, useEffect, useCallback, useRef } from 'react';
import webSocketService from '../services/WebSocketService';

export const useWebSocket = (apiUrl = null) => {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);
  const sessionIdRef = useRef(null);

  // Generate session ID if not exists
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  }, []);

  const handleConnected = useCallback(() => {
    setConnectionState('connected');
    setError(null);
  }, []);

  const handleDisconnected = useCallback((event) => {
    setConnectionState('disconnected');
    if (event && event.code !== 1000) { // Not a normal closure
      setError(`Connection lost: ${event.reason || 'Unknown reason'}`);
    }
  }, []);

  const handleMessage = useCallback((data) => {
    // Handle session initialization response
    if (data.type === 'session_initialized') {
      sessionIdRef.current = data.session_id;
      console.log('Session initialized:', data.session_id);
    }
    
    setLastMessage(data);
    setError(null);
  }, []);

  const handleError = useCallback((error) => {
    setError(error.message || 'WebSocket error occurred');
    setConnectionState('disconnected');
  }, []);

  useEffect(() => {
    // Set up event listeners
    webSocketService.on('connected', handleConnected);
    webSocketService.on('disconnected', handleDisconnected);
    webSocketService.on('message', handleMessage);
    webSocketService.on('error', handleError);

    // Attempt to connect
    const connectToWebSocket = async () => {
      try {
        setConnectionState('connecting');
        await webSocketService.connect(apiUrl);
      } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
        setError('Failed to connect to server');
        setConnectionState('disconnected');
      }
    };

    connectToWebSocket();

    // Cleanup function
    return () => {
      webSocketService.off('connected', handleConnected);
      webSocketService.off('disconnected', handleDisconnected);
      webSocketService.off('message', handleMessage);
      webSocketService.off('error', handleError);
    };
  }, [handleConnected, handleDisconnected, handleMessage, handleError, apiUrl]);

  const sendMessage = useCallback((message) => {
    if (!sessionIdRef.current) {
      console.error('No session ID available');
      return false;
    }

    return webSocketService.sendMessage(message, sessionIdRef.current);
  }, []);

  const reconnect = useCallback(async () => {
    try {
      setConnectionState('connecting');
      setError(null);
      await webSocketService.connect(apiUrl);
    } catch (error) {
      console.error('Failed to reconnect:', error);
      setError('Failed to reconnect to server');
      setConnectionState('disconnected');
    }
  }, [apiUrl]);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
    setConnectionState('disconnected');
  }, []);

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    lastMessage,
    error,
    sendMessage,
    reconnect,
    disconnect,
    sessionId: sessionIdRef.current
  };
};