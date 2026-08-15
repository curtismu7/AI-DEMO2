import React from 'react';
import styles from './AgentGreetingHero.module.css';

/**
 * AgentGreetingHero — the chat surface's landing banner: the active vertical's
 * photo, full-bleed behind a dark scrim, with an inviting greeting.
 *
 * Named to collide with neither of the two "hero" things that already exist:
 *   - `HeroSection` — shared avatar/title/description page header
 *     (Graphify, Code Explorer, OAuth Academy)
 *   - `.vertical-hero*` / manifest `dashboard.hero` — the dashboard stat cards
 * Content comes from the manifest's top-level `hero` block.
 *
 * Colors are deliberately theme-independent — white on a dark scrim over a
 * photo reads the same in light and dark, so it references no theme token.
 */
export default function AgentGreetingHero({ greeting, imageUrl, isLoading }) {
  return (
    <div className={styles.heroContainer}>
      <div
        className={styles.heroBackground}
        style={{ backgroundImage: `url('${imageUrl}')` }}
      />
      <div className={styles.heroOverlay} />
      <div className={styles.heroContent}>
        <p className={styles.heroText}>{greeting}</p>
        {isLoading && <p className={styles.loadingText}>Loading conversation...</p>}
      </div>
    </div>
  );
}
