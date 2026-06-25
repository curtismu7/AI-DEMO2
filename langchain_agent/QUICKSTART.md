# 🚀 Quick Start Guide

Get the LangChain MCP OAuth Agent running in 5 minutes!

## 📋 Prerequisites

- **Python 3.11+**
- **PingOne AI IAM Core** account
- **OpenAI API** key

## ⚡ Quick Setup

### 1. Clone and Setup

```bash
git clone <repository-url>
cd langchain-mcp-oauth-agent
./scripts/setup-dev.sh
```

This script will:
- Create Python virtual environment
- Install all dependencies
- Generate configuration with encryption keys
- Set up directories
- Run basic tests

### 2. Configure Secrets

Edit the generated `.env` file:

```bash
nano .env
```

**Required changes:**
```bash
# Replace with your PingOne tenant
PINGONE_BASE_URL=https://YOUR-TENANT.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://YOUR-TENANT.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://YOUR-TENANT.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://YOUR-TENANT.forgeblocks.com/am/oauth2/realms/alpha/authorize

# Add your OpenAI API key
OPENAI_API_KEY=sk-your-openai-api-key-here
```

### 3. Run the Application

```bash
# Activate virtual environment
source venv/bin/activate

# Start the application
python src/main.py
```

You should see:
```
🚀 LangChain MCP OAuth Agent is running!
📡 WebSocket endpoint: ws://localhost:8080
📋 Health check: http://localhost:8081/health
```

### 4. Test the Setup

```bash
# Test health check
curl http://localhost:8081/health

# Expected response:
# {"status": "healthy", "timestamp": "2024-01-01T12:00:00Z", "version": "1.0.0"}
```

### 5. Start the Frontend (Optional)

For a better chat experience, start the React frontend:

```bash
# Option 1: Using the script
./start-frontend.sh

# Option 2: Manual start
cd frontend
npm start
```

The frontend will be available at **http://localhost:3000** with:
- Clean chat interface
- Real-time messaging
- Connection status indicator
- Session management

**Prerequisites for frontend:**
- Node.js 18+
- Backend running on port 8080

## 🐳 Docker Quick Start

```bash
# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Start with Docker
docker-compose up --build

# Or run in background
docker-compose up -d

# Check logs
docker-compose logs -f
```

## 🧪 Testing with WebSocket

Install wscat for testing:
```bash
npm install -g wscat
```

Test WebSocket connection:
```bash
# Connect to WebSocket
wscat -c ws://localhost:8080

# Send session initialization
{"type": "session_init", "user_id": "test-user"}

# Send a chat message (use the session_id from the response)
{"type": "chat_message", "content": "Hello!", "session_id": "your-session-id"}
```

## 🔧 Configuration Options

### Minimal Configuration (.env)
```bash
ENVIRONMENT=development
PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize
PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback
OPENAI_API_KEY=your-openai-api-key
ENCRYPTION_MASTER_KEY=generated-by-setup-script
ENCRYPTION_SALT=generated-by-setup-script
```

### Adding MCP Servers
```bash
# Example: GitHub MCP Server
MCP_SERVER_GITHUB_ENDPOINT=ws://localhost:3001
MCP_SERVER_GITHUB_CAPABILITIES=read,write
MCP_SERVER_GITHUB_AUTH_REQUIRED=true

# Example: Slack MCP Server  
MCP_SERVER_SLACK_ENDPOINT=ws://localhost:3002
MCP_SERVER_SLACK_CAPABILITIES=read,write,execute
MCP_SERVER_SLACK_AUTH_REQUIRED=true
```

## 🎯 What Happens When You Run It

1. **OAuth Manager** registers with PingOne and gets agent credentials
2. **MCP Manager** connects to configured MCP servers
3. **LangChain Agent** initializes with available tools from MCP servers
4. **WebSocket Server** starts on port 8080 for chat interface
5. **Health Check** server provides monitoring endpoints

## 🔍 Monitoring

- **Health Check**: `http://localhost:8080/health`
- **Detailed Status**: `http://localhost:8080/status`
- **Logs**: Check `logs/app.log` for application logs

## 🐛 Common Issues

### "Configuration validation failed"
- Check that all required environment variables are set
- Verify PingOne URLs are correct
- Ensure OpenAI API key is valid

### "Failed to register OAuth client"
- Verify PingOne tenant URL is accessible
- Check network connectivity
- Ensure PingOne realm is configured correctly

### "Port already in use"
```bash
# Find process using port 8080
lsof -i :8080

# Kill the process or use different port
export WEBSOCKET_PORT=8081
```

### "Import errors"
```bash
# Ensure virtual environment is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

## 🎉 Success!

If everything is working, you should be able to:

1. ✅ Get a healthy response from `/health`
2. ✅ Connect to the WebSocket endpoint
3. ✅ Send chat messages and receive responses
4. ✅ See OAuth authentication working in logs
5. ✅ See MCP server connections established

## 📚 Next Steps

- **Add MCP Servers**: Configure your MCP server endpoints
- **Frontend Details**: See `START_FRONTEND.md` for detailed frontend setup and troubleshooting
- **Production**: Use the production deployment guide
- **Customization**: Modify the agent behavior and tools

## 🆘 Need Help?

- **Full Setup Guide**: See `SETUP.md` for detailed instructions
- **Deployment Guide**: See `docs/DEPLOYMENT.md` for production setup
- **Troubleshooting**: Check logs in `logs/` directory
- **Configuration**: Use `python scripts/generate-config.py validate` to check config

---

**🎊 You're ready to chat with your AI agent that can interact with MCP servers!**