# LangChain MCP OAuth Agent - Setup Guide

This guide will walk you through setting up and running the LangChain MCP OAuth Agent from scratch.

## 📋 Prerequisites

### System Requirements
- **Python 3.11+** (recommended: 3.11 or 3.12)
- **Node.js 18+** (for frontend)
- **Git** (for cloning the repository)
- **Docker & Docker Compose** (optional, for containerized deployment)

### External Services
- **PingOne AI IAM Core (ForgeRock)** account
- **OpenAI API** key
- **MCP Servers** (optional, for testing with real MCP servers)

## 🚀 Quick Start (Development)

### 1. Clone and Setup Environment

```bash
# Clone the repository
git clone <repository-url>
cd langchain-mcp-oauth-agent

# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Generate Configuration

```bash
# Generate development configuration with encryption keys
python scripts/generate-config.py env --environment development --include-secrets --output .env

# Or copy the example and edit manually
cp .env.example .env
```

### 3. Configure Environment Variables

Edit the `.env` file with your actual values:

```bash
# Required: PingOne Configuration
PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize
PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback

# Required: OpenAI API Key
OPENAI_API_KEY=your-openai-api-key-here

# Security keys (generated automatically if using generate-config.py)
ENCRYPTION_MASTER_KEY=your-base64-encoded-master-key
ENCRYPTION_SALT=your-base64-encoded-salt
```

### 4. Start the Backend

```bash
# Activate virtual environment if not already active
source venv/bin/activate

# Start the application
python -m src.main

# Or run directly
python src/main.py
```

You should see output like:
```
🚀 LangChain MCP OAuth Agent is running!
📡 WebSocket endpoint: ws://localhost:8080
🔗 Frontend URL: http://localhost:3030 (if running)
📋 Health check: http://localhost:8081/health
Press Ctrl+C to stop
```

### 5. Start the Frontend (Optional)

```bash
# In a new terminal
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

The frontend will be available at `http://localhost:3000`.

## 🔧 Detailed Configuration

### Environment Variables Reference

#### Core Settings
```bash
ENVIRONMENT=development          # development, staging, production, test
DEBUG=true                      # Enable debug mode
LOG_LEVEL=INFO                  # DEBUG, INFO, WARNING, ERROR
```

#### PingOne Configuration
```bash
PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize
PINGONE_DEFAULT_SCOPE=openid profile
PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback
PINGONE_REALM=alpha
```

#### Security Settings
```bash
ENCRYPTION_MASTER_KEY=base64-encoded-32-byte-key
ENCRYPTION_SALT=base64-encoded-16-byte-salt
TOKEN_EXPIRY_BUFFER_SECONDS=300
SESSION_TIMEOUT_MINUTES=60
MAX_RETRY_ATTEMPTS=3
RETRY_BACKOFF_SECONDS=2
```

#### LangChain Configuration
```bash
LANGCHAIN_MODEL_NAME=gpt-3.5-turbo
LANGCHAIN_TEMPERATURE=0.7
LANGCHAIN_MAX_TOKENS=1000
LANGCHAIN_VERBOSE=false
LANGCHAIN_MAX_ITERATIONS=10
LANGCHAIN_MAX_EXECUTION_TIME=60
OPENAI_API_KEY=your-openai-api-key
```

#### Chat Interface
```bash
WEBSOCKET_PORT=8080
MAX_MESSAGE_LENGTH=4096
CONVERSATION_HISTORY_LIMIT=100
SESSION_CLEANUP_INTERVAL_MINUTES=15
```

#### MCP Server Configuration
```bash
MCP_CONNECTION_TIMEOUT_SECONDS=30
MCP_MAX_CONNECTIONS_PER_SERVER=5
MCP_RETRY_ATTEMPTS=3
MCP_HEARTBEAT_INTERVAL_SECONDS=30

# Example MCP servers
MCP_SERVER_GITHUB_ENDPOINT=ws://localhost:3001
MCP_SERVER_GITHUB_CAPABILITIES=read,write
MCP_SERVER_GITHUB_AUTH_REQUIRED=true
```

### Generating Secure Keys

