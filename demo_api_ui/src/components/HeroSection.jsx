import React from 'react';

function HeroSectionBase({
  avatar,
  title,
  description,
  subtitle,
  isEmpty,
  variant,
}) {
  return (
    <div className={`hero-section hero-section--${variant}${!isEmpty ? ' hero-section--compact' : ''}`}>
      <div className="hero-avatar">{avatar}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {subtitle && <p className="hero-subtitle">{subtitle}</p>}
    </div>
  );
}

export const HeroSection = React.memo(HeroSectionBase);
