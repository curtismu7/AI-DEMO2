import React from 'react';
import './LoadingSpinner.css';

export default function LoadingSpinner({ size = 'medium', className = '' }) {
  return (
    <div className={`loading-spinner loading-spinner--${size} ${className}`}>
      <div className="loading-spinner-ring"></div>
      <div className="loading-spinner-ring"></div>
      <div className="loading-spinner-ring"></div>
      <div className="loading-spinner-ring"></div>
    </div>
  );
}
