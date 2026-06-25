# LangChain MCP OAuth Agent

A sophisticated AI agent system that integrates LangChain with MCP (Model Context Protocol) servers through secure OAuth authentication flows using PingOne AI IAM Core.

## 🚀 Features

- **Dual Authentication**: Agent-level (client credentials) and user-level (authorization code) OAuth flows
- **MCP Integration**: Seamless integration with Model Context Protocol servers
- **LangChain Powered**: Advanced AI reasoning and tool execution
- **Real-time Chat**: WebSocket-based browser interface
- **Secure Token Management**: Encrypted storage and automatic token refresh
- **Multi-Environment**: Development, staging, production, and test configurations
- **Docker Ready**: Containerized deployment with Docker Compose
- **Comprehensive Logging**: Security-aware structured logging
- **Graceful Error Handling**: Robust error handling and recovery

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Browser  │◄──►│  LangChain Agent │◄──►│   MCP Servers   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ OAuth Provider   │    │ External APIs   │
                       │ (PingOne)        │    │ & Resources     │
                       └──────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for frontend)
- **Docker & Docker Compose** (for containerized deployment)
- **PingOne AI IAM Core** account
- **OpenAI API** key

## 🚀 Quick Start

### Development Setup

1. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd langchain-mcp-oauth-agent
   ./scripts/setup-dev.sh
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your PingOne and OpenAI configuration
   ```

3. **Start services**:
   ```bash
   # Backend
   source venv/bin/activate  # Activate virtual environment
   python -m src.main
   
   # Frontend (in another terminal)
   cd frontend && npm start
   ```
   Note: Frontend will be accessible at http://localhost:3030

   # (optional) Trace Server UI (in another terminal)
   ```bash
   source venv/bin/activate # Activate virtual environment
   cd <project-root>/trace-server
   python ./start_trace_server.py
   ```
   Note: Trace Server UI will be accessible at [http://localhost:8090](http://localhost:8090)

4. **Test the agent**:
   ```bash

### Production Deployment

1. **Setup production environment**:
   ```bash
   ./scripts/setup-prod.sh
   ```

2. **Configure production settings**:
   ```bash
   # Edit .env with production values
   nano .env
   ```

3. **Deploy with Docker**:
   ```bash
   docker-compose up -d
   ```

### Chat Widget

1. Build the widget:
   ```bash
   cd frontend
   npm run build:widget
   ```

## 🔧 Configuration

### Environment Variables

The system supports multiple configuration sources with this priority:
1. Environment variables
2. Configuration files (JSON)
3. Environment-specific defaults
4. Global defaults

#### Required Variables

```bash
# PingOne Configuration
PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize
PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback

# Security
ENCRYPTION_MASTER_KEY=your-base64-encoded-master-key-here
ENCRYPTION_SALT=your-base64-encoded-salt-here

# API Keys
OPENAI_API_KEY=your-openai-api-key-here
```

#### MCP Server Configuration

```bash
# Example MCP server
MCP_SERVER_EXAMPLE_ENDPOINT=ws://localhost:3001
MCP_SERVER_EXAMPLE_CAPABILITIES=read,write,execute
MCP_SERVER_EXAMPLE_AUTH_REQUIRED=true
```

### Environment-Specific Settings

#### Development
- Debug mode enabled
- Verbose logging
- Local URLs allowed
- Shorter timeouts

#### Production
- Security-focused validation
- Minimal logging (WARNING+)
- HTTPS required
- Strong encryption keys required

#### Staging
- Production-like settings
- Extended retry logic
- HTTPS required

#### Test
- Fast timeouts
- Clean output
- Isolated settings

## 🔐 Authentication Flow

### Agent Authentication (Automatic)

1. Dynamic client registration with PingOne
2. Client credentials flow for agent token
3. Automatic token refresh

### User Authorization (On-Demand)

1. MCP server requests user authorization
2. Agent generates authorization URL
3. User completes OAuth flow
4. Authorization code passed to MCP server
5. MCP server exchanges code for user token

## 🛠️ Development

### Project Structure

```
├── src/
│   ├── agent/              # LangChain agent core
│   ├── api/                # WebSocket and session management
│   ├── authentication/     # OAuth flows and token management
│   ├── config/             # Configuration management
│   ├── errors/             # Error handling
│   ├── logging/            # Structured logging
│   ├── mcp/                # MCP server integration
│   ├── models/             # Data models
│   ├── security/           # Encryption utilities
│   ├── services/           # Service interfaces
│   └── storage/            # Token storage and caching
├── frontend/               # React-based chat interface
├── tests/                  # Unit and integration tests
├── docs/                   # Documentation
└── scripts/                # Setup and deployment scripts
```

### Running Tests

```bash
# All tests
python -m pytest

# Specific test file
python -m pytest tests/test_config_settings.py

# With coverage
python -m pytest --cov=src tests/
```

### Code Quality

```bash
# Format code
black src/ tests/

# Lint code
flake8 src/ tests/

# Type checking
mypy src/
```

## 📚 Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) - Comprehensive deployment instructions
- [MCP Integration Guide](docs/MCP_INTEGRATION.md) - How to integrate MCP servers
- [API Reference](docs/API_REFERENCE.md) - Complete API documentation

## 🔍 Monitoring

### Health Checks

```bash
# Basic health check
curl http://localhost:8080/health

# Detailed status
curl http://localhost:8080/status
```

### Logging

```bash
# View application logs
tail -f logs/app.log

# Docker logs
docker-compose logs -f langchain-mcp-agent
```

### Backup

```bash
# Run backup script
./scripts/backup.sh
```

## 🐛 Troubleshooting

### Common Issues

1. **Configuration Errors**:
   ```bash
   python3 -c "from src.config.settings import get_config; get_config()"
   ```

2. **Docker Issues**:
   ```bash
   docker-compose logs langchain-mcp-agent
   docker-compose restart
   ```

3. **Permission Issues**:
   ```bash
   sudo chown -R $(whoami):$(whoami) logs/ data/
   ```

### Debug Mode

```bash
export DEBUG=true
export LOG_LEVEL=DEBUG
python -m src.main
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [LangChain](https://langchain.com/) for the AI agent framework
- [Model Context Protocol](https://modelcontextprotocol.io/) for the server integration standard
- [PingOne AI IAM Core](https://www.pingidentity.com/) for OAuth services
- [OpenAI](https://openai.com/) for the language model API

## 📞 Support

For support and questions:
- Check the [documentation](docs/)
- Review [troubleshooting guide](docs/DEPLOYMENT.md#troubleshooting)
- Open an issue on GitHub

---

**Built with ❤️ for secure, scalable AI agent deployments**

## Project Structure

```
src/
├── __init__.py
├── models/                 # Data models
│   ├── __init__.py
│   ├── auth.py            # Authentication models
│   ├── mcp.py             # MCP integration models
│   └── chat.py            # Chat session models
├── services/              # Core business logic
│   ├── __init__.py
│   └── interfaces.py      # Service interfaces
├── authentication/        # OAuth authentication components
│   ├── __init__.py
│   └── interfaces.py      # Authentication interfaces
├── api/                   # API and WebSocket handlers
│   └── __init__.py
└── config/                # Configuration management
    ├── __init__.py
    └── settings.py        # Environment configuration
```

## Configuration

Copy `.env.example` to `.env` and configure your environment variables:

- **PingOne Configuration**: Set up your PingOne AI IAM Core endpoints
- **Security Settings**: Configure encryption keys and security parameters
- **MCP Servers**: Define your MCP server endpoints and capabilities
- **Chat Interface**: Configure WebSocket and chat settings

## Requirements

This project addresses the following key requirements:

- **Requirement 6.4**: Environment-specific configuration management
- **Requirement 6.5**: Modular architecture with clear separation of concerns

## Next Steps

1. Install dependencies: `pip install -r requirements.txt`
2. Configure environment variables in `.env`
3. Implement the authentication components (Task 2)
4. Implement the MCP client manager (Task 5)
5. Implement the LangChain agent core (Task 6)

## Architecture

The system follows a modular architecture with clear separation between:

- **Authentication Layer**: Handles OAuth flows with PingOne
- **MCP Integration Layer**: Manages connections to MCP servers
- **Agent Layer**: LangChain-powered AI reasoning and tool execution
- **API Layer**: WebSocket-based chat interface
- **Configuration Layer**: Environment-specific settings management