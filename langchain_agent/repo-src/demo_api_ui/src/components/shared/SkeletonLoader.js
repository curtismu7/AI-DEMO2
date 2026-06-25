// banking_api_ui/src/components/shared/SkeletonLoader.js
import React from 'react';
import './SkeletonLoader.css';

const SkeletonLoader = ({ 
  variant = 'text', 
  width, 
  height, 
  lines = 1, 
  className = '',
  animate = true,
  circle = false 
}) => {
  const skeletonClass = [
    'skeleton',
    `skeleton--${variant}`,
    className,
    animate ? 'skeleton--animate' : '',
    circle ? 'skeleton--circle' : ''
  ].filter(Boolean).join(' ');

  const style = {
    width: width || (variant === 'text' ? '100%' : undefined),
    height: height || (variant === 'text' ? '1em' : undefined)
  };

  if (variant === 'text' && lines > 1) {
    return (
      <div className={skeletonClass}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="skeleton__line"
            style={{
              width: index === lines - 1 ? '60%' : '100%',
              height: height || '1em'
            }}
          />
        ))}
      </div>
    );
  }

  return <div className={skeletonClass} style={style} />;
};

// Predefined skeleton components
export const CardSkeleton = ({ className = '' }) => (
  <div className={`card-skeleton ${className}`}>
    <div className="card-skeleton__header">
      <SkeletonLoader variant="circle" width={40} height={40} />
      <div className="card-skeleton__title">
        <SkeletonLoader width="60%" height="1.2em" />
        <SkeletonLoader width="40%" height="0.9em" />
      </div>
    </div>
    <div className="card-skeleton__content">
      <SkeletonLoader lines={3} />
    </div>
  </div>
);

export const AccountCardSkeleton = ({ className = '' }) => (
  <div className={`account-card-skeleton ${className}`}>
    <div className="account-card-skeleton__header">
      <SkeletonLoader variant="circle" width={48} height={48} />
      <div className="account-card-skeleton__info">
        <SkeletonLoader width="70%" height="1.1em" />
        <SkeletonLoader width="50%" height="0.9em" />
      </div>
    </div>
    <div className="account-card-skeleton__balance">
      <SkeletonLoader width="40%" height="0.8em" />
      <SkeletonLoader width="60%" height="1.5em" />
    </div>
    <div className="account-card-skeleton__actions">
      <SkeletonLoader width={32} height={32} circle />
      <SkeletonLoader width={32} height={32} circle />
    </div>
  </div>
);

export const HeroSkeleton = ({ className = '' }) => (
  <div className={`hero-skeleton ${className}`}>
    <div className="hero-skeleton__content">
      <div className="hero-skeleton__title">
        <SkeletonLoader width="40%" height="2em" />
        <SkeletonLoader width="60%" height="1.2em" />
      </div>
      <div className="hero-skeleton__actions">
        <SkeletonLoader width={120} height={40} />
        <SkeletonLoader width={100} height={40} />
      </div>
    </div>
    <div className="hero-skeleton__features">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="hero-skeleton__feature">
          <SkeletonLoader variant="circle" width={32} height={32} />
          <SkeletonLoader width="60%" height="0.9em" />
        </div>
      ))}
    </div>
  </div>
);

export const ActionHubSkeleton = ({ className = '' }) => (
  <div className={`action-hub-skeleton ${className}`}>
    <div className="action-hub-skeleton__header">
      <SkeletonLoader width="30%" height="1.8em" />
      <SkeletonLoader width="50%" height="1em" />
    </div>
    <div className="action-hub-skeleton__primary">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="action-hub-skeleton__action">
          <SkeletonLoader variant="circle" width={48} height={48} />
          <div className="action-hub-skeleton__content">
            <SkeletonLoader width="70%" height="1.1em" />
            <SkeletonLoader width="90%" height="0.9em" />
          </div>
        </div>
      ))}
    </div>
    <div className="action-hub-skeleton__secondary">
      <SkeletonLoader width="25%" height="1.2em" />
      <div className="action-hub-skeleton__grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="action-hub-skeleton__item">
            <SkeletonLoader variant="circle" width={40} height={40} />
            <div className="action-hub-skeleton__item-content">
              <SkeletonLoader width="80%" height="0.9em" />
              <SkeletonLoader width="100%" height="0.8em" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const TableSkeleton = ({ rows = 5, columns = 4, className = '' }) => (
  <div className={`table-skeleton ${className}`}>
    <div className="table-skeleton__header">
      {Array.from({ length: columns }, (_, index) => (
        <SkeletonLoader key={index} height="1.2em" />
      ))}
    </div>
    <div className="table-skeleton__body">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="table-skeleton__row">
          {Array.from({ length: columns }, (_, colIndex) => (
            <SkeletonLoader key={colIndex} height="1em" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default SkeletonLoader;
