import React, { useState } from 'react';
import { MdArrowBack } from 'react-icons/md';
import bffAxios from '../services/bffAxios';
import { notifyError } from '../utils/appToast';
import './NotificationsPanel.css';

// The categories this demo can actually notify on. Keys are persisted verbatim
// on the user record, so renaming one orphans a saved preference.
export const NOTIFICATION_CATEGORIES = [
  {
    key: 'agentActivity',
    label: 'AI agent activity',
    detail: 'When an agent acts on your accounts on your behalf.',
  },
  {
    key: 'transfers',
    label: 'Transfers and payments',
    detail: 'Money moving in or out of your accounts.',
  },
  {
    key: 'securityAlerts',
    label: 'Security alerts',
    detail: 'Sign-ins, MFA device changes, delegated access grants.',
  },
  {
    key: 'lowBalance',
    label: 'Low balance',
    detail: 'When a deposit account drops below your threshold.',
  },
];

export const DEFAULT_NOTIFICATION_PREFS = NOTIFICATION_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.key]: true }),
  {},
);

export default function NotificationsPanel({ prefs, onBack }) {
  const [values, setValues] = useState({ ...DEFAULT_NOTIFICATION_PREFS, ...(prefs || {}) });
  // Every save posts the whole preference object and the route replaces it, so two
  // in-flight saves can land out of order and drop a toggle. One at a time.
  const [saving, setSaving] = useState(false);

  const toggle = async (key) => {
    if (saving) return;
    const previous = values;
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setSaving(true);
    try {
      await bffAxios.post('/api/auth/oauth/user/notification-preferences', {
        notificationPrefs: next,
      });
    } catch (err) {
      setValues(previous);
      notifyError(err.response?.data?.error || 'Failed to update notification preference');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notifications-panel">
      <div className="notifications-panel-header">
        <button
          className="notifications-panel-back"
          type="button"
          onClick={onBack}
          aria-label="Back to user menu"
        >
          <MdArrowBack />
        </button>
        <span className="notifications-panel-title">Preferences</span>
      </div>

      <p className="notifications-panel-intro">Choose what this bank may notify you about.</p>

      <ul className="notifications-panel-list">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <li key={category.key}>
            <label className="notifications-panel-item">
              <span className="notifications-panel-item-text">
                <span className="notifications-panel-item-title">{category.label}</span>
                <span className="notifications-panel-item-detail">{category.detail}</span>
              </span>
              <input
                type="checkbox"
                className="notifications-panel-switch"
                checked={Boolean(values[category.key])}
                disabled={saving}
                onChange={() => toggle(category.key)}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
