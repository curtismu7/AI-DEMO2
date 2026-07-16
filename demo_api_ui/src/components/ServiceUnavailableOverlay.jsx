import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ServiceUnavailableOverlay.css';

/**
 * Full-screen overlay shown when the BFF returns 502/503 or is unreachable.
 * Listens for the 'bff-unavailable' custom event dispatched by apiClient.js.
 * Auto-retries a health check every 10s and dismisses itself when the server responds.
 */
export default function ServiceUnavailableOverlay() {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const retryTimerRef = useRef(null);
  const countdownRef = useRef(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/healthz', { method: 'GET', credentials: 'same-origin' });
      if (res.ok) {
        setVisible(false);
        setCountdown(30);
        return true;
      }
    } catch (_) { /* still down */ }
    return false;
  }, []);

  const startAutoRetry = useCallback(() => {
    // Clear any existing timers
    if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    setCountdown(30);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 30; // reset after reaching 0
        return prev - 1;
      });
    }, 1000);

    retryTimerRef.current = setInterval(async () => {
      const ok = await checkHealth();
      if (ok) {
        clearInterval(retryTimerRef.current);
        clearInterval(countdownRef.current);
        retryTimerRef.current = null;
        countdownRef.current = null;
      }
    }, 10000);
  }, [checkHealth]);

  useEffect(() => {
    const handler = () => {
      if (!visible) {
        setVisible(true);
        startAutoRetry();
      }
    };

    window.addEventListener('bff-unavailable', handler);
    return () => {
      window.removeEventListener('bff-unavailable', handler);
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [visible, startAutoRetry]);

  const handleRetryNow = async () => {
    const ok = await checkHealth();
    if (!ok) {
      setCountdown(30); // reset countdown on manual retry
    }
  };

  if (!visible) return null;

  return (
    <div className="svc-unavail-overlay">
      <div className="svc-unavail-card">
        <div className="svc-unavail-icon">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74"/>
            <path d="M21 3v6h-6"/>
          </svg>
        </div>
        <h2 className="svc-unavail-title">Services Are Restarting</h2>
        <p className="svc-unavail-subtitle">
          The backend servers are temporarily unavailable. They may be restarting
          after a deployment. This usually resolves within a minute.
        </p>
        <div className="svc-unavail-status">
          <span className="svc-unavail-dot" />
          <span>Waiting for services to come back online...</span>
        </div>
        <button className="svc-unavail-btn" onClick={handleRetryNow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74"/>
            <path d="M21 3v6h-6"/>
          </svg>
          Retry Now
        </button>
        <p className="svc-unavail-auto-retry">
          Auto-checking in <span>{countdown}</span>s
        </p>
      </div>
    </div>
  );
}
