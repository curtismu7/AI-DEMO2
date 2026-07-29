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

        eventSource.onerror = () => {
          setIsConnected(false);
          setError(new Error('SSE connection lost'));
          eventSource.close();
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
