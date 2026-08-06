import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import './OfflineBanner.css';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      No internet connection — requests will fail until connectivity is restored.
    </div>
  );
}
