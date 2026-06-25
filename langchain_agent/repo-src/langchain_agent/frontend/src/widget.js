/* global define */
import React from 'react';
import { createRoot } from 'react-dom/client';
import EmbeddableChatWidget from './components/EmbeddableChatWidget';

// Global widget initialization function
function initBankingChatWidget(config = {}) {
  const {
    containerId = 'banking-chat-widget',
    apiUrl = 'ws://localhost:8082/ws',
    position = 'bottom-right',
    theme = 'light',
    title = 'AI Banking Assistant',
    autoOpen = false,
    showFAB = true,
    fabTheme = 'light',
    onOpen,
    onClose,
    onMessage,
    onDashboardRefresh,
    customStyles = {},
    className = ''
  } = config;

  // Create container if it doesn't exist
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }

  // Create React root and render widget
  const root = createRoot(container);
  root.render(
    <EmbeddableChatWidget
      apiUrl={apiUrl}
      position={position}
      theme={theme}
      title={title}
      autoOpen={autoOpen}
      showFAB={showFAB}
      fabTheme={fabTheme}
      onOpen={onOpen}
      onClose={onClose}
      onMessage={onMessage}
      onDashboardRefresh={onDashboardRefresh}
      customStyles={customStyles}
      className={className}
    />
  );

  // Return control object
  return {
    open: () => root.render(
      <EmbeddableChatWidget
        {...config}
        autoOpen={true}
      />
    ),
    close: () => root.render(
      <EmbeddableChatWidget
        {...config}
        autoOpen={false}
      />
    ),
    destroy: () => {
      root.unmount();
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }
  };
};

// Auto-initialize if config is provided via data attributes
document.addEventListener('DOMContentLoaded', function() {
  const scriptTag = document.querySelector('script[data-banking-chat-widget]');
  if (scriptTag) {
    const config = {};
    
    // Parse data attributes
    const attrs = scriptTag.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.name.startsWith('data-')) {
        const key = attr.name.replace('data-', '').replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        config[key] = attr.value === 'true' ? true : attr.value === 'false' ? false : attr.value;
      }
    }
    
    initBankingChatWidget(config);
  }
});

// Export for different module systems
if (typeof window !== 'undefined') {
  window.initBankingChatWidget = initBankingChatWidget;
}

// For UMD builds
if (typeof module !== 'undefined' && module.exports) {
  module.exports = initBankingChatWidget;
}

// For AMD
if (typeof define === 'function' && define.amd) {
  define([], function() {
    return initBankingChatWidget;
  });
}