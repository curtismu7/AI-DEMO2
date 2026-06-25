import React from 'react';
import Message from './Message';
import LoadingIndicator from './LoadingIndicator';
import './MessageList.css';

const MessageList = ({ messages, isLoading, onAuthorizationComplete }) => {
  return (
    <div className="message-list">
      {messages.length === 0 && (
        <div className="welcome-message">
          <h3>Welcome to Banking Digital Assistant</h3>
          <p>Start a conversation by typing a message below. The agent can help you with various tasks using MCP servers.</p>
        </div>
      )}
      
      {messages.map((message) => (
        <Message 
          key={message.id} 
          message={message} 
          onAuthorizationComplete={onAuthorizationComplete}
        />
      ))}
      
      {isLoading && <LoadingIndicator />}
    </div>
  );
};

export default MessageList;