# Banking MCP Server - Deployment Guide

This guide covers deployment options and environment setup for the Banking MCP Server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [Docker Deployment](#docker-deployment)
- [Health Checks](#health-checks)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- Node.js 20.x or higher
- npm 9.x or higher
- Docker 24.x or higher (for containerized deployment)
- Docker Compose 2.x or higher (for multi-container setup)

### External Dependencies

- **PingOne AI IAM Core**: For authentication and authorization
- **Banking API Server**: The backend banking API (typically running on port 3001)

## Environment Configuration

### Required Environment Variables

The following environment variables must be set:

```bash
# PingOne Configuration
PINGONE_BASE_URL=https://your-pingone-environment.pingidentity.com
PINGONE_CLIENT_ID=your-client-id
PINGONE_CLIENT_SECRET=your-client-secret
PINGONE_INTROSPECTION_ENDPOINT=https://your-pingone-environment.pingidentity.com/as/introspect
PINGONE_AUTHORIZATION_ENDPOINT=https://your-pingone-environment.pingidentity.com/as/authorize
PINGONE_TOKEN_ENDPOINT=https://your-pingone-environment.pingidentity.com/as/token

# Security Configuration
ENCRYPTION_KEY=your-64-character-encryption-key-here
```

### Optional Environment Variables

```bash
# Server Configuration
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_PORT=8080
MAX_CONNECTIONS=100
SESSION_TIMEOUT=3600

# Banking API Configuration
BANKING_API_BASE_URL=http://localhost:3001
BANKING_API_TIMEOUT=30000
BANKING_API_MAX_RETRIES=3
CIRCUIT_BREAKER_THRESHOLD=5

# Storage Configuration
TOKEN_STORAGE_PATH=./data/tokens
SESSION_CLEANUP_INTERVAL=300
MAX_SESSION_DURATION=86400

# Logging Configuration
LOG_LEVEL=INFO
AUDIT_LOG_PATH=./logs/audit.log
SECURITY_LOG_PATH=./logs/security.log
```

### Configuration Generation

Generate example configuration files:

```bash
# Generate all environment configurations
npm run config:example

# Generate specific environment
npm run config:example development .env.development

# Generate with secure keys
npm run config:example production .env.production --generate-keys

# Generate Docker environment files
npm run config:example production .env.docker.production --docker
```

### Configuration Validation

Validate your configuration:

```bash
# Validate environment variables
npm run config:validate

# Validate configuration file
npm run config:validate .env.production
```

## Development Setup

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd banking-mcp-server
   npm install
   ```

2. **Create development configuration:**
   ```bash
   npm run config:example development .env.development
   # Edit .env.development with your actual values
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Run with debugging:**
   ```bash
   npm run dev:debug
   ```

### Development Scripts

```bash
# Development with hot reload
npm run dev

# Development with debugging
npm run dev:debug

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Type checking
npm run typecheck

# Full validation (type check + lint + test)
npm run validate
```

## Production Deployment

### Direct Node.js Deployment

1. **Prepare the environment:**
   ```bash
   # Create production configuration
   npm run config:example production .env.production --generate-keys
   
   # Edit .env.production with your actual values
   # Validate configuration
   npm run config:validate .env.production
   ```

2. **Build and start:**
   ```bash
   # Build the application
   npm run build:prod
   
   # Start production server
   npm run start:prod
   ```

### Process Management with PM2

1. **Install PM2:**
   ```bash
   npm install -g pm2
   ```

2. **Create PM2 ecosystem file:**
   ```javascript
   // ecosystem.config.js
   module.exports = {
     apps: [{
       name: 'banking-mcp-server',
       script: 'dist/index.js',
       env: {
         NODE_ENV: 'production'
       },
       env_file: '.env.production',
       instances: 'max',
       exec_mode: 'cluster',
       max_memory_restart: '500M',
       error_file: './logs/pm2-error.log',
       out_file: './logs/pm2-out.log',
       log_file: './logs/pm2-combined.log',
       time: true
     }]
   };
   ```

3. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

## Docker Deployment

### Single Container

1. **Build Docker image:**
   ```bash
   npm run docker:build
   ```

2. **Run container:**
   ```bash
   # Using environment file
   npm run docker:run
   
   # Or manually
   docker run -d \
     --name banking-mcp-server \
     -p 8080:8080 \
     --env-file .env.production \
     banking-mcp-server
   ```

### Docker Compose

#### Development Environment

```bash
# Start development environment
npm run docker:dev

# Or manually
docker-compose -f docker-compose.dev.yml up
```

#### Production Environment

```bash
# Start production environment
npm run docker:prod

# Or manually
docker-compose -f docker-compose.prod.yml up -d
```

### Docker Environment Variables

For Docker deployments, you can also pass environment variables directly:

```bash
docker run -d \
  --name banking-mcp-server \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e PINGONE_BASE_URL=https://your-pingone.com \
  -e PINGONE_CLIENT_ID=your-client-id \
  -e ENCRYPTION_KEY=your-encryption-key \
  banking-mcp-server
```

## Health Checks

### Manual Health Check

```bash
# Check server health
npm run health-check

# Check specific endpoint
npm run health-check localhost 8080 /health

# Check with custom timeout
HEALTH_CHECK_TIMEOUT=10000 npm run health-check
```

### Health Check Endpoints

The server provides health check endpoints:

- `GET /health` - Basic health status
- `GET /health/detailed` - Detailed health information
- `GET /ready` - Readiness probe
- `GET /live` - Liveness probe

### Docker Health Checks

Docker containers include built-in health checks:

```bash
# Check container health
docker ps
docker inspect banking-mcp-server | grep Health -A 10
```

## Monitoring

### Logging

The server provides structured logging:

- **Audit logs**: Banking operations and authentication events
- **Security logs**: Security-related events and errors
- **Application logs**: General application events

### Log Levels

- `ERROR`: Error conditions
- `WARN`: Warning conditions
- `INFO`: Informational messages
- `DEBUG`: Debug-level messages

### Metrics

Monitor these key metrics:

- **Connection count**: Active MCP connections
- **Session count**: Active user sessions
- **Banking API response times**: Performance metrics
- **Authentication success/failure rates**: Security metrics
- **Token refresh rates**: Token lifecycle metrics

## Troubleshooting

### Common Issues

1. **Configuration Validation Errors**
   ```bash
   # Validate configuration
   npm run config:validate
   
   # Check specific environment variables
   echo $PINGONE_BASE_URL
   echo $ENCRYPTION_KEY
   ```

2. **Connection Issues**
   ```bash
   # Test health endpoint
   curl http://localhost:8080/health
   
   # Check server logs
   tail -f logs/security.log
   tail -f logs/audit.log
   ```

3. **Authentication Issues**
   - Verify PingOne configuration
   - Check client credentials
   - Validate token endpoints
   - Review security logs

4. **Banking API Issues**
   - Verify banking API is running
   - Check network connectivity
   - Review circuit breaker status
   - Check API response times

### Debug Mode

Enable debug logging:

```bash
# Set log level to DEBUG
export LOG_LEVEL=DEBUG

# Start with debugging
npm run dev:debug
```

### Container Debugging

```bash
# View container logs
docker logs banking-mcp-server

# Execute shell in container
docker exec -it banking-mcp-server sh

# Check container health
docker inspect banking-mcp-server
```

### Performance Tuning

1. **Memory Settings**
   ```bash
   # Increase Node.js memory limit
   export NODE_OPTIONS="--max-old-space-size=1024"
   ```

2. **Connection Limits**
   ```bash
   # Adjust max connections
   export MAX_CONNECTIONS=200
   ```

3. **Timeout Settings**
   ```bash
   # Adjust API timeouts
   export BANKING_API_TIMEOUT=45000
   export SESSION_TIMEOUT=7200
   ```

## Security Considerations

1. **Encryption Keys**
   - Use at least 64-character encryption keys
   - Rotate keys regularly
   - Store keys securely (e.g., AWS Secrets Manager, HashiCorp Vault)

2. **Network Security**
   - Use HTTPS for all external communications
   - Implement proper firewall rules
   - Use VPN or private networks when possible

3. **Container Security**
   - Run containers as non-root user
   - Use minimal base images
   - Regularly update dependencies
   - Scan images for vulnerabilities

4. **Monitoring and Alerting**
   - Monitor authentication failures
   - Alert on unusual activity patterns
   - Track token usage and expiration
   - Monitor system resources

## Support

For deployment issues:

1. Check the troubleshooting section above
2. Review application logs
3. Validate configuration
4. Check external service connectivity
5. Contact the development team with detailed error information