import { useNavigate } from 'react-router-dom';
import { MdLock, MdSwapHoriz, MdLogout } from 'react-icons/md';
import { useRoleSwitch } from '../hooks/useRoleSwitch';
import './AdminBlockedDashboard.css';

/**
 * Shown on /dashboard when the active token is an admin token. The customer
 * dashboard is an end-user surface, so an admin token must not open it
 * (enforced on the backend too: /api/accounts/my + /api/transactions/my 403).
 * The only way in is to switch to a user token, which this screen prompts.
 */
export default function AdminBlockedDashboard({ onLogout }) {
  const navigate = useNavigate();
  const { switching, switchRole } = useRoleSwitch();

  return (
    <div className="admin-blocked">
      <div className="admin-blocked__card">
        <div className="admin-blocked__icon" aria-hidden="true">
          <MdLock size={32} />
        </div>
        <h1 className="admin-blocked__title">Customer dashboard unavailable</h1>
        <p className="admin-blocked__body">
          You are signed in with an <strong>admin token</strong>. The customer
          dashboard and its account data are end-user surfaces and cannot be
          opened with an admin token. Switch to a user token to continue.
        </p>
        <div className="admin-blocked__actions">
          <button
            type="button"
            className="admin-blocked__btn admin-blocked__btn--primary"
            onClick={() => switchRole('customer')}
            disabled={switching}
          >
            <MdSwapHoriz size={18} />
            <span>{switching ? 'Switching…' : 'Switch to user token'}</span>
          </button>
          <button
            type="button"
            className="admin-blocked__btn"
            onClick={() => navigate('/admin')}
          >
            Go to Admin Console
          </button>
          <button
            type="button"
            className="admin-blocked__btn admin-blocked__btn--ghost"
            onClick={() => onLogout?.()}
          >
            <MdLogout size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
