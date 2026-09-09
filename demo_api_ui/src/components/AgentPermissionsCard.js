import React, { useEffect, useState } from 'react';
import { notifySuccess } from '../utils/appToast';

const DEFAULTS = {
  agentEnabled: true,
  minAmount: 0,
  maxAmount: 500,
  restrictToPayees: true,
  avoidNewCategories: false,
  useSavedPaymentMethod: true,
  updateEmail: false,
  updatePassword: false,
  updateContactInfo: false,
  requireApproval: true,
  approvalOverAmount: true,
  approvalNewPayee: true,
  approvalEveryTransaction: false,
  operatingMode: 'copilot',
};

function storageKey(user) {
  return `agentPermissions:${user?.oauthId || user?.id || user?.email || 'anon'}`;
}

function loadPermissions(user) {
  try {
    const raw = localStorage.getItem(storageKey(user));
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

const OPERATING_MODES = [
  ['copilot', 'Co-pilot — I confirm before the agent acts'],
  ['autopilot', 'Auto-pilot — agent acts autonomously'],
  ['readonly', 'Read-only — agent can look, never act'],
];

const ACCOUNT_TOGGLES = [
  ['updateEmail', 'Update email address'],
  ['updatePassword', 'Update password'],
  ['updateContactInfo', 'Update contact info'],
];

export default function AgentPermissionsCard({ user }) {
  const [permissions, setPermissions] = useState(() => loadPermissions(user));
  const userKey = user?.oauthId || user?.id || user?.email;

  useEffect(() => {
    setPermissions(loadPermissions(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  const set = (patch) => setPermissions((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    try {
      localStorage.setItem(storageKey(user), JSON.stringify(permissions));
    } catch {
      // localStorage unavailable — settings just won't survive a reload
    }
    notifySuccess('Agent permissions saved');
  };

  return (
    <div className="up-card">
      <div className="up-card__header">
        <span className="up-card__title">AI Agent Permissions</span>
      </div>
      <p className="up-card__desc">
        Set what your AI agent can and cannot do on your behalf.
      </p>

      <div className="up-permissions-section">
        <div className="up-field up-field--toggle">
          <div className="up-field__content">
            <span className="up-field__label">Allow agent-initiated transactions</span>
            <span className="up-field__desc">Let the agent move money on your behalf, within the limits below</span>
          </div>
          <button
            type="button"
            className={`up-toggle ${permissions.agentEnabled ? 'up-toggle--on' : 'up-toggle--off'}`}
            onClick={() => set({ agentEnabled: !permissions.agentEnabled })}
            aria-pressed={permissions.agentEnabled}
          >
            <span className="up-toggle__knob" />
          </button>
        </div>

        {permissions.agentEnabled && (
          <div className="up-permissions-detail">
            <div className="up-permissions-range">
              <label>
                Min $
                <input
                  type="number"
                  min="0"
                  value={permissions.minAmount}
                  onChange={(e) => set({ minAmount: Number(e.target.value) })}
                />
              </label>
              <span className="up-permissions-range__sep">–</span>
              <label>
                Max $
                <input
                  type="number"
                  min="0"
                  value={permissions.maxAmount}
                  onChange={(e) => set({ maxAmount: Number(e.target.value) })}
                />
              </label>
              <span className="up-permissions-range__hint">per transaction</span>
            </div>

            <label className="up-checkbox-row">
              <input
                type="checkbox"
                checked={permissions.restrictToPayees}
                onChange={(e) => set({ restrictToPayees: e.target.checked })}
              />
              Restrict to existing payees
            </label>
            <label className="up-checkbox-row">
              <input
                type="checkbox"
                checked={permissions.avoidNewCategories}
                onChange={(e) => set({ avoidNewCategories: e.target.checked })}
              />
              Avoid new merchant categories
            </label>
          </div>
        )}

        <div className="up-field up-field--toggle">
          <div className="up-field__content">
            <span className="up-field__label">Use saved payment method</span>
          </div>
          <button
            type="button"
            className={`up-toggle ${permissions.useSavedPaymentMethod ? 'up-toggle--on' : 'up-toggle--off'}`}
            onClick={() => set({ useSavedPaymentMethod: !permissions.useSavedPaymentMethod })}
            aria-pressed={permissions.useSavedPaymentMethod}
          >
            <span className="up-toggle__knob" />
          </button>
        </div>
      </div>

      <div className="up-permissions-section">
        <span className="up-permissions-section__title">Account Settings</span>
        {ACCOUNT_TOGGLES.map(([key, label]) => (
          <div className="up-field up-field--toggle" key={key}>
            <div className="up-field__content">
              <span className="up-field__label">{label}</span>
            </div>
            <button
              type="button"
              className={`up-toggle ${permissions[key] ? 'up-toggle--on' : 'up-toggle--off'}`}
              onClick={() => set({ [key]: !permissions[key] })}
              aria-pressed={permissions[key]}
            >
              <span className="up-toggle__knob" />
            </button>
          </div>
        ))}
      </div>

      <div className="up-permissions-section">
        <div className="up-field up-field--toggle">
          <div className="up-field__content">
            <span className="up-field__label">Require my approval before acting</span>
          </div>
          <button
            type="button"
            className={`up-toggle ${permissions.requireApproval ? 'up-toggle--on' : 'up-toggle--off'}`}
            onClick={() => set({ requireApproval: !permissions.requireApproval })}
            aria-pressed={permissions.requireApproval}
          >
            <span className="up-toggle__knob" />
          </button>
        </div>

        {permissions.requireApproval && (
          <div className="up-permissions-detail">
            <label className="up-checkbox-row">
              <input
                type="checkbox"
                checked={permissions.approvalOverAmount}
                onChange={(e) => set({ approvalOverAmount: e.target.checked })}
              />
              All transactions over ${permissions.maxAmount}
            </label>
            <label className="up-checkbox-row">
              <input
                type="checkbox"
                checked={permissions.approvalNewPayee}
                onChange={(e) => set({ approvalNewPayee: e.target.checked })}
              />
              New payees
            </label>
            <label className="up-checkbox-row">
              <input
                type="checkbox"
                checked={permissions.approvalEveryTransaction}
                onChange={(e) => set({ approvalEveryTransaction: e.target.checked })}
              />
              Every transaction (always ask)
            </label>
          </div>
        )}
      </div>

      <div className="up-permissions-section up-permissions-section--last">
        <span className="up-permissions-section__title">Operating Mode</span>
        <div className="up-radio-group">
          {OPERATING_MODES.map(([value, label]) => (
            <label className="up-radio-option" key={value}>
              <input
                type="radio"
                name="operatingMode"
                value={value}
                checked={permissions.operatingMode === value}
                onChange={() => set({ operatingMode: value })}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="up-form__actions">
        <button type="button" className="up-btn up-btn--edit" onClick={handleSave}>
          Save Agent Permissions
        </button>
      </div>
    </div>
  );
}
