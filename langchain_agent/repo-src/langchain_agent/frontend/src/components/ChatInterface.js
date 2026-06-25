import React, { useState, useEffect, useRef, useCallback } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import AuthorizationModal from './AuthorizationModal';
import { useWebSocket } from '../hooks/useWebSocket';
import './ChatInterface.css';

const QUICK_COMMANDS = [
  { label: '🏦 My Accounts',        text: 'Show my accounts' },
  { label: '📋 Transactions',        text: 'Show my recent transactions' },
  { label: '💰 Balance',             text: 'What is my current balance?' },
  { label: '↔ Transfer',            text: 'I want to transfer money between accounts' },
  { label: '⬇ Deposit',             text: 'I want to make a deposit' },
  { label: '⬆ Withdraw',            text: 'I want to make a withdrawal' },
  { label: '🔐 Explain CIBA',        text: 'What is CIBA and how does it work?' },
  { label: '🔄 Token Exchange',      text: 'Explain RFC 8693 token exchange' },
  { label: '🤖 MCP Protocol',        text: 'How does the MCP protocol work with OAuth?' },
];

const ChatInterface = ({ apiUrl, onDashboardRefresh }) => {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [authModal, setAuthModal] = useState({
    isOpen: false,
    authorizationUrl: null,
    requestId: null
  });
  const messagesEndRef = useRef(null);
  /** Tracks WebSocket stream session so late events from another session are ignored. */
  const sessionIdRef = useRef(null);
  const { 
    connectionState, 
    isConnected, 
    lastMessage, 
    error, 
    sendMessage, 
    reconnect
  } = useWebSocket(apiUrl);

  const scrollToBottom = () => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Helper function to detect banking operations and trigger dashboard refresh
  const detectAndRefreshDashboard = useCallback((messageContent) => {
    if (!onDashboardRefresh) return;

    try {
      // Check for transfer success messages
      if (messageContent.includes('Transfer Successful') || messageContent.includes('✅ **Transfer Successful**')) {
        // Extract transfer details from formatted message
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const fromAccountMatch = messageContent.match(/From Account:\s*([a-f0-9-]+)/i);
        const toAccountMatch = messageContent.match(/To Account:\s*([a-f0-9-]+)/i);
        const withdrawalIdMatch = messageContent.match(/Withdrawal ID:\s*([a-f0-9-]+)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'transfer',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          fromAccountId: fromAccountMatch ? fromAccountMatch[1] : null,
          toAccountId: toAccountMatch ? toAccountMatch[1] : null,
          transactionId: withdrawalIdMatch ? withdrawalIdMatch[1] : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for deposit success messages
      if (messageContent.includes('Deposit Successful') || messageContent.includes('✅ **Deposit Successful**')) {
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const accountMatch = messageContent.match(/Account:\s*([a-f0-9-]+)/i);
        const transactionIdMatch = messageContent.match(/Transaction ID:\s*([a-f0-9-]+)/i);
        const newBalanceMatch = messageContent.match(/New Balance:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'deposit',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          accountId: accountMatch ? accountMatch[1] : null,
          transactionId: transactionIdMatch ? transactionIdMatch[1] : null,
          newBalance: newBalanceMatch ? parseFloat(newBalanceMatch[1].replace(/,/g, '')) : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for withdrawal success messages
      if (messageContent.includes('Withdrawal Successful') || messageContent.includes('✅ **Withdrawal Successful**')) {
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const accountMatch = messageContent.match(/Account:\s*([a-f0-9-]+)/i);
        const transactionIdMatch = messageContent.match(/Transaction ID:\s*([a-f0-9-]+)/i);
        const newBalanceMatch = messageContent.match(/New Balance:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'withdrawal',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          accountId: accountMatch ? accountMatch[1] : null,
          transactionId: transactionIdMatch ? transactionIdMatch[1] : null,
          newBalance: newBalanceMatch ? parseFloat(newBalanceMatch[1].replace(/,/g, '')) : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for account balance information
      if (messageContent.includes('Your Bank Accounts') || messageContent.includes('💰 **Your Bank Accounts**')) {
        onDashboardRefresh('accounts_updated', {
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for account registration completion
      if (messageContent.includes('account registration is now complete') || messageContent.includes('registration completed')) {
        onDashboardRefresh('account_registered', {
          timestamp: new Date().toISOString()
        });
        return;
      }

    } catch (error) {
      console.error('Error detecting banking operations for dashboard refresh:', error);
    }
  }, [onDashboardRefresh]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      if (lastMessage.type === 'stream_event') {
        const sid = lastMessage.session_id;
        if (sid) {
          if (!sessionIdRef.current) sessionIdRef.current = sid;
          else if (sid !== sessionIdRef.current) return;
        }
        const { event, tool, token, output_preview: preview, error: toolErr } = lastMessage;

        if (event === 'tool_start' && tool) {
          setMessages((prev) => [
            ...prev,
            {
              id: `tool-${Date.now()}-${tool}`,
              content: `🔧 **${tool}** …`,
              role: 'assistant',
              timestamp: new Date().toISOString(),
              metadata: { streaming: true, kind: 'tool_status', tool },
            },
          ]);
        } else if (event === 'tool_end') {
          setMessages((prev) => {
            const i = [...prev].reverse().findIndex(
              (m) => m.metadata?.kind === 'tool_status' && m.metadata?.streaming
            );
            if (i === -1) return prev;
            const realIdx = prev.length - 1 - i;
            const row = prev[realIdx];
            const suffix = preview ? `\n${preview}` : ' ✓';
            const next = [...prev];
            next[realIdx] = {
              ...row,
              content: `${row.content.replace(/\s*…\s*$/, '')}${suffix}`,
              metadata: { ...row.metadata, streaming: false },
            };
            return next;
          });
        } else if (event === 'tool_error' && toolErr) {
          setMessages((prev) => [
            ...prev,
            {
              id: `tool-err-${Date.now()}`,
              content: `⚠️ Tool error: ${toolErr}`,
              role: 'assistant',
              timestamp: new Date().toISOString(),
              metadata: { error: true, kind: 'tool_error' },
            },
          ]);
        } else if (event === 'llm_token' && token) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.metadata?.kind === 'llm_stream' && last?.metadata?.streaming) {
              const copy = [...prev];
              copy[copy.length - 1] = {
                ...last,
                content: last.content + token,
              };
              return copy;
            }
            return [
              ...prev,
              {
                id: `llm-stream-${Date.now()}`,
                content: token,
                role: 'assistant',
                timestamp: new Date().toISOString(),
                metadata: { streaming: true, kind: 'llm_stream' },
              },
            ];
          });
        }
      } else if (lastMessage.type === 'chat_response') {
        const finalContent = lastMessage.content;
        const agentMessage = {
          id: Date.now().toString(),
          content: finalContent,
          role: 'assistant',
          timestamp: lastMessage.timestamp || new Date().toISOString(),
          metadata: { ...(lastMessage.metadata || {}), streaming: false, kind: 'final' },
        };
        setMessages((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            if (prev[i].metadata?.kind === 'llm_stream') {
              idx = i;
              break;
            }
          }
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              content: finalContent,
              metadata: { ...agentMessage.metadata },
            };
            return next;
          }
          return [...prev, agentMessage];
        });
        setIsLoading(false);

        detectAndRefreshDashboard(finalContent);
      } else if (lastMessage.type === 'authorization_required') {
        // Handle authorization request
        setAuthModal({
          isOpen: true,
          authorizationUrl: lastMessage.data.authorization_url,
          requestId: lastMessage.data.request_id
        });
        setIsLoading(false);
      } else if (lastMessage.type === 'error') {
        console.error('WebSocket error:', lastMessage);
        setIsLoading(false);
        // Add error message to chat
        const errorMessage = {
          id: Date.now().toString(),
          content: `Error: ${lastMessage.error_message || 'An error occurred'}`,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          metadata: { error: true }
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    }
  }, [lastMessage, detectAndRefreshDashboard]);

  const handleQuickCommand = (text) => {
    setShowCommands(false);
    handleSendMessage(text);
  };

  const handleSendMessage = async (messageContent) => {
    if (!messageContent.trim() || !isConnected) return;

    const userMessage = {
      id: Date.now().toString(),
      content: messageContent,
      role: 'user',
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Send message via WebSocket
    const success = sendMessage(messageContent);
    
    if (!success) {
      setIsLoading(false);
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        content: 'Failed to send message. Please check your connection.',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: { error: true }
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const handleAuthorizationComplete = (authorizationCode) => {
    console.log('=== AUTHORIZATION COMPLETE ===');
    console.log('Authorization code received:', authorizationCode);
    console.log('Is connected:', isConnected);
    
    // Send authorization code back to the server as a regular message
    if (authorizationCode && isConnected) {
      console.log('Sending authorization code to backend...');
      
      // Add a message to the chat indicating authorization was completed
      const authCompleteMessage = {
        id: Date.now().toString(),
        content: 'Authorization completed successfully. Processing your request...',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: { system: true }
      };
      setMessages(prev => [...prev, authCompleteMessage]);
      
      // Send the authorization code as a regular message
      // The backend will detect it and process it automatically
      setIsLoading(true);
      const success = sendMessage(authorizationCode);
      console.log('Message send result:', success);
    } else {
      console.log('Cannot send authorization code - missing code or not connected');
    }
    console.log('=== END AUTHORIZATION COMPLETE ===');
  };

  const handleAuthorizationError = (error) => {
    console.error('Authorization error:', error);
    
    // Add error message to chat
    const errorMessage = {
      id: Date.now().toString(),
      content: `Authorization failed: ${error.message}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      metadata: { error: true }
    };
    setMessages(prev => [...prev, errorMessage]);
    
    // Close the modal
    setAuthModal({
      isOpen: false,
      authorizationUrl: null,
      requestId: null
    });
  };

  const handleAuthorizationCancel = () => {
    // Add cancellation message to chat
    const cancelMessage = {
      id: Date.now().toString(),
      content: 'Authorization was cancelled. Some features may not be available.',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      metadata: { warning: true }
    };
    setMessages(prev => [...prev, cancelMessage]);
    
    // Close the modal
    setAuthModal({
      isOpen: false,
      authorizationUrl: null,
      requestId: null
    });
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
          <span className="status-text">
            {connectionState === 'connecting' ? 'Connecting...' : 
             connectionState === 'connected' ? 'Connected' : 
             'Disconnected'}
          </span>
          {error && (
            <span className="error-text">
              {error}
            </span>
          )}
          {!isConnected && connectionState !== 'connecting' && (
            <button className="reconnect-button" onClick={reconnect}>
              Reconnect
            </button>
          )}
        </div>
      </div>
      
      <div className="chat-messages">
        <MessageList 
          messages={messages} 
          isLoading={isLoading}
          onAuthorizationComplete={handleAuthorizationComplete}
        />
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-commands">
        <button
          className="commands-toggle"
          onClick={() => setShowCommands(s => !s)}
          aria-expanded={showCommands}
          title="Quick commands"
        >
          {showCommands ? '▼' : '▶'} Commands
        </button>
        {showCommands && (
          <div className="commands-grid">
            {QUICK_COMMANDS.map(cmd => (
              <button
                key={cmd.text}
                className="command-chip"
                onClick={() => handleQuickCommand(cmd.text)}
                disabled={!isConnected || isLoading}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="chat-input">
        <MessageInput
          onSendMessage={handleSendMessage}
          disabled={!isConnected || isLoading}
        />
      </div>

      <AuthorizationModal
        isOpen={authModal.isOpen}
        authorizationUrl={authModal.authorizationUrl}
        onClose={handleAuthorizationCancel}
        onAuthorizationComplete={handleAuthorizationComplete}
        onAuthorizationError={handleAuthorizationError}
      />
    </div>
  );
};

export default ChatInterface;