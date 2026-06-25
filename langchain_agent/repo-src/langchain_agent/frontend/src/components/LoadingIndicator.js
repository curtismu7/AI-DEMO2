import React from 'react';
import './LoadingIndicator.css';

const LoadingIndicator = () => {
  return (
    <div className="loading-indicator">
      <div className="loading-content">
        <div className="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div className="loading-text">Agent is thinking...</div>
      </div>
    </div>
  );
};

export default LoadingIndicator;