```bash
# Generate encryption keys
python scripts/generate-config.py keys

# This will output:
# ENCRYPTION_MASTER_KEY=<base64-encoded-key>
# ENCRYPTION_SALT=<base64-encoded-salt>
```

## 🐳 Docker Deployment

### Development with Docker

```bash
# Build and start services
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production with Docker

```bash
# Setup production environment
./scripts/setup-prod.sh

# Edit .env with production values
nano .env

# Start production services
docker-compose -f docker-compose.prod.yml up -d
```

## 🧪 Testing the Setup

### 1. Health Check

```bash
# Check if the service is running
curl http://localhost:8080/health

# Expected response:
# {"status": "healthy", "timestamp": "2024-01-01T12:00:00Z"}
```

### 2. Configuration Validation

```bash
# Validate configuration
python scripts/generate-config.py validate --environment development
```

### 3. Run Tests

```bash
# Run all tests
python -m pytest

# Run specific test categories
python -m pytest tests/test_config_settings.py
python -m pytest tests/test_integration_auth_flows.py

# Run with coverage
python -m pytest --cov=src tests/
```

### 4. WebSocket Connection Test

```bash
# Install wscat for testing
npm install -g wscat

# Test WebSocket connection
wscat -c ws://localhost:8080

# Send test message
{"type": "session_init", "user_id": "test-user"}
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Configuration Errors
```bash
# Validate configuration
python -c "from src.config.settings import get_config; get_config()"

# Check for missing variables
python scripts/generate-config.py validate --environment development
```

#### 2. Import Errors
```bash
# Ensure virtual environment is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt

# Check Python path
python -c "import sys; print(sys.path)"
```

#### 3. Port Already in Use
```bash
# Find process using port 8080
lsof -i :8080

# Kill process if needed
kill -9 <PID>

# Or use different port
export WEBSOCKET_PORT=8081
```

#### 4. PingOne Connection Issues
```bash
# Test PingOne connectivity
curl -I https://your-tenant.forgeblocks.com

# Check DNS resolution
nslookup your-tenant.forgeblocks.com

# Verify SSL certificate
openssl s_client -connect your-tenant.forgeblocks.com:443
```

#### 5. OpenAI API Issues
```bash
# Test OpenAI API key
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/models

# Check API quota
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/usage
```

### Debug Mode

Enable debug mode for detailed logging:

```bash
export DEBUG=true
export LOG_LEVEL=DEBUG
python src/main.py
```

### Log Files

Check log files for errors:

```bash
# Application logs
tail -f logs/app.log

# Error logs
tail -f logs/error.log

# Authentication logs
tail -f logs/auth.log
```

## 🔧 Development Tools

### Code Formatting

```bash
# Format code
black src/ tests/

# Sort imports
isort src/ tests/

# Lint code
flake8 src/ tests/

# Type checking
mypy src/
```

### Database Management (if using persistent storage)

```bash
# Run migrations
alembic upgrade head

# Create new migration
alembic revision --autogenerate -m "description"
```

## 📚 Next Steps

1. **Configure MCP Servers**: Add your MCP server endpoints to the configuration
2. **Customize Frontend**: Modify the React frontend to match your needs
3. **Add Authentication**: Configure PingOne with your actual tenant
4. **Deploy to Production**: Use the production deployment guide
5. **Monitor and Scale**: Set up monitoring and scaling as needed

## 🆘 Getting Help

- **Documentation**: Check the `docs/` directory for detailed guides
- **Issues**: Open an issue on GitHub with:
  - Environment details
  - Configuration (with secrets redacted)
  - Error logs
  - Steps to reproduce
- **Logs**: Always include relevant log files when asking for help

## 📋 Checklist

Before running in production:

- [ ] All environment variables configured
- [ ] Encryption keys generated and secured
- [ ] PingOne tenant configured
- [ ] OpenAI API key valid and has quota
- [ ] SSL certificates configured (for production)
- [ ] Firewall rules configured
- [ ] Monitoring and logging set up
- [ ] Backup strategy implemented
- [ ] Health checks configured
- [ ] Load balancing configured (if needed)

---

**🎉 You're ready to go! The LangChain MCP OAuth Agent should now be running and ready to handle chat sessions with MCP server integrations.**