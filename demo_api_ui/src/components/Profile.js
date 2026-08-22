import React, { useCallback, useEffect, useState } from 'react';
import { MdCheckCircle } from 'react-icons/md';
import { toast } from 'react-toastify';
import bffAxios from '../services/bffAxios';
import AgentAccessCard from './AgentAccessCard';
import SignInPrompt from './SignInPrompt';
import './Profile.css';

function DeviceIcon({ type }) {
  const t = (type || '').toUpperCase();
  if (t === 'EMAIL') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <title>Email device</title>
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }
  if (t === 'TOTP') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <title>Authenticator app device</title>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12,6 12,12 16,14" />
      </svg>
    );
  }
  if (t === 'FIDO2') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <title>Security key device</title>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <title>Mobile device</title>
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

export default function Profile({ user }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });

  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [removingId, setRemovingId] = useState(null);

  const [enrollStep, setEnrollStep] = useState(null); // null | 'email' | 'otp' | 'done'
  const [enrollEmail, setEnrollEmail] = useState('');
  const [enrollDeviceId, setEnrollDeviceId] = useState('');
  const [enrollOtp, setEnrollOtp] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);

  const [showSuccessScreen, setShowSuccessScreen] = useState(!user?.hideSuccessScreen);
  const [savingPreference, setSavingPreference] = useState(false);

  // `/profile` isn't gated on useAuth's `loading` flag, so this mounts with
  // `user=null` while the session check is in flight — the useState
  // initializers above only run once, locking formData/showSuccessScreen to
  // empty/default values that never picked up the real profile once `user`
  // populated. Re-sync whenever `user` changes, skipping while an edit is
  // in progress so this can't clobber unsaved input.
  useEffect(() => {
    if (!user || isEditing) return;
    setFormData({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
    });
    setShowSuccessScreen(!user.hideSuccessScreen);
  }, [user, isEditing]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const res = await bffAxios.get('/api/auth/mfa/devices');
      setDevices(res.data.devices || []);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await bffAxios.patch('/api/self-service/users/me', formData);
      toast.success('Profile updated successfully');
      setIsEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.error_description || err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
      phone: user?.phone || '',
    });
    setIsEditing(false);
  };

  const handleToggleSuccessScreen = async () => {
    setSavingPreference(true);
    try {
      const newValue = !showSuccessScreen;
      await bffAxios.post('/api/auth/oauth/user/success-screen-preference', {
        hideSuccessScreen: !newValue,
      });
      setShowSuccessScreen(newValue);
      toast.success(newValue ? 'Success screen enabled' : 'Success screen disabled');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update preference');
    } finally {
      setSavingPreference(false);
    }
  };

  const handleRemoveDevice = async (deviceId) => {
    setRemovingId(deviceId);
    try {
      await bffAxios.delete(`/api/auth/mfa/devices/${deviceId}`);
      toast.success('Device removed');
      setDevices(prev => prev.filter(d => d.id !== deviceId));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove device');
    } finally {
      setRemovingId(null);
    }
  };

  const handleOpenEnroll = () => {
    setEnrollEmail(user?.email || '');
    setEnrollOtp('');
    setEnrollDeviceId('');
    setEnrollStep('email');
  };

  const handleEnrollSendOtp = async (e) => {
    e.preventDefault();
    if (!enrollEmail.trim()) return;
    setEnrollBusy(true);
    try {
      const res = await bffAxios.post('/api/auth/mfa/enroll/email', { email: enrollEmail.trim() });
      setEnrollDeviceId(res.data.deviceId);
      setEnrollStep('otp');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send OTP');
    } finally {
      setEnrollBusy(false);
    }
  };

  const handleEnrollVerifyOtp = async (e) => {
    e.preventDefault();
    if (!enrollOtp.trim()) return;
    setEnrollBusy(true);
    try {
      await bffAxios.post('/api/auth/mfa/enroll/email/verify', {
        deviceId: enrollDeviceId,
        otp: enrollOtp.trim(),
      });
      setEnrollStep('done');
      await loadDevices();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid OTP — please try again');
    } finally {
      setEnrollBusy(false);
    }
  };

  const accountStatus = user?.enabled === false ? 'DISABLED' : 'ACCOUNT OK';
  const mfaEnabled = devices.length > 0 ? 'Yes' : 'No';

  // Signed out: don't render a hollow profile (every field "—", empty device
  // list) as if it were real — show the page heading and ask.
  if (!user) {
    return (
      <div className="up-page">
        <div className="up-heading">
          <h1>User Portal</h1>
          <p>Manage your profile and multi-factor authentication devices.</p>
        </div>
        <SignInPrompt message="Sign in to view and manage your profile." />
      </div>
    );
  }

  return (
    <div className="up-page">
      <div className="up-heading">
        <h1>User Portal</h1>
        <p>Manage your profile and multi-factor authentication devices.</p>
      </div>

      {/* Profile Information */}
      <div className="up-card">
        <div className="up-card__header">
          <span className="up-card__title">Profile Information</span>
          {!isEditing && (
            <button type="button" className="up-btn up-btn--edit" onClick={() => setIsEditing(true)}>
              Edit Profile
            </button>
          )}
        </div>

        {isEditing ? (
          <form onSubmit={handleSubmit} className="up-form">
            <div className="up-form__row">
              <div className="up-form__field">
                <label htmlFor="firstName">FIRST NAME</label>
                <input id="firstName" name="firstName" value={formData.firstName} onChange={handleChange} required />
              </div>
              <div className="up-form__field">
                <label htmlFor="lastName">LAST NAME</label>
                <input id="lastName" name="lastName" value={formData.lastName} onChange={handleChange} required />
              </div>
              <div className="up-form__field">
                <label htmlFor="email">EMAIL</label>
                <input id="email" type="email" name="email" value={formData.email} onChange={handleChange} required />
              </div>
            </div>
            <div className="up-form__row">
              <div className="up-form__field">
                <label htmlFor="phone">PHONE</label>
                <input id="phone" type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="—" />
              </div>
            </div>
            <div className="up-form__actions">
              <button type="button" className="up-btn up-btn--secondary" onClick={handleCancel}>Cancel</button>
              <button type="submit" className="up-btn up-btn--edit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <div className="up-fields">
            <div className="up-field">
              <span className="up-field__label">FIRST NAME</span>
              <span className="up-field__value">{user?.firstName || '—'}</span>
            </div>
            <div className="up-field">
              <span className="up-field__label">LAST NAME</span>
              <span className="up-field__value">{user?.lastName || '—'}</span>
            </div>
            <div className="up-field">
              <span className="up-field__label">EMAIL</span>
              <span className="up-field__value">{user?.email || '—'}</span>
            </div>
            <div className="up-field">
              <span className="up-field__label">USERNAME</span>
              <span className="up-field__value">{user?.username || '—'}</span>
            </div>
            <div className="up-field">
              <span className="up-field__label">PHONE</span>
              <span className="up-field__value">{user?.phone || '—'}</span>
            </div>
            <div className="up-field">
              <span className="up-field__label">ACCOUNT STATUS</span>
              <span className={`up-field__value up-field__value--status${accountStatus === 'ACCOUNT OK' ? ' ok' : ' disabled'}`}>
                {accountStatus}
              </span>
            </div>
            <div className="up-field">
              <span className="up-field__label">MFA ENABLED</span>
              <span className={`up-field__value up-field__value--status${mfaEnabled === 'Yes' ? ' ok' : ''}`}>
                {devicesLoading ? '…' : mfaEnabled}
              </span>
            </div>
            <div className="up-field up-field--wide">
              <span className="up-field__label">USER ID</span>
              <span className="up-field__value up-field__value--mono">{user?.oauthId || user?.id || '—'}</span>
            </div>
          </div>
        )}
      </div>

      {/* MFA Devices */}
      <div className="up-card">
        <div className="up-card__header">
          <span className="up-card__title">MFA Devices</span>
        </div>

        <div className="up-mfa-layout">
          <div className="up-device-list">
            <span className="up-device-list__label">Your Devices</span>

            {devicesLoading && (
              <div className="up-device-empty">Loading devices…</div>
            )}
            {!devicesLoading && devices.length === 0 && (
              <div className="up-device-empty">No MFA devices enrolled.</div>
            )}
            {!devicesLoading && devices.map(device => (
              <div key={device.id} className="up-device">
                <div className="up-device__icon">
                  <DeviceIcon type={device.type} />
                </div>
                <div className="up-device__info">
                  <span className="up-device__name">{device.type}</span>
                  <span className="up-device__sub">
                    {device.type}{device.maskedContact ? ` • ${device.maskedContact}` : ''}
                  </span>
                </div>
                <span className="up-device__badge">
                  <MdCheckCircle aria-hidden style={{ verticalAlign: 'middle', marginRight: 4, color: '#2e7d32' }} /> Verified
                </span>
                <button
                  type="button"
                  className="up-btn up-btn--remove"
                  onClick={() => handleRemoveDevice(device.id)}
                  disabled={removingId === device.id}
                >
                  {removingId === device.id ? '…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>

          <div className="up-manage-panel">
            <span className="up-manage-panel__label">Manage Devices</span>
            <p className="up-manage-panel__desc">Add a new MFA device to your account</p>
            <button type="button" className="up-btn up-btn--add" onClick={handleOpenEnroll}>
              + Add New Device
            </button>
            <button type="button" className="up-btn up-btn--refresh" onClick={loadDevices} disabled={devicesLoading}>
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {enrollStep !== null && (
        <div className="up-modal-backdrop">
          <div
            className="up-modal"
            role="dialog"
            aria-modal="true"
          >
            {enrollStep === 'email' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Add Email OTP Device</span>
                  <button type="button" className="up-modal__close" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>✕</button>
                </div>
                <form onSubmit={handleEnrollSendOtp} className="up-modal__body">
                  <p className="up-modal__desc">We'll send a one-time code to this address to verify it.</p>
                  <div className="up-form__field">
                    <label htmlFor="enroll-email">EMAIL</label>
                    <input
                      id="enroll-email"
                      type="email"
                      value={enrollEmail}
                      onChange={e => setEnrollEmail(e.target.value)}
                      required
                      disabled={enrollBusy}
                    />
                  </div>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--secondary" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>Cancel</button>
                    <button type="submit" className="up-btn up-btn--edit" disabled={enrollBusy}>
                      {enrollBusy ? 'Sending…' : 'Send OTP'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {enrollStep === 'otp' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Enter Verification Code</span>
                  <button type="button" className="up-modal__close" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>✕</button>
                </div>
                <form onSubmit={handleEnrollVerifyOtp} className="up-modal__body">
                  <p className="up-modal__desc">Code sent to <strong>{enrollEmail}</strong>. Enter it below.</p>
                  <div className="up-form__field">
                    <label htmlFor="enroll-otp">VERIFICATION CODE</label>
                    <input
                      id="enroll-otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      value={enrollOtp}
                      onChange={e => setEnrollOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      disabled={enrollBusy}
                      placeholder="123456"
                    />
                  </div>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--secondary" onClick={() => setEnrollStep('email')} disabled={enrollBusy}>Back</button>
                    <button type="submit" className="up-btn up-btn--edit" disabled={enrollBusy}>
                      {enrollBusy ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {enrollStep === 'done' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Device Added</span>
                </div>
                <div className="up-modal__body">
                  <p className="up-modal__desc"><MdCheckCircle aria-hidden style={{ verticalAlign: 'middle', marginRight: 6, color: '#2e7d32' }} /> Email OTP device enrolled successfully.</p>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--edit" onClick={() => setEnrollStep(null)}>Done</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Login Preferences */}
      <div className="up-card">
        <div className="up-card__header">
          <span className="up-card__title">Login Preferences</span>
        </div>

        <div className="up-fields">
          <div className="up-field up-field--toggle">
            <div className="up-field__content">
              <span className="up-field__label">Success Screen</span>
              <span className="up-field__desc">Show the authentication success screen when you log in</span>
            </div>
            <button
              type="button"
              className={`up-toggle ${showSuccessScreen ? 'up-toggle--on' : 'up-toggle--off'}`}
              onClick={handleToggleSuccessScreen}
              disabled={savingPreference}
              aria-pressed={showSuccessScreen}
            >
              <span className="up-toggle__knob" />
            </button>
          </div>
        </div>
      </div>

      <AgentAccessCard />
    </div>
  );
}
