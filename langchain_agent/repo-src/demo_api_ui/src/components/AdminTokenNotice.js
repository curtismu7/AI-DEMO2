import { MdSwapHoriz } from 'react-icons/md';
import { useRoleSwitch } from '../hooks/useRoleSwitch';
import './AdminTokenNotice.css';

/**
 * Inline notice for surfaces that need customer account data but are open to any
 * logged-in user (e.g. the MCP tool testers). With an admin token those reads
 * 403 by design — this explains why and offers a real switch to a user token,
 * instead of leaving an unexplained empty account selector.
 */
export default function AdminTokenNotice({
  message = "You're signed in with an admin token, so customer accounts aren't available here. Switch to a user token to run banking tool calls.",
}) {
  const { switching, switchRole } = useRoleSwitch();

  return (
    <div className="admin-token-notice" role="note">
      <span className="admin-token-notice__text">{message}</span>
      <button
        type="button"
        className="admin-token-notice__btn"
        onClick={() => switchRole('customer')}
        disabled={switching}
      >
        <MdSwapHoriz size={16} />
        <span>{switching ? 'Switching…' : 'Switch to user token'}</span>
      </button>
    </div>
  );
}
