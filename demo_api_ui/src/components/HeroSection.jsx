import React from 'react';

function HeroSectionBase({
  avatar,
  title,
  description,
  subtitle,
  size = 'full',
  backgroundColor = '#1e40af',
  avatarSize = 'md',
}) {
  const style = {
    '--hero-bg-gradient-from': backgroundColor,
    '--hero-size': size,
    '--hero-avatar-size': avatarSize,
  };

  return (
    <div className="hero-section" style={style}>
      <div className="hero-avatar">{avatar}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {subtitle && size === 'full' && <p className="hero-subtitle">{subtitle}</p>}
    </div>
  );
}

export const HeroSection = React.memo(HeroSectionBase);
