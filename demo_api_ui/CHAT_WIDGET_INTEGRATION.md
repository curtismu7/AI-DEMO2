# Chat Widget Integration

This document explains how the banking chat widget has been integrated into the user dashboard.

## Files Modified

1. **src/hooks/useChatWidget.js** - Custom React hook for accessing the globally initialized chat widget
2. **src/components/UserDashboard.js** - Updated to include chat widget integration
3. **src/components/UserDashboard.css** - Added styles for the chat button
4. **public/index.html** - Added script tag and initialization code for the chat widget

## How It Works

### Global Widget Initialization (`public/index.html`)
- Widget is initialized once when the page loads with full configuration
- Includes WebSocket URL for backend connection: `ws://localhost:8082/ws`
- Widget instance is stored globally as `window.bankingWidget`
- Configuration includes:
  - Position: bottom-right
  - Theme: light
  - Title: "AI Banking Assistant"
  - Auto-open: false (manual control)

### Chat Widget Hook (`useChatWidget.js`)
- Connects to the globally initialized widget instance
- Provides methods to control the widget (open, close, destroy)
- Tracks initialization state for UI feedback
- Includes error handling and fallback logic

### User Dashboard Integration
- Chat button appears in the dashboard header
- Button is disabled until the widget is fully initialized
- Clicking the button opens the chat widget

## Setup Instructions

1. **Update the Script URL**: Replace the placeholder URL in `public/index.html` with the actual chat widget script URL:
   ```html
   <script src="/banking-chat-widget.js"></script>
   ```

2. **Configure Backend URL**: Update the WebSocket URL in the initialization script:
   ```javascript
   const widget = window.initBankingChatWidget({
     apiUrl: 'ws://your-backend-url:8082/ws',  // Update this URL
     // ... other config
   });
   ```

3. **Customize Configuration**: Modify the widget configuration in `public/index.html`:
   ```javascript
   const widget = window.initBankingChatWidget({
     apiUrl: 'ws://localhost:8082/ws',
     position: 'bottom-right',    // 'bottom-left', 'top-right', 'top-left'
     theme: 'light',              // 'light', 'dark'
     title: 'AI Banking Assistant',
     autoOpen: false,             // true to open automatically
     onOpen: () => console.log('Banking chat opened'),
     onClose: () => console.log('Banking chat closed')
   });
   ```

## Widget Control Methods

The hook provides these methods:
- `chatWidget.open()` - Opens the chat widget
- `chatWidget.close()` - Closes the chat widget  
- `chatWidget.destroy()` - Destroys the widget instance
- `chatWidget.isInitialized()` - Returns true if widget is ready

## Styling

The chat button styling can be customized in `UserDashboard.css`:
- `.chat-button` - Main button styles
- `.chat-button:hover` - Hover effects
- `.chat-button:disabled` - Disabled state

## Error Handling

The integration includes:
- Automatic retry logic if the widget script loads slowly
- Graceful degradation if the widget fails to initialize
- Console logging for debugging
- Button disabled state when widget isn't ready

## Testing

To test the integration:
1. Ensure the chat widget script is loaded correctly
2. Check browser console for any initialization errors
3. Verify the chat button appears in the dashboard header
4. Test opening/closing the chat widget
5. Confirm the widget is properly cleaned up when navigating away