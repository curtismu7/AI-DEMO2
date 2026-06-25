import React, { useState, useEffect } from 'react';
import ChatWidget from './ChatWidget';
import ChatFAB from './ChatFAB';

const EmbeddableChatWidget = ({
  // Configuration options
  apiUrl = 'ws://localhost:8082/ws',
  position = 'bottom-right',
  theme = 'light',
  title = 'AI Banking Assistant',
  autoOpen = false,
  showFAB = true,
  fabTheme = 'light',
  
  // Callbacks
  onOpen,
  onClose,
  onMessage,
  onDashboardRefresh,
  
  // Styling
  customStyles = {},
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleToggle = (open) => {
    const newState = open !== undefined ? open : !isOpen;
    setIsOpen(newState);
    
    if (newState) {
      setUnreadCount(0); // Clear unread count when opened
      if (onOpen) onOpen();
    } else {
      if (onClose) onClose();
    }
  };

  const handleFABClick = () => {
    handleToggle();
  };

  // Listen for new messages to update unread count
  useEffect(() => {
    if (!isOpen && onMessage) {
      // This would be connected to your WebSocket message handler
      // For now, it's just a placeholder
    }
  }, [isOpen, onMessage]);

  return (
    <div className={`embeddable-chat-widget ${className}`} style={customStyles}>
      {showFAB && (
        <ChatFAB
          onClick={handleFABClick}
          isOpen={isOpen}
          position={position}
          theme={fabTheme}
          unreadCount={unreadCount}
        />
      )}
      
      <ChatWidget
        isOpen={isOpen}
        onToggle={handleToggle}
        position={position}
        theme={theme}
        title={title}
        apiUrl={apiUrl}
        onDashboardRefresh={onDashboardRefresh}
      />
    </div>
  );
};

export default EmbeddableChatWidget;