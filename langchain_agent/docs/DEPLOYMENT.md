# Deployment Guide

This guide covers deploying the LangChain MCP OAuth Agent in different environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Deployment](#development-deployment)
- [Production Deployment](#production-deployment)
- [Docker Deployment](#docker-deployment)
- [Environment Configuration](#environment-configuration)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Python**: 3.11 or higher
- **Node.js**: 18 or higher (for frontend)
- **Docker**: Latest version (for containerized deployment)
- **Memory**: Minimum 2GB RAM, recommended 4GB+
- **Storage**: Minimum 1GB free space

### External Services

- **PingOne AI IAM Core (ForgeRock)**: OAuth provider
- **OpenAI API**: For LangChain integration
- **MCP Servers**: Target servers for agent interactions

## Development Deployment

### Quick Start

1. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd langchain-mcp-oauth-agent
   ./scripts/setup-dev.sh
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start services**:
   ```bash
   # Backend
   python -m src.main
   
   # Frontend (in another terminal)
   cd frontend
   npm start
   ```

### Development Configuration

The development environment uses these defaults:
- Debug mode enabled
- Verbose logging
- Local redirect URIs
- Shorter session timeouts
- Test-friendly settings

## Production Deployment

### Automated Setup

```bash
./scripts/setup-prod.sh
```

This script will:
- Validate system requirements
- Create production directories
- Generate configuration templates
- Build Docker images
- Set up logging and monitoring

### Manual Setup

1. **Prepare environment**:
   ```bash
   mkdir -p logs data config
   ```

2. **Create production configuration**:
   ```bash
   python3 -c "
   import sys
   sys.path.append('src')
   from config.settings import ConfigManager
   from pathlib import Path
   
   manager = ConfigManager()
   manager.export_config_template('production', Path('.env'))
   "
   ```

3. **Configure secrets**:
   Edit `.env` file with production values:
   ```bash
   ENVIRONMENT=production
   DEBUG=false
   LOG_LEVEL=WARNING
   
   # PingOne Configuration
   PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
   PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
   # ... other PingOne settings
   
   # Security
   ENCRYPTION_MASTER_KEY=<your-secure-key>
   ENCRYPTION_SALT=<your-secure-salt>
   
   # API Keys
   OPENAI_API_KEY=<your-openai-key>
   ```

## Docker Deployment

### Using Docker Compose (Recommended)

1. **Start services**:
   ```bash
   docker-compose up -d
   ```

2. **Check status**:
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

3. **Update deployment**:
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

### Using Docker directly

1. **Build image**:
   ```bash
   docker build -t langchain-mcp-agent:latest .
   ```

2. **Run container**:
   ```bash
   docker run -d \
     --name langchain-mcp-agent \
     -p 8080:8080 \
     --env-file .env \
     -v $(pwd)/logs:/app/logs \
     -v $(pwd)/data:/app/data \
     langchain-mcp-agent:latest
   ```

### Docker Configuration Options

The Docker setup supports:
- Multi-stage builds for optimized images
- Non-root user execution
- Health checks
- Volume mounts for persistence
- Environment-based configuration

## Environment Configuration

### Configuration Hierarchy

Configuration values are loaded in this priority order:
1. Environment variables
2. Configuration files (JSON)
3. Environment-specific defaults
4. Global defaults

### Environment Types

#### Development
- Debug mode enabled
- Verbose logging
- Local URLs allowed
- Shorter timeouts

#### Staging
- Production-like settings
- Moderate logging
- HTTPS required
- Extended retry logic

#### Production
- Security-focused
- Minimal logging
- Strict validation
- Performance optimized

#### Test
- Fast timeouts
- Clean output
- Isolated settings
- Mock-friendly

### Configuration Validation

Each environment has specific validation rules:

```python
# Example: Production validation
- Debug mode must be disabled
- Log level must be WARNING or higher
- HTTPS required for all external URLs
- Strong encryption keys required (32+ characters)
```

## Monitoring and Maintenance

### Health Checks

The application provides health check endpoints:

```bash
# Basic health check
curl http://localhost:8080/health

# Detailed status
curl http://localhost:8080/status
```

### Logging

Logs are structured and environment-aware:

```bash
# View logs
tail -f logs/app.log

# Docker logs
docker-compose logs -f langchain-mcp-agent
```

### Log Rotation

Production setup includes automatic log rotation:
- Daily rotation
- 30-day retention
- Compression enabled
- Service restart on rotation

### Backup

Use the provided backup script:

```bash
./scripts/backup.sh
```

Backs up:
- Configuration files
- Application data
- Recent logs (7 days)

### System Service (Linux)

For production Linux deployments:

```bash
# Install systemd service
sudo cp /tmp/langchain-mcp-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable langchain-mcp-agent
sudo systemctl start langchain-mcp-agent

# Check status
sudo systemctl status langchain-mcp-agent
```

## Troubleshooting

### Common Issues

#### Configuration Errors

```bash
# Validate configuration
python3 -c "
from src.config.settings import get_config
try:
    config = get_config()
    print('Configuration valid')
except Exception as e:
    print(f'Configuration error: {e}')
"
```

#### Docker Issues

```bash
# Check container logs
docker-compose logs langchain-mcp-agent

# Restart services
docker-compose restart

# Rebuild images
docker-compose build --no-cache
```

#### Permission Issues

```bash
# Fix log directory permissions
sudo chown -R $(whoami):$(whoami) logs/

# Fix data directory permissions
sudo chown -R $(whoami):$(whoami) data/
```

### Debug Mode

Enable debug mode for troubleshooting:

```bash
export DEBUG=true
export LOG_LEVEL=DEBUG
python -m src.main
```

### Performance Issues

1. **Check resource usage**:
   ```bash
   docker stats langchain-mcp-agent
   ```

2. **Monitor logs for errors**:
   ```bash
   grep ERROR logs/app.log
   ```

3. **Verify external service connectivity**:
   ```bash
   curl -I https://your-tenant.forgeblocks.com
   ```

### Getting Help

1. Check logs for error messages
2. Verify configuration values
3. Test external service connectivity
4. Review system resource usage
5. Consult the API documentation

For additional support, include:
- Environment details
- Configuration (with secrets redacted)
- Error logs
- Steps to reproduce the issue