// banking_api_ui/src/components/agent/MessageBubble.js
import React from 'react';
import { InlineMd, MarkdownContent } from '../shared/MarkdownText';

/**
 * Modern message bubble component with accessibility and animations
 * 
 * @param {Object} props
 * @param {string} props.content - Message text content
 * @param {'user'|'agent'|'system'} props.sender - Who sent the message
 * @param {Date|null} props.timestamp - When the message was sent
 * @param {'sending'|'sent'|'failed'|null} props.status - Message delivery status
 * @param {boolean} props.isTyping - Show typing indicator
 * @param {string|null} props.error - Error message if status is 'failed'
 * @param {Function} props.onRetry - Callback to retry failed message
 */
export default function MessageBubble({
  content,
  sender = 'agent',
  timestamp = null,
  status = null,
  isTyping = false,
  error = null,
  onRetry = null,
}) {
  const isUser = sender === 'user';
  const isSystem = sender === 'system';
  const hasError = status === 'failed';
  const isSending = status === 'sending';

  // Format timestamp
  const formatTime = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // Get bubble styles based on sender
  const getBubbleStyles = () => {
    if (isSystem) {
      return 'agent-message-system';
    }
    if (isUser) {
      return 'agent-message-user';
    }
    return 'agent-message-agent';
  };

  // Get status indicator
  const getStatusIndicator = () => {
    if (!isUser || !status) return null;

    if (isSending) {
      return (
        <div className="agent-message-status">
          <div className="agent-status-dot agent-status-sending" />
          <span className="sr-only">Message sending</span>
        </div>
      );
    }

    if (hasError) {
      return (
        <div className="agent-message-status">
          <button
            type="button"
            className="agent-status-button agent-status-error"
            onClick={onRetry}
            title={error || 'Failed to send'}
            aria-label={`Retry sending message: ${error || 'Failed to send'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6M23 20v-6h-6" />
              <path d="m20.49 9-9.05 9.05a2 2 0 0 1-2.83 0l-6.36-6.36a2 2 0 0 1 0-2.83l9.05-9.05a2 2 0 0 1 2.83 0l6.36 6.36a2 2 0 0 1 0 2.83Z" />
            </svg>
            <span className="sr-only">Retry sending message</span>
          </button>
        </div>
      );
    }

    return (
      <div className="agent-message-status">
        <div className="agent-status-dot agent-status-sent" />
        <span className="sr-only">Message sent</span>
      </div>
    );
  };

  // Typing indicator
  if (isTyping) {
    return (
      <div className={`agent-message-wrapper ${getBubbleStyles()}`}>
        <div className="agent-message-bubble">
          <output className="agent-typing-indicator" aria-live="polite">
            <div className="agent-typing-dot" />
            <div className="agent-typing-dot" style={{ animationDelay: '0.2s' }} />
            <div className="agent-typing-dot" style={{ animationDelay: '0.4s' }} />
            <span className="sr-only">Agent is typing</span>
          </output>
        </div>
      </div>
    );
  }

  return (
    <div className={`agent-message-wrapper ${getBubbleStyles()}`}>
      <div className="agent-message-bubble">
        {/* Message content */}
        <div className="agent-message-content">
          {isSystem ? (
            <div className="agent-message-system-content">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span><InlineMd text={content} /></span>
            </div>
          ) : (
            <MarkdownContent text={content} className="agent-message-text" />
          )}
        </div>

        {/* Timestamp and status */}
        {(timestamp || status) && (
          <div className="agent-message-footer">
            {timestamp && (
              <time 
                className="agent-message-timestamp"
                dateTime={timestamp.toISOString()}
              >
                {formatTime(timestamp)}
              </time>
            )}
            {getStatusIndicator()}
          </div>
        )}

        {/* Error message */}
        {hasError && error && (
          <div className="agent-message-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
