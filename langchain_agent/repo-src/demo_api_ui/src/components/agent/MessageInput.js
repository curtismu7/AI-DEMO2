// banking_api_ui/src/components/agent/MessageInput.js
import React, { useState, useRef, useEffect } from 'react';

/**
 * Enhanced message input component with modern design and accessibility
 * 
 * @param {Object} props
 * @param {string} props.placeholder - Input placeholder text
 * @param {boolean} props.disabled - Whether input is disabled
 * @param {boolean} props.loading - Whether input is in loading state
 * @param {Function} props.onSend - Callback when message is sent
 * @param {Function} props.onCancel - Callback to cancel current operation
 * @param {string} props.cancelText - Text for cancel button
 * @param {Array} props.suggestions - Auto-complete suggestions
 */
export default function MessageInput({
  placeholder = "Ask me anything about your accounts...",
  disabled = false,
  loading = false,
  onSend,
  onCancel,
  cancelText = "Cancel",
  suggestions = [],
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Handle input changes
  const handleChange = (e) => {
    const value = e.target.value;
    setInput(value);
    setSelectedSuggestion(0);
    
    // Show suggestions if available and input has content
    if (suggestions.length > 0 && value.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!input.trim() || disabled || loading) return;
    
    const message = input.trim();
    setInput('');
    setShowSuggestions(false);
    setSelectedSuggestion(0);
    
    if (onSend) {
      onSend(message);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestion((prev) => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestion((prev) => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        
        // If showing suggestions, select the highlighted one
        if (showSuggestions) {
          const suggestion = suggestions[selectedSuggestion];
          setInput(suggestion);
          setShowSuggestions(false);
          setSelectedSuggestion(0);
          inputRef.current?.focus();
        } else {
          handleSubmit(e);
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setSelectedSuggestion(0);
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    }
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    setShowSuggestions(false);
    setSelectedSuggestion(0);
    inputRef.current?.focus();
  };

  // Handle cancel
  const handleCancel = () => {
    setInput('');
    setShowSuggestions(false);
    setSelectedSuggestion(0);
    if (onCancel) {
      onCancel();
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target) &&
        !inputRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter suggestions based on input
  const filteredSuggestions = suggestions.filter(suggestion =>
    suggestion.toLowerCase().includes(input.toLowerCase())
  );

  return (
    <div className="agent-input-container">
      <form onSubmit={handleSubmit} className="agent-input-form">
        <div className="agent-input-wrapper">
          {/* Input field */}
          <div className="agent-input-field-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || loading}
              className="agent-input-field"
              rows={1}
              aria-label="Message input"
              aria-describedby={showSuggestions ? "agent-suggestions" : undefined}
              aria-autocomplete="list"
            />
            
            {/* Character count for accessibility */}
            <span className="sr-only" aria-live="polite">
              {input.length} characters
            </span>
          </div>

          {/* Action buttons */}
          <div className="agent-input-actions">
            {loading && (
              <button
                type="button"
                onClick={handleCancel}
                className="agent-input-button agent-input-cancel"
                aria-label={cancelText}
              >
                {cancelText}
              </button>
            )}
            
            <button
              type="submit"
              disabled={!input.trim() || disabled || loading}
              className="agent-input-button agent-input-send"
              aria-label="Send message"
            >
              {loading ? (
                <div className="agent-input-spinner" aria-hidden="true">
                  <div className="agent-spinner-dot" />
                  <div className="agent-spinner-dot" style={{ animationDelay: '0.1s' }} />
                  <div className="agent-spinner-dot" style={{ animationDelay: '0.2s' }} />
                </div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m22 2-7 20-4-4-6-16z" />
                  <path d="M11 6 2 2l5.5 5.5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            id="agent-suggestions"
            className="agent-suggestions"
            role="listbox"
            aria-label="Suggestions"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={suggestion}
                role="option"
                aria-selected={index === selectedSuggestion}
                tabIndex={-1}
                className={`agent-suggestion-item ${
                  index === selectedSuggestion ? 'agent-suggestion-selected' : ''
                }`}
                onClick={() => handleSuggestionClick(suggestion)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSuggestionClick(suggestion);
                  }
                }}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Helper text */}
      <div className="agent-input-helper">
        <span className="agent-input-hint">
          Press Enter to send, Shift+Enter for new line
        </span>
      </div>
    </div>
  );
}
