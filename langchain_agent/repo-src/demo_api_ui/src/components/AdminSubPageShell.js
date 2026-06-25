// banking_api_ui/src/components/AdminSubPageShell.js
import React from 'react';
import '../styles/appShellPages.css';

/**
 * Admin sub-page layout: blue hero + body (matches Demo config / Config / Dashboard shell).
 * @param {object} props
 * @param {string} props.title Page title in the hero
 * @param {import('react').ReactNode} [props.lead] Optional subtitle (string or JSX)
 * @param {boolean} [props.wide] Use wide body column (default true for data tables)
 * @param {import('react').ReactNode} props.children Main content (PageNav, toolbars, cards)
 */
export default function AdminSubPageShell({ title, lead, wide = true, children }) {
  const bodyClass = wide
    ? 'app-page-shell__body app-page-shell__body--wide'
    : 'app-page-shell__body';

  return (
    <div className="admin-sub-page app-page-shell">
      <header className="app-page-shell__hero">
        <div className="app-page-shell__hero-top">
          <div>
            <h1 className="app-page-shell__title">{title}</h1>
            {lead != null && lead !== '' && (
              <div className="app-page-shell__lead">{lead}</div>
            )}
          </div>
        </div>
      </header>
      <div className={bodyClass}>{children}</div>
    </div>
  );
}
