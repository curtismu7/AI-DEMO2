import React from 'react';
import { Link } from 'react-router-dom';
import './PageHeader.css';

export function BackLink({ to, children, className = '' }) {
  return (
    <Link className={`ping-back-link ${className}`.trim()} to={to}>
      <span aria-hidden="true">←</span> {children}
    </Link>
  );
}

/**
 * Standard page header: Core Dark gradient band, optional back link, eyebrow,
 * h1, summary, badge and actions. `children` render under the summary (search
 * boxes, filter rows) inside the band.
 */
export default function PageHeader({ eyebrow, title, summary, back, badge, actions, className = '', children }) {
  return (
    <header className={`ping-page-header ${className}`.trim()}>
      {back ? <BackLink to={back.to}>{back.label}</BackLink> : null}
      <div className="ping-page-header__row">
        <div className="ping-page-header__copy">
          {eyebrow ? <p className="ping-page-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="ping-page-header__title">{title}</h1>
          {summary ? <p className="ping-page-header__summary">{summary}</p> : null}
        </div>
        {badge || actions ? (
          <div className="ping-page-header__side">
            {badge ? <span className="ping-page-header__badge">{badge}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
