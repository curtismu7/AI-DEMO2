import React from 'react';
import PingIdentitySpinner from './PingIdentitySpinner';

/**
 * The screen shown while the sign-in check is in flight (App.js `loading`, and the
 * dashboard's own loading branch).
 *
 * It draws the SAME skeleton the HTML boot screen paints (index.html: `#boot-spinner`),
 * through the shared `.boot-skeleton` rules in that file, so a refresh is one
 * continuous screen: boot skeleton, then this, then the real chrome. It used to be a
 * small white card on a blank full-screen overlay, which hid the chrome and then
 * revealed it again: two large light-coloured swaps on every refresh.
 *
 * The label is the accessible name only. A visible label would put a token ink on
 * the skeleton's literal ground, which the ink-and-ground rule (H1) forbids. The tip
 * card under the mark is the shared spinner's own, drawn in literal ink/ground pairs.
 */
export default function AuthLoadingScreen({ label = 'Loading' }) {
  return (
    <div className="boot-skeleton">
      <div className="boot-bar" />
      <div className="boot-nav" />
      <div className="boot-main">
        <div className="boot-card" />
        <div className="boot-card boot-card--short" />
      </div>
      <div className="boot-skeleton__spinner">
        <PingIdentitySpinner size={56} aria-label={label} />
      </div>
    </div>
  );
}
