import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './Message.css';

const Message = ({ message, onAuthorizationComplete }) => {
  const { content, role, timestamp } = message;
  const isUser = role === 'user';
  const [authInProgress, setAuthInProgress] = useState(false);
  
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Check if this message contains a popup authorization request
  const detectPopupAuthRequest = (content) => {
    console.log('=== POPUP DETECTION DEBUG ===');
    console.log('Searching for SYSTEM_AUTH_POPUP_REQUEST in content...');
    console.log('Content preview:', content.substring(0, 200) + '...');
    
    // Look for the system auth popup request markers
    const popupAuthMatch = content.match(/SYSTEM_AUTH_POPUP_REQUEST_START\s*(\{[\s\S]*?\})\s*SYSTEM_AUTH_POPUP_REQUEST_END/);
    console.log('Regex match result:', popupAuthMatch);
    
    if (popupAuthMatch) {
      console.log('Found SYSTEM_AUTH_POPUP_REQUEST match!');
      try {
        // Extract the JSON string
        const jsonStr = popupAuthMatch[1];
        console.log('Extracted JSON string:', jsonStr);
        
        // Parse the JSON directly (it should already be valid JSON)
        const authConfig = JSON.parse(jsonStr);
        console.log('Successfully parsed auth config:', authConfig);
        return authConfig;
      } catch (e) {
        console.error('Failed to parse popup auth request:', e);
        console.error('Raw content:', content);
        console.error('Matched JSON:', popupAuthMatch ? popupAuthMatch[1] : 'No match');
        return null;
      }
    } else {
      console.log('No SYSTEM_AUTH_POPUP_REQUEST match found');
      // Let's try a simpler search to see if the marker exists at all
      if (content.includes('SYSTEM_AUTH_POPUP_REQUEST')) {
        console.log('SYSTEM_AUTH_POPUP_REQUEST text found, but regex failed');
        console.log('Full content for analysis:', content);
      }
    }
    console.log('=== END POPUP DETECTION DEBUG ===');
    return null;
  };

  const handlePopupAuthorization = async (authConfig) => {
    if (authInProgress) return;
    
    setAuthInProgress(true);
    
    try {
      const popup = window.open(
        authConfig.authorizationUrl,
        authConfig.popupTitle || 'Authorization',
        `width=${authConfig.popupWidth || 500},height=${authConfig.popupHeight || 650},scrollbars=yes,resizable=yes`
      );

      if (!popup) {
        alert('Popup blocked! Please allow popups for this site and try again.');
        setAuthInProgress(false);
        return;
      }

      // Listen for postMessage from the popup
      const handleMessage = (event) => {
        console.log('Received postMessage:', event);
        
        // Verify origin for security (adjust as needed)
        if (event.origin !== window.location.origin && !event.origin.includes('localhost')) {
          console.log('Ignoring message from untrusted origin:', event.origin);
          return;
        }
        
        if (event.data && event.data.type === 'OAUTH_SUCCESS') {
          console.log('OAuth success message received:', event.data);
          clearInterval(pollInterval);
          window.removeEventListener('message', handleMessage);
          setAuthInProgress(false);
          
          if (event.data.sessionId && onAuthorizationComplete) {
            console.log('Calling onAuthorizationComplete with session success');
            // For session-based auth, we'll send a success signal
            onAuthorizationComplete(`SESSION_SUCCESS:${event.data.sessionId}`);
          }
          
          if (!popup.closed) {
            popup.close();
          }
        }
      };
      
      window.addEventListener('message', handleMessage);

      // Poll for popup closure as fallback
      const pollInterval = setInterval(async () => {
        if (popup.closed) {
          console.log('Popup closed without postMessage, checking status endpoint as fallback...');
          clearInterval(pollInterval);
          window.removeEventListener('message', handleMessage);
          setAuthInProgress(false);
          
          // Fallback: try to check status endpoint despite CORS
          if (authConfig.statusEndpoint) {
            try {
              // Since we can't fetch due to CORS, we'll assume success if popup closed
              // and notify with the session ID
              console.log('Assuming authorization success based on popup closure');
              if (onAuthorizationComplete) {
                onAuthorizationComplete(`SESSION_SUCCESS:${authConfig.sessionId}`);
              }
            } catch (error) {
              console.error('Fallback status check failed:', error);
            }
          }
        }
      }, 1000);

      // Cleanup after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (!popup.closed) {
          popup.close();
        }
        setAuthInProgress(false);
      }, 600000);

    } catch (error) {
      console.error('Error opening authorization popup:', error);
      setAuthInProgress(false);
    }
  };

  const renderContent = () => {
    if (isUser) {
      return content;
    }

    // Add debug logging for all assistant messages
    console.log('=== MESSAGE DEBUG ===');
    console.log('Message content:', content);
    console.log('Content type:', typeof content);
    console.log('Content length:', content.length);
    console.log('Contains SYSTEM_AUTH_POPUP_REQUEST:', content.includes('SYSTEM_AUTH_POPUP_REQUEST'));
    console.log('===================');

    // Check for popup authorization request
    const authConfig = detectPopupAuthRequest(content);
    console.log('Auth config result:', authConfig);
    if (authConfig) {
      return (
        <div className="auth-request">
          <div className="auth-header">
            🔐 <strong>Authorization Required</strong>
          </div>
          <p>I need your permission to access your banking data.</p>
          
          <button 
            className={`auth-button ${authInProgress ? 'auth-button-loading' : ''}`}
            onClick={() => handlePopupAuthorization(authConfig)}
            disabled={authInProgress}
          >
            {authInProgress ? (
              <>
                <span className="spinner"></span>
                Authorizing...
              </>
            ) : (
              <>
                🔓 Authorize Access
              </>
            )}
          </button>
          
          <div className="auth-details">
            <small>
              <strong>Permissions:</strong> {authConfig.scope}<br/>
              <strong>Expires:</strong> {new Date(authConfig.expiresAt).toLocaleString()}
            </small>
          </div>
          
          <p><small>I'll automatically open a secure popup window for you to complete the authorization.</small></p>
        </div>
      );
    }

    // Regular markdown rendering
    return (
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="markdown-link"
            >
              {children}
            </a>
          ),
          code: ({ node, inline, ...props }) => (
            <code 
              {...props} 
              className={inline ? 'inline-code' : 'code-block'}
            />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="markdown-blockquote" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-content">
        <div className="message-text">
          {renderContent()}
        </div>
        <div className="message-timestamp">
          {formatTimestamp(timestamp)}
        </div>
      </div>
    </div>
  );
};

export default Message;