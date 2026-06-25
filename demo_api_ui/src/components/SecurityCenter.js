import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import './SecurityCenter.css';

function deviceTypeLabel(type) {
  const map = {
    EMAIL: 'Email OTP',
    SMS: 'SMS OTP',
    MOBILE_PHONE: 'SMS OTP',
    TOTP: 'Authenticator App',
    FIDO2: 'Security Key / Passkey',
    MOBILE: 'PingOne Mobile',
  };
  return map[type] || type;
}

export default function SecurityCenter() {
  const [activeTab, setActiveTab] = useState('overview');

  // MFA device list
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Delete
  const [deletingId, setDeletingId] = useState(null);

  // Rename
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  // Enrollment
  const [enrolling, setEnrolling] = useState(false);
  const [enrollType, setEnrollType] = useState(null);
  const [enrollPhone, setEnrollPhone] = useState('');
  const [enrollSmsStep, setEnrollSmsStep] = useState('phone');
  const [enrollSmsDeviceId, setEnrollSmsDeviceId] = useState(null);
  const [enrollOtp, setEnrollOtp] = useState('');
  const [enrollError, setEnrollError] = useState(null);
  const [enrollBusy, setEnrollBusy] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/auth/mfa/devices', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (err) {
      setFetchError(err.message || 'Failed to load devices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'mfa') return;
    fetchDevices();
  }, [activeTab, fetchDevices]);

  async function handleDelete(deviceId) {
    setDeletingId(deviceId);
    try {
      const res = await fetch(`/api/auth/mfa/devices/${deviceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      toast.success('Device removed.');
    } catch (err) {
      toast.error(err.message || 'Failed to remove device.');
    } finally {
      setDeletingId(null);
    }
  }

  function startRename(device) {
    setRenamingId(device.id);
    setRenameValue(device.name || '');
  }

  async function handleRename(deviceId) {
    if (!renameValue.trim()) return;
    setRenameBusy(true);
    try {
      const res = await fetch(`/api/auth/mfa/devices/${deviceId}/nickname`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: renameValue.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      const updated = await res.json();
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, name: updated.nickname } : d));
      setRenamingId(null);
      toast.success('Device renamed.');
    } catch (err) {
      toast.error(err.message || 'Failed to rename device.');
    } finally {
      setRenameBusy(false);
    }
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue('');
  }

  function openEnrollPicker() {
    setEnrolling(true);
    setEnrollType(null);
    setEnrollPhone('');
    setEnrollSmsStep('phone');
    setEnrollSmsDeviceId(null);
    setEnrollOtp('');
    setEnrollError(null);
  }

  function closeEnrollPicker() {
    setEnrolling(false);
    setEnrollType(null);
    setEnrollPhone('');
    setEnrollSmsStep('phone');
    setEnrollSmsDeviceId(null);
    setEnrollOtp('');
    setEnrollError(null);
    setEnrollBusy(false);
  }

  async function handleEnrollEmail() {
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const res = await fetch('/api/auth/mfa/enroll/email', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      toast.success('Email OTP device enrolled.');
      closeEnrollPicker();
      fetchDevices();
    } catch (err) {
      setEnrollError(err.message || 'Failed to enroll email device.');
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleEnrollSmsInit() {
    if (!enrollPhone.trim()) return;
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const res = await fetch('/api/auth/mfa/enroll/sms-init', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: enrollPhone.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      const data = await res.json();
      setEnrollSmsDeviceId(data.deviceId);
      setEnrollSmsStep('otp');
    } catch (err) {
      setEnrollError(err.message || 'Failed to initiate SMS enrollment.');
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleEnrollSmsComplete() {
    if (!enrollOtp.trim()) return;
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const res = await fetch('/api/auth/mfa/enroll/sms-complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: enrollSmsDeviceId, otp: enrollOtp.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      toast.success('SMS OTP device enrolled.');
      closeEnrollPicker();
      fetchDevices();
    } catch (err) {
      setEnrollError(err.message || 'Failed to complete SMS enrollment.');
    } finally {
      setEnrollBusy(false);
    }
  }

  function renderEnrollPicker() {
    if (!enrollType) {
      return (
        <div className="enroll-picker">
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: '#333' }}>Select device type to add:</p>
          {[
            { key: 'email', label: 'Email OTP' },
            { key: 'sms', label: 'SMS OTP' },
            { key: 'totp', label: 'Authenticator App (TOTP)' },
            { key: 'fido2', label: 'Security Key (FIDO2)' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="enroll-option-btn"
              onClick={() => setEnrollType(key)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={closeEnrollPicker}>
            Cancel
          </button>
        </div>
      );
    }

    if (enrollType === 'email') {
      return (
        <div className="enroll-picker">
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Enroll Email OTP</p>
          <p style={{ margin: '0 0 0.75rem', color: '#666', fontSize: '0.875rem' }}>
            A verification code will be sent to your account email.
          </p>
          {enrollError && (
            <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>{enrollError}</p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleEnrollEmail}
              disabled={enrollBusy}
            >
              {enrollBusy ? 'Enrolling...' : 'Enroll'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={closeEnrollPicker}
              disabled={enrollBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (enrollType === 'sms') {
      return (
        <div className="enroll-picker">
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Enroll SMS OTP</p>
          {enrollError && (
            <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>{enrollError}</p>
          )}
          {enrollSmsStep === 'phone' ? (
            <>
              <input
                type="tel"
                className="rename-input"
                style={{ width: '100%', maxWidth: 240, boxSizing: 'border-box' }}
                placeholder="+1 555 000 0000"
                value={enrollPhone}
                onChange={e => setEnrollPhone(e.target.value)}
                disabled={enrollBusy}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleEnrollSmsInit}
                  disabled={enrollBusy || !enrollPhone.trim()}
                >
                  {enrollBusy ? 'Sending...' : 'Send code'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={closeEnrollPicker}
                  disabled={enrollBusy}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: '#666', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>
                Enter the code sent to {enrollPhone}.
              </p>
              <input
                type="text"
                className="rename-input"
                style={{ width: '100%', maxWidth: 180, boxSizing: 'border-box', letterSpacing: '0.15em' }}
                placeholder="000000"
                value={enrollOtp}
                onChange={e => setEnrollOtp(e.target.value)}
                disabled={enrollBusy}
                maxLength={8}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleEnrollSmsComplete}
                  disabled={enrollBusy || !enrollOtp.trim()}
                >
                  {enrollBusy ? 'Verifying...' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={closeEnrollPicker}
                  disabled={enrollBusy}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    // TOTP or FIDO2 — requires native browser APIs or mobile app
    return (
      <div className="enroll-picker">
        <p style={{ color: '#666', fontSize: '0.875rem', margin: '0 0 0.75rem' }}>
          Use the PingOne mobile app or admin portal to enroll this device type.
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={closeEnrollPicker}>
          Close
        </button>
      </div>
    );
  }

  function renderMfaTab() {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>MFA Devices</h3>
        {loading && <p className="demo-unavailable">Loading devices...</p>}
        {fetchError && <p style={{ color: '#dc2626' }}>{fetchError}</p>}
        {!loading && !fetchError && devices !== null && (
          <>
            {devices.length === 0 ? (
              <p className="demo-unavailable">No MFA devices registered.</p>
            ) : (
              <div>
                {devices.map(device => (
                  <div key={device.id} className="device-row">
                    <span className="device-type">{deviceTypeLabel(device.type)}</span>
                    <span className="device-contact">
                      {renamingId === device.id ? (
                        <input
                          type="text"
                          className="rename-input"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          disabled={renameBusy}
                        />
                      ) : (
                        device.name || device.maskedContact || '—'
                      )}
                    </span>
                    <div className="device-actions">
                      {renamingId === device.id ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleRename(device.id)}
                            disabled={renameBusy || !renameValue.trim()}
                          >
                            {renameBusy ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={cancelRename}
                            disabled={renameBusy}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-danger"
                            onClick={() => handleDelete(device.id)}
                            disabled={deletingId === device.id}
                          >
                            {deletingId === device.id ? 'Removing...' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => startRename(device)}
                            disabled={deletingId !== null}
                          >
                            Rename
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: '1rem' }}>
              {enrolling ? renderEnrollPicker() : (
                <button type="button" className="btn btn-primary btn-sm" onClick={openEnrollPicker}>
                  Add device
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  const renderContent = () => {
    if (activeTab === 'mfa') return renderMfaTab();
    return <p className="demo-unavailable">This feature is not available in this demo.</p>;
  };

  return (
    <div className="security-center">
      <div className="security-header">
        <h2>Security Center</h2>
        <p>Manage your account security settings</p>
      </div>

      <div className="security-tabs">
        <div className="tab-nav">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'password', label: 'Password' },
            { id: 'mfa', label: 'MFA' },
            { id: 'sessions', label: 'Sessions' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {renderContent()}
        </div>
      </div>

      <style jsx>{`
        .security-center {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
        }

        .security-header {
          margin-bottom: 2rem;
        }

        .security-header h2 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }

        .security-header p {
          margin: 0;
          color: #666;
        }

        .security-tabs {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .tab-nav {
          display: flex;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }

        .tab-btn:hover {
          background: #f3f4f6;
        }

        .tab-btn.active {
          background: white;
          border-bottom: 2px solid #4f46e5;
          color: #4f46e5;
          font-weight: 600;
        }

        .tab-content {
          padding: 2rem;
        }

        .device-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          margin-bottom: 0.5rem;
        }

        .device-type {
          font-weight: 600;
          flex: 0 0 160px;
          color: #333;
          font-size: 0.875rem;
        }

        .device-contact {
          flex: 1;
          color: #666;
          font-size: 0.875rem;
        }

        .device-actions {
          display: flex;
          gap: 0.5rem;
          margin-left: auto;
        }

        .rename-input {
          padding: 0.375rem 0.625rem;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 0.875rem;
        }

        .enroll-picker {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-width: 400px;
          margin-top: 1rem;
        }

        .enroll-option-btn {
          padding: 0.75rem 1rem;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: white;
          cursor: pointer;
          text-align: left;
          font-size: 0.9rem;
        }

        .enroll-option-btn:hover {
          border-color: var(--dash-accent, #1D4ED8);
        }

        .btn-danger {
          background: var(--dash-accent-red, #dc2626);
          color: white;
          border: none;
          padding: 0.375rem 0.75rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .btn-danger:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .demo-unavailable {
          color: #6b7280;
          font-style: italic;
          padding: 2rem 0;
          margin: 0;
        }

        .btn {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          display: inline-block;
          text-align: center;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #4f46e5;
          color: white;
        }

        .btn-primary:hover {
          background: #4338ca;
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .btn-outline {
          background: transparent;
          color: #4f46e5;
          border: 1px solid #4f46e5 !important;
        }

        .btn-outline:hover {
          background: #4f46e5;
          color: white;
        }

        .btn-outline:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .btn-sm {
          padding: 0.375rem 0.875rem;
          font-size: 0.875rem;
        }

        @media (max-width: 768px) {
          .security-center {
            padding: 1rem;
          }

          .tab-nav {
            flex-wrap: wrap;
          }

          .tab-btn {
            flex: 1 1 50%;
            min-width: 100px;
          }

          .device-row {
            flex-wrap: wrap;
          }

          .device-type {
            flex: 0 0 auto;
          }

          .device-actions {
            width: 100%;
            margin-left: 0;
          }
        }
      `}</style>
    </div>
  );
}
