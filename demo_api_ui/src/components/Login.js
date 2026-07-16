import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useEducationUIOptional } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import { notifyError } from '../utils/appToast';
import { useIndustryBranding } from '../context/IndustryBrandingContext';
import { navigateToAdminOAuthLogin, navigateToCustomerOAuthLogin } from '../utils/authUi';
import './Login.css';

const Login = () => {
  const { preset } = useIndustryBranding();
  const [loading] = useState(false);
  const [searchParams] = useSearchParams();
  const edu = useEducationUIOptional();
  const [oauthDebug, setOauthDebug] = useState(null);

  useEffect(() => {
    axios.get('/api/auth/oauth/redirect-info')
      .then(r => setOauthDebug(r.data))
      .catch(() => {});
  }, []);

  const handleOAuthLogin = navigateToAdminOAuthLogin;
  const handleUserOAuthLogin = navigateToCustomerOAuthLogin;

  // Handle OAuth error parameters from URL
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      // Sanitize URL-derived values to prevent rendering attacker-controlled content
      const sanitize = (s) => (s || '').slice(0, 120).replace(/[<>&"']/g, '');
      let errorMessage = '';
      switch (errorParam) {
        case 'oauth_error':
          errorMessage = 'OAuth authentication failed. Please try again.';
          break;
        case 'invalid_state':
          errorMessage = 'Invalid authentication state. Please try again.';
          break;
        case 'no_code':
          errorMessage = 'No authorization code received. Please try again.';
          break;
        case 'callback_failed': {
          const detail = sanitize(searchParams.get('detail'));
          if (detail === 'invalid_client') {
            errorMessage = 'Sign-in failed due to a configuration issue. Please contact your administrator.';
          } else if (detail === 'invalid_grant') {
            errorMessage = 'Your sign-in session expired. Please try again.';
          } else if (detail === 'access_denied') {
            errorMessage = 'Access was denied. Please contact your administrator if this is unexpected.';
          } else {
            errorMessage = 'Sign-in could not be completed. Please try again.';
          }
          break;
        }
        case 'too_many_requests':
          errorMessage = 'Too many sign-in attempts. Please wait a few minutes and try again.';
          break;
        case 'oauth_init_failed':
          errorMessage = 'Sign-in is temporarily unavailable. Please try again.';
          break;
        case 'session_persist_failed':
          errorMessage =
            'PingOne sign-in succeeded, but the app could not save your session to the server store (for example Upstash Redis quota or misconfigured KV_REST_* env vars). '
            + 'Fix the session store, then sign in again.';
          break;
        default:
          errorMessage = 'Something went wrong during sign-in. Please try again.';
      }
      notifyError(errorMessage);
    }
  }, [searchParams]);

  const loginContainerStyle = {
    background: `url(${process.env.PUBLIC_URL}/images/pexels-1462751220-33995750.jpg)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat'
  };

  return (
    <div className="login-container login-page" style={loginContainerStyle}>
        <div className="login-card">
          <div className="login-header login-card__header">
            <div className="login-branding">
              <div className="login-logo">
                <div className="logo-icon">
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                </div>
                <span className="bank-name">{preset.shortName}</span>
              </div>
            </div>
            <h1>Secure Account Access</h1>
            <p className="login-product-line">{preset.tagline || 'PingOne AI IAM Core'}</p>
            <p>Sign in to access your banking services</p>
          </div>

          <div className="oauth-login login-card__body">
            <div className="oauth-options">
              <div className="oauth-option">
                <h4>Admin Access</h4>
                <p>Uses the admin PingOne app → after sign-in you land on <strong>Admin Dashboard</strong> (<code>/admin</code>): logs, all users &amp; accounts, security settings, config.</p>
                <button
                  onClick={handleOAuthLogin}
                  className="btn btn-primary oauth-btn"
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : 'Admin Sign In'}
                </button>
              </div>

              <div className="oauth-divider">
                <span>or</span>
              </div>

              <div className="oauth-option">
                <h4>End User Access</h4>
                <p>Uses the customer PingOne app → <strong>Personal dashboard</strong> (<code>/dashboard</code>) with your accounts only.</p>
                <button
                  onClick={handleUserOAuthLogin}
                  className="btn btn-danger oauth-btn"
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : 'Customer Sign In'}
                </button>
              </div>
            </div>
          </div>

          <div className="login-education-actions" style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem' }}
              onClick={() => edu?.open(EDU.LOGIN_FLOW, 'what')}
            >
              How does this sign-in work?
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem' }}
              onClick={() => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } })); }}
            >
              What is CIBA?
            </button>
            <span style={{ fontSize: '0.8rem', color: '#374151' }}>
              <Link to="/onboarding">Setup checklist</Link>
              {' · '}
              <Link to="/setup">Deployment setup</Link>
              {' · '}
              <Link to="/setup/pingone">PingOne reference</Link>
              {' · '}
              <span>Admin vs customer: use the Learn bar after sign-in, or the CIBA guide (floating).</span>
            </span>
          </div>

          <p className="login-onboarding-hint" style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.9rem' }}>
            <Link to="/onboarding" style={{ color: 'var(--brand-navy)', fontWeight: 500 }}>
              First-time setup — what to configure in PingOne
            </Link>
          </p>

          <div className="login-footer">
            <p>
              <strong>PingOne AI IAM Core</strong><br />
              Secure authentication powered by PingOne AI IAM Core
            </p>
          </div>

          {oauthDebug && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'inherit', color: '#374151' }}>
              <div><strong>env_id:</strong> {oauthDebug.environmentId || 'MISSING'}</div>
              <div><strong>admin_client_id:</strong> {oauthDebug.adminClientId || 'MISSING'}</div>
              <div><strong>user_client_id:</strong> {oauthDebug.userClientId || 'MISSING'}</div>
            </div>
          )}
        </div>
      </div>
  );
};

export default Login;
