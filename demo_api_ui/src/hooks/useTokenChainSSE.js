import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

export function useTokenChainSSE(maxHistory = 50) {
  const [exchanges, setExchanges] = useState([]);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    const connectSSE = () => {
      try {
        const eventSource = new EventSource('/api/token-chain/events');
        eventSourceRef.current = eventSource;
        setIsConnected(true);
        setError(null);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            const exchange = {
              id: uuidv4(),
              exchangeType: data.exchangeType || 'unknown',
              timestamp: data.timestamp,
              subjectToken: data.subjectToken,
              resultToken: data.resultToken,
              metadata: data.metadata || {}
            };

            setExchanges((prev) => {
              const updated = [exchange, ...prev];
              return updated.slice(0, maxHistory);
            });
          } catch (parseError) {
            console.error('Failed to parse SSE event:', parseError);
            setError(parseError);
          }
        };

        // EventSource fires `error` on transient blips (readyState CONNECTING —
        // the browser is already reconnecting) as well as on a terminal close.
        // Only close on the terminal case; closing on every error kills the
        // built-in reconnect and leaves the feed dead for the rest of the
        // component's lifetime.
        eventSource.onerror = () => {
          setIsConnected(false);
          setError(new Error('SSE connection lost'));
          if (eventSource.readyState === 2 /* EventSource.CLOSED */) {
            eventSource.close();
          }
        };

        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        return () => eventSource.close();
      } catch (err) {
        setIsConnected(false);
        setError(err);
      }
    };

    const cleanup = connectSSE();
    return cleanup;
  }, [maxHistory]);

  return { exchanges, error, isConnected };
}
