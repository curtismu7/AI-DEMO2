// banking_api_ui/src/components/QuickLoginModal.js
/**
 * QuickLoginModal — lightweight overlay shown when a protected route
 * (/accounts, /transactions, /users) is hit while the visitor is not logged in.
 *
 * Provides a PingOne Customer Sign In button. No content is fetched until logged in.
 * Pass onClose to dismiss without navigating (e.g. when user is cookie-restored).
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DraggableModal from './DraggableModal';
import AuthButton from './AuthButton';
import { navigateToCustomerOAuthForceLogin } from '../utils/authUi';

const BODY_STYLE = {
  padding: '32px 36px',
  textAlign: 'center',
};

const ICON_STYLE = {
  fontSize: '2.5rem',
  marginBottom: '12px',
};

const TITLE_STYLE = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 8px',
};

const SUBTITLE_STYLE = {
  fontSize: '0.9rem',
  color: '#374151',
  margin: '0 0 28px',
  lineHeight: 1.5,
};

export default function QuickLoginModal({ pathname, onClose }) {
  const navigate = useNavigate();

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      navigate('/', { replace: true });
    }
  }, [onClose, navigate]);

  const handleCustomerLogin = () => {
    try { sessionStorage.setItem('post_login_redirect', pathname); } catch {}
    navigateToCustomerOAuthForceLogin();
  };

  return (
    <DraggableModal
      isOpen
      onClose={handleClose}
      title="Sign in required"
      footer={null}
      defaultWidth={440}
      defaultHeight={380}
      minHeight={280}
      zIndex={20000}
      storageKey="quick-login-modal"
    >
      <div style={BODY_STYLE}>
        <div style={ICON_STYLE}>&#128272;</div>
        <h2 style={TITLE_STYLE}>Sign in to continue</h2>
        <p style={SUBTITLE_STYLE}>
          Customer authentication is required to complete the Human-in-the-Loop (HITL) approval step.
        </p>
        <AuthButton variant="customer" onClick={handleCustomerLogin}>
          Customer Sign In
        </AuthButton>
        <AuthButton variant="ghost" onClick={handleClose}>
          Back to Home
        </AuthButton>
      </div>
    </DraggableModal>
  );
}
