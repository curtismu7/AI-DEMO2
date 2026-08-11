import React from 'react';
import styles from './HeroSection.module.css';

export default function HeroSection({ greeting, imageUrl, isLoading }) {
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
