// banking_api_ui/src/components/shared/LoadingOverlay.js
import React from 'react';
import BusySpinner from './BusySpinner';
import './LoadingOverlay.css';

/**
 * @deprecated Use the global spinner service instead:
 *   import { spinner } from '../../services/spinnerService';
 *   spinner.show('Your message…'); // then spinner.hide() when done
 *
 * SpinnerHost (mounted once in App.js) renders the overlay automatically
 * for all apiClient and fetch calls. Manual calls go through spinnerService.
 *
 * Full-screen blocking overlay with a spinner and message.
 *
 * @param {object}  props
 * @param {boolean} props.show      - Whether the overlay is visible.
 * @param {string}  [props.message] - Primary message line.
 * @param {string}  [props.sub]     - Optional secondary line.
 */
export default function LoadingOverlay({ show, message = 'Please wait…', sub }) {
  if (!show) return null;
  return (
    <div className="lo-backdrop" role="status" aria-live="polite" aria-label={message}>
      <div className="lo-card lo-card--dark">
        <BusySpinner size={72} accent="var(--brand-navy)" aria-hidden="true" />
        <p className="lo-message">{message}</p>
        {sub && <p className="lo-sub">{sub}</p>}
      </div>
    </div>
  );
}
