// banking_api_ui/src/components/shared/SpinnerHost.js
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useSpinner } from '../../context/SpinnerContext';
import { spinnerActivity } from '../../services/spinnerActivityService';
import BusySpinner from './BusySpinner';
import './LoadingOverlay.css';

/**
 * Spinner variant switch — flip to 'classic' to restore the original CSS ring.
 *   'busy'    → BusySpinner telemetry dial (default)
 *   'classic' → original <span className="lo-spinner"> border ring
 */
const SPINNER_VARIANT = 'busy';

/**
 * Global spinner overlay — rendered once in App.js via createPortal.
 * Reads state from SpinnerContext (which subscribes to spinnerService).
 * Shows a full-screen overlay with a colored ring, contextual message,
 * the live API endpoint in a blue monospace chip, and (for admin users)
 * a scrolling activity feed of server events below.
 */
export default function SpinnerHost() {
  const { visible, message, color, endpoint } = useSpinner();
  const [activityEvents, setActivityEvents] = useState([]);
  const feedRef = useRef(null);

  // Start/stop activity polling when spinner visibility changes
  useEffect(() => {
    if (visible) {
      // Subscribe FIRST so we don't miss the notify() inside start()
      const unsub = spinnerActivity.subscribe(setActivityEvents);
      spinnerActivity.start();
      // Seed with any events buffered before subscription (from addClientEvent)
      const buffered = spinnerActivity.getEvents();
      if (buffered.length > 0) setActivityEvents(buffered);
      return () => {
        unsub();
        spinnerActivity.stop();
      };
    } else {
      spinnerActivity.stop();
      setActivityEvents([]);
    }
  }, [visible]);

  // Auto-scroll feed to bottom when new events arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activityEvents]);

  if (!visible) return null;

  const accentColor = color || 'var(--brand-navy)';

  // Strip origin from endpoint for compact display: "GET https://host:4000/api/foo" → "GET /api/foo"
  const shortEndpoint = endpoint ? endpoint.replace(/^(\w+\s+)https?:\/\/[^/]+/, '$1') : null;
  const latestServerEvent = [...activityEvents].reverse().find((event) => event.source === 'server');
  const activityLabel = latestServerEvent
    ? `${latestServerEvent.icon} ${latestServerEvent.message}`
    : shortEndpoint;

  return ReactDOM.createPortal(
    <div
      className="lo-backdrop"
      role="status"
      aria-live="polite"
      aria-label={message || 'Loading…'}
    >
      <div
        className={SPINNER_VARIANT === 'classic' ? 'lo-card' : 'lo-card lo-card--dark'}
        style={{ borderTopColor: accentColor }}
      >
        {SPINNER_VARIANT === 'classic' ? (
          <span
            className="lo-spinner"
            style={{ borderTopColor: accentColor }}
            aria-hidden="true"
          />
        ) : (
          <BusySpinner size={72} accent={accentColor} aria-hidden="true" />
        )}
        <p className="lo-message">{message || 'Please wait…'}</p>
        {activityLabel && (
          <code className="lo-endpoint">{activityLabel}</code>
        )}
        {activityEvents.length > 0 && (
          <div className="lo-activity-feed" ref={feedRef}>
            {activityEvents.map((evt) => (
              <div key={evt.id} className="lo-activity-line">
                <span className="lo-activity-icon">{evt.icon}</span>
                <span className="lo-activity-time">{evt.timeDelta}</span>
                <span className="lo-activity-msg">{evt.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
