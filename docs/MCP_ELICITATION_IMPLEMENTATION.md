# MCP Client Elicitation Implementation Guide

## Overview

This document describes the MCP 2025-11-25 client elicitation implementation in AI-Demo. Elicitation allows MCP servers to request additional user input or authorization during tool execution using either **form mode** (structured data collection) or **URL mode** (out-of-band flows).

## Current Implementation Status

### ✅ Completed

1. **Type Definitions** (`demo_mcp_server/src/types/mcp.ts`)
   - `InputRequiredFormResult` — Form mode elicitation request
   - `InputRequiredUrlResult` — URL mode elicitation request

2. **WebSocket Client Enhancement** (`demo_api_server/services/mcpWebSocketClient.js`)
   - Detects server-initiated `elicitation/create` requests
   - Emits elicitation events to the teaching surface (SSE)
   - Handles `elicitation/response` submissions from browser
   - Maps error code `-32042` (URLElicitationRequiredError)
   - Keeps WebSocket open during elicitation flow (previously closed after tool response)

3. **BFF Endpoint** (`demo_api_server/server.js`)
   - `POST /api/mcp/elicit/response` — Receives user responses
   - Validates action (accept, decline, cancel)
   - Resolves pending elicitation promise in WebSocket client

4. **React Components**
   - `ElicitationDialog.jsx` — Modal for form and URL modes
   - `ElicitationDialog.css` — Styling with dark mode support
   - Renders form fields dynamically based on JSON Schema
   - Shows URL with domain verification before opening

5. **Hook** (`hooks/useElicitation.js`)
   - `useElicitation()` — State management for elicitation flow
   - Handles SSE event subscription
   - Submits responses to BFF
   - Auto-timeout after 5 minutes of inactivity

## Integration into BankingAgent

### Step 1 — Import Components and Hook

In `demo_api_ui/src/components/AIAgent.js`, add these imports:

```javascript
import ElicitationDialog from './ElicitationDialog';
import useElicitation from '../hooks/useElicitation';
```

### Step 2 — Add Hook to Component

In the main `BankingAgent` function component, add:

```javascript
const { 
  elicitation, 
  isSubmitting, 
  handleElicitationRequest, 
  submitElicitation, 
  cancel: cancelElicitation 
} = useElicitation();
```

### Step 3 — Listen to Elicitation Events from SSE

Find where the component listens to SSE events (likely in a `useEffect` hook that subscribes to `flowTraceId` events). Add this handler to the existing SSE listener:

```javascript
useEffect(() => {
  // Existing SSE setup code...
  
  if (flowTraceId) {
    const eventSource = new EventSource(`/api/mcp/tool/events?trace=${flowTraceId}`);
    
    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle elicitation events
        if (data.phase === 'elicitation_requested') {
          handleElicitationRequest({
            elicitationId: data.elicitationId,
            mode: data.mode,
            message: data.message,
            requestedSchema: data.requestedSchema,
            url: data.url,
          });
        }
        
        // ... existing event handlers ...
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });
    
    return () => eventSource.close();
  }
}, [flowTraceId, handleElicitationRequest]);
```

### Step 4 — Render the Dialog

In the JSX return, add the ElicitationDialog component near other modals:

```jsx
{/* Existing modals... */}

{/* MCP Elicitation Dialog */}
{elicitation && (
  <ElicitationDialog
    elicitation={elicitation}
    onSubmit={submitElicitation}
    onCancel={cancelElicitation}
  />
)}

{/* Existing modals... */}
```

## Protocol Wire Formats

### Form Mode Flow

1. **Server sends request** (over WebSocket, during `tools/call`):
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "email": { "type": "string", "format": "email" },
        "phone": { "type": "string" }
      },
      "required": ["email"]
    }
  }
}
```

2. **BFF detects request**, emits SSE event:
```json
{
  "phase": "elicitation_requested",
  "elicitationId": 5,
  "mode": "form",
  "message": "...",
  "requestedSchema": {...}
}
```

3. **Browser shows form**, user submits

4. **Browser POSTs to BFF**:
```json
POST /api/mcp/elicit/response
{
  "elicitationId": 5,
  "action": "accept",
  "content": {
    "email": "user@example.com",
    "phone": "+1-555-0100"
  }
}
```

5. **BFF sends response back to server**:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "action": "accept",
    "content": {...}
  }
}
```

6. **Server sends tool result** (original `tools/call` completes):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "Transfer completed" }]
  }
}
```

### URL Mode Flow

Similar to form mode, but user consents to open external URL:

1. Server sends `elicitation/create` with `mode: "url"` and `url: "..."` and `elicitationId: "..."`
2. Browser shows URL with domain verification
3. User clicks "Open in Browser"
4. Browser submits `action: "accept"` to `/api/mcp/elicit/response`
5. Browser opens URL in new window (`window.open(url, '_blank')`)
6. Server optionally sends `notifications/elicitation/complete` when flow finishes
7. Server sends tool result

## Error Handling

The implementation handles:

- **-32042 (URLElicitationRequiredError)** — Server needs URL mode but client only declared form
- **Timeout** — Auto-cancel after 5 minutes of inactivity
- **Network errors** — User can retry submission
- **Validation errors** — Form mode validation prevents invalid submissions

## Security Considerations

1. **Form Mode**
   - JSON Schema validation prevents data type mismatches
   - Passwords/API keys/payment info MUST NOT use form mode
   - Data is scoped to the session and tool execution context

2. **URL Mode**
   - URL domain is displayed prominently before opening
   - URL opens in a new window (separate browser context)
   - Timestamp validation ensures responses are fresh
   - Elicitation ID binding prevents cross-request attacks

3. **Session Binding**
   - All elicitation requests are tied to the current session
   - Session token authentication is required for all endpoints
   - Responses are rejected if session is invalid

## Testing

### Manual Testing

1. Deploy a tool that returns `InputRequiredFormResult` or `InputRequiredUrlResult`
2. Call the tool via the agent UI
3. Form should appear inline in the dialog
4. Submit form, tool should resume with the data

### Unit Tests

Add tests in `demo_api_ui/src/components/__tests__/ElicitationDialog.test.js`:

```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import ElicitationDialog from '../ElicitationDialog';

describe('ElicitationDialog', () => {
  it('renders form fields for form mode', () => {
    const elicitation = {
      mode: 'form',
      message: 'Please enter your name',
      requestedSchema: {
        properties: {
          name: { type: 'string', description: 'Your name' }
        },
        required: ['name']
      }
    };

    render(
      <ElicitationDialog
        elicitation={elicitation}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText(/Additional Information Needed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/i)).toBeInTheDocument();
  });

  it('validates required fields on submit', () => {
    const onSubmit = jest.fn();
    // ... test validation
  });

  it('renders URL display for URL mode', () => {
    const elicitation = {
      mode: 'url',
      message: 'Authorize access',
      url: 'https://oauth.example.com/consent'
    };

    render(
      <ElicitationDialog
        elicitation={elicitation}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText(/https:\/\/oauth\.example\.com\/consent/)).toBeInTheDocument();
  });
});
```

## Files Modified/Created

| File | Status | Changes |
|------|--------|---------|
| `demo_mcp_server/src/types/mcp.ts` | Created | InputRequiredFormResult, InputRequiredUrlResult types |
| `demo_api_server/services/mcpWebSocketClient.js` | Modified | Elicitation detection, event emission, response handling |
| `demo_api_server/server.js` | Modified | POST /api/mcp/elicit/response endpoint |
| `demo_api_ui/src/components/ElicitationDialog.jsx` | Created | Form and URL dialog UI |
| `demo_api_ui/src/components/ElicitationDialog.css` | Created | Styling for dialogs |
| `demo_api_ui/src/hooks/useElicitation.js` | Created | Hook for state management |

## Next Steps

1. **Integration**: Follow "Integration into BankingAgent" section above
2. **Testing**: Write unit and integration tests
3. **MCP Server Example**: Create a sample tool that uses elicitation
4. **Documentation**: Add elicitation to the Elicitation Learning Panel

## References

- [MCP Specification — Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Elicitation Learning Panel](/demo_api_ui/src/components/education/ElicitationPanel.js)
- [MCP Elicitation Skill](/~/.claude/skills/mcp-elicitation/SKILL.md)
