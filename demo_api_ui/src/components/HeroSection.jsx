import React from 'react';

function HeroSectionBase({
  avatar,
  title,
  description,
  subtitle,
  size = 'full',
  backgroundColor,
  avatarSize = 'md',
}) {
  const classes = `hero-section hero-section--${size}${avatarSize !== 'md' ? ` hero-avatar--${avatarSize}` : ''}`;
  const style = backgroundColor ? { '--hero-bg-gradient-from': backgroundColor } : {};

  return (
    <div className={classes} style={style}>
      <div className="hero-avatar">{avatar}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {subtitle && <p className="hero-subtitle">{subtitle}</p>}
    </div>
  );
}

export const HeroSection = React.memo(HeroSectionBase);
