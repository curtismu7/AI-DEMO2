import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="not-found-page">
      <div className="not-found-container">
        <div className="not-found-code">404</div>
        <h1>Page not found</h1>
        <p className="not-found-message">
          <code>{location.pathname}</code> doesn't exist.
        </p>
        <div className="not-found-actions">
          <button
            className="not-found-button not-found-button--primary"
            onClick={() => navigate('/')}
          >
            Go Home
          </button>
          <button
            className="not-found-button not-found-button--secondary"
            onClick={() => navigate(-1)}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
