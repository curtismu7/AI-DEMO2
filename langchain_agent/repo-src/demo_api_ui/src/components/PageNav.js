import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/appShellPages.css';

/**
 * Thin navigation bar for admin sub-pages: Back (history), Home, optional breadcrumb.
 * Phase 163: Log Out moved to AdminSideNav.
 */
export default function PageNav({ user, title }) {
  const navigate = useNavigate();
  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  return (
    <nav className="page-nav app-page-toolbar" aria-label="Page navigation">
      <button
        type="button"
        className="app-page-toolbar-btn"
        onClick={() => navigate(-1)}
      >
        ← Back
      </button>
      <Link to={homePath} className="app-page-toolbar-btn">
        ⌂ Home
      </Link>
      {title && (
        <span className="page-nav__trail">
          / {title}
        </span>
      )}
    </nav>
  );
}
