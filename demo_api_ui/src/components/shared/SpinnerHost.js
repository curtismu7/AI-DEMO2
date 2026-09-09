// banking_api_ui/src/components/shared/SpinnerHost.js
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useSpinner } from '../../context/SpinnerContext';
import { useAppFlags } from '../../hooks/useAppFlags';
import { spinnerActivity } from '../../services/spinnerActivityService';
import BusySpinner from './BusySpinner';
import NeuralSpinner from './NeuralSpinner';
import './LoadingOverlay.css';

/**
 * Every knob below now comes from configStore via useAppFlags (/configure →
 * Appearance), not a constant here. The catalog defaults reproduce exactly what
 * these constants used to hardcode, so an untouched demo looks the same:
 *   spinner_variant       'neural' → NeuralSpinner token-ingress dial
 *                         'busy'   → BusySpinner telemetry radar
 *                         'classic'→ original <span className="lo-spinner"> ring
 *   spinner_size          88
 *   spinner_accent        '' → --brand-navy
 *   spinner_dark_card     true
 *   spinner_activity_feed true
 */

/**
 * Global spinner overlay — rendered once in App.js via createPortal.
 * Reads state from SpinnerContext (which subscribes to spinnerService).
 * Shows a full-screen overlay with a colored ring, contextual message,
 * the live API endpoint in a blue monospace chip, and (for admin users)
 * a scrolling activity feed of server events below.
 */
export default function SpinnerHost() {
  const { visible, message, color, endpoint } = useSpinner();
  const { appFlags } = useAppFlags();
  const {
    spinnerVariant: variant,
    spinnerSize,
    spinnerAccent,
    spinnerDarkCard,
    spinnerActivityFeed,
  } = appFlags;
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

  // Publish the configured accent to :root so EVERY spinner picks it up — the
  // inline ones in the inspectors as well as this overlay. It has to land on a
  // variable NeuralSpinner's own `.ns { --ns-accent: ... }` reads through
  // (--spinner-accent), because a value merely inherited from an ancestor
  // loses to that declaration on the element itself.
  useEffect(() => {
    const root = document.documentElement;
    if (spinnerAccent) root.style.setProperty('--spinner-accent', spinnerAccent);
    else root.style.removeProperty('--spinner-accent');
  }, [spinnerAccent]);

  // Auto-scroll feed to bottom when new events arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activityEvents]);

  if (!visible) return null;

  const accentColor = spinnerAccent || color || 'var(--brand-navy)';

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
        className={variant === 'classic' || !spinnerDarkCard ? 'lo-card' : 'lo-card lo-card--dark'}
        style={{ borderTopColor: accentColor }}
      >
        {variant === 'classic' && (
          <span
            className="lo-spinner"
            style={{ borderTopColor: accentColor }}
            aria-hidden="true"
          />
        )}
        {variant === 'busy' && (
          <BusySpinner size={spinnerSize} accent={accentColor} aria-hidden="true" />
        )}
        {variant === 'neural' && (
          <NeuralSpinner size={spinnerSize} />
        )}
        <p className="lo-message">{message || 'Please wait…'}</p>
        {activityLabel && (
          <code className="lo-endpoint">{activityLabel}</code>
        )}
        {spinnerActivityFeed && activityEvents.length > 0 && (
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
