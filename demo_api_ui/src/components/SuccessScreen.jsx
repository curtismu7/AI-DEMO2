import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './SuccessScreen.css';

export default function SuccessScreen({ user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [hideChecked, setHideChecked] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const returnTo = searchParams.get('return_to') || '/dashboard';
  const redirectDelayMs = 3000;

  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }

    // If user has hideSuccessScreen pref set, skip this screen
    if (user.hideSuccessScreen) {
      navigate(returnTo);
      return;
    }

    // Auto-redirect after delay
    const timer = setTimeout(() => {
      handleContinue();
    }, redirectDelayMs);

    return () => clearTimeout(timer);
  }, [user, navigate, returnTo]);

  const handleContinue = async () => {
    if (hideChecked) {
      try {
        await fetch('/api/auth/oauth/user/success-screen-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hideSuccessScreen: true }),
        });
      } catch (error) {
        console.error('Failed to save preference:', error);
      }
    }
    setIsRedirecting(true);
    navigate(returnTo);
  };

  return (
    <div className="success-screen-container">
      <div className="success-screen-card">
        <div className="success-screen-icon">✅</div>
        <h1>Authenticated Successfully</h1>
        <p className="success-screen-subtitle">Redirecting to your account...</p>

        <div className="success-screen-checkbox-wrapper">
          <input
            type="checkbox"
            id="hideSuccessScreen"
            checked={hideChecked}
            onChange={(e) => setHideChecked(e.target.checked)}
            disabled={isRedirecting}
          />
          <label htmlFor="hideSuccessScreen">
            Don't show this screen again
          </label>
        </div>

        <button
          className="success-screen-button"
          onClick={handleContinue}
          disabled={isRedirecting}
        >
          {isRedirecting ? 'Redirecting...' : 'Continue to Dashboard'}
        </button>
      </div>
    </div>
  );
}
