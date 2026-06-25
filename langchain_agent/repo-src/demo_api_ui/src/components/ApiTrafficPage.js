// banking_api_ui/src/components/ApiTrafficPage.js
/**
 * Standalone full-page API Traffic Viewer.
 * Opened via window.open('/api-traffic') so it runs in its own browser window.
 * Reads live data from localStorage (written by the main-window apiTrafficStore).
 */
import React, { useState, useEffect } from 'react';
import ApiTrafficPanel from './ApiTrafficPanel';
import { seedFromLocalStorage } from '../services/apiTrafficStore';
import './ApiTrafficPanel.css';

export default function ApiTrafficPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Seed in-memory store from localStorage on first load
    seedFromLocalStorage();
    setReady(true);

    // When the main window writes new entries, re-seed so this page updates
    const handleStorage = (e) => {
      if (e.key === 'api-traffic-store') seedFromLocalStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (!ready) return null;

  return (
    <div className="api-traffic-page-host">
      <ApiTrafficPanel />
    </div>
  );
}
