import React from 'react';
import PropTypes from 'prop-types';

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

HeroSectionBase.propTypes = {
  avatar: PropTypes.node,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  size: PropTypes.oneOf(['full', 'compact']),
  backgroundColor: PropTypes.string,
  avatarSize: PropTypes.oneOf(['sm', 'md', 'lg']),
};

export const HeroSection = React.memo(HeroSectionBase);
