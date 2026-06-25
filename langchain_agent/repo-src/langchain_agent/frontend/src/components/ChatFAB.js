import React from 'react';
import './ChatFAB.css';

const ChatFAB = ({ 
  onClick, 
  isOpen = false, 
  position = 'bottom-right',
  theme = 'light',
  unreadCount = 0 
}) => {
  return (
    <button 
      className={`chat-fab chat-fab--${position} chat-fab--${theme} ${isOpen ? 'chat-fab--open' : ''}`}
      onClick={onClick}
      title="Open AI Banking Assistant"
    >
      <div className="chat-fab__icon">
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        )}
      </div>
      
      {unreadCount > 0 && (
        <div className="chat-fab__badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </div>
      )}
      
      <div className="chat-fab__ripple"></div>
    </button>
  );
};

export default ChatFAB;