# 🎨 Starting the Frontend

## Quick Start

### Option 1: Using the script
```bash
./start-frontend.sh
```

### Option 2: Manual start
```bash
cd frontend
npm start
```

## What to Expect

The frontend will start on **http://localhost:3000** and you should see:

1. **Chat Interface**: A clean chat interface with message input
2. **Connection Status**: Shows "Connected" when connected to the backend
3. **Real-time Chat**: You can send messages and get responses from the AI agent

## Backend Requirements

Make sure the backend is running first:
```bash
python run.py
```

The backend should show:
```
🚀 LangChain MCP OAuth Agent is running!
📡 WebSocket endpoint: ws://localhost:8080
📋 Health check: http://localhost:8081/health
```

## Testing the Full Stack

1. **Start Backend**: `python run.py`
2. **Start Frontend**: `./start-frontend.sh` or `cd frontend && npm start`
3. **Open Browser**: Go to http://localhost:3000
4. **Send Message**: Type a message and press Enter
5. **Get Response**: The AI agent should respond

## Troubleshooting

### Frontend won't start
- Make sure Node.js 18+ is installed
- Run `cd frontend && npm install` to install dependencies

### Can't connect to backend
- Verify backend is running on port 8080
- Check browser console for WebSocket errors
- Ensure no firewall is blocking the connection

### No responses from AI
- Check that OpenAI API key is configured in `.env`
- Look at backend logs for errors
- Verify the agent is initialized properly

## Features

- ✅ Real-time WebSocket communication
- ✅ Session management
- ✅ Message history
- ✅ Connection status indicator
- ✅ Error handling
- ✅ Authorization flow support (for MCP servers)
- ✅ Responsive design

Enjoy chatting with your AI agent! 🤖