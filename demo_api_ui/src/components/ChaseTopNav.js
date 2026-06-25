// banking_api_ui/src/components/ChaseTopNav.js
import React, { useState } from 'react';
import BrandLogo from './BrandLogo';
import TRiSMTrainingPanel from './TRiSMTrainingPanel';
import { useIndustryBranding } from '../context/IndustryBrandingContext';
import './ChaseTopNav.css';

/**
 * ChaseTopNav — Brand-only horizontal top bar.
 * Phase 163: nav links, theme toggle, role switch, logout all moved to AdminSideNav.
 * Retained: brand logo, user greeting, Learn (TRiSM) panel.
 */
export default function ChaseTopNav({ user }) {
  const { preset } = useIndustryBranding();
  const [showTRiSMPanel, setShowTRiSMPanel] = useState(false);
  
  const isAdmin = user?.role === 'admin';

  return (
    <nav className="chase-top-nav">
      {/* LEFT: Logo + Brand Name */}
      <div className="chase-top-nav__left">
        <div className="chase-logo-container">
          <BrandLogo height={32} width={32} />
          <span className="chase-brand-name">{preset.shortName}</span>
        </div>
      </div>

      {/* RIGHT: User Greeting + Learn */}
      <div className="chase-top-nav__right">
        {user && (
          <div className="chase-user-greeting">
            <span className="chase-user-name">
              {(user.firstName || user.lastName)
                ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                : user.name || user.username || user.email?.split('@')[0] || 'Guest'}
            </span>
            <span className="chase-user-role">
              {isAdmin ? 'Admin' : 'User'}
            </span>
          </div>
        )}

        {/* AI TRiSM Training Button */}
        <button
          className={`chase-nav-button chase-nav-button--learn ${showTRiSMPanel ? 'active' : ''}`}
          onClick={() => setShowTRiSMPanel(!showTRiSMPanel)}
          title="AI TRiSM Training"
          aria-label="Open AI TRiSM Training Panel"
        >
          📚 Learn
        </button>
      </div>

      {/* TRiSM Training Panel (Phase 160) */}
      <TRiSMTrainingPanel
        isOpen={showTRiSMPanel}
        onClose={() => setShowTRiSMPanel(false)}
      />
    </nav>
  );
}
