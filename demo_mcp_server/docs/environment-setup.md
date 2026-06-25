# Banking MCP Server - Environment Setup Guide

This guide provides detailed instructions for setting up the Banking MCP Server in different environments.

## Table of Contents

- [Quick Start](#quick-start)
- [Environment Types](#environment-types)
- [Configuration Management](#configuration-management)
- [Development Environment](#development-environment)
- [Staging Environment](#staging-environment)
- [Production Environment](#production-environment)
- [Docker Environment](#docker-environment)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- npm 9.x or higher
- PingOne AI IAM Core account
- Banking API server running

### Basic Setup

1. **Clone and install:**
   ```bash
   git clone <repository-url>
   cd banking-mcp-server
   npm install
   ```

2. **Generate configuration:**
   ```bash
   npm run config:example development .env.development --generate-keys
   ```

3. **Edit configuration:**
   ```bash
   # Edit .env.development with your PingOne and Banking API settings
   nano .env.development
   ```

4. **Validate and start:**
   ```bash
   npm run config:validate .env.development
   npm run dev
   ```

## Environment Types

The Banking MCP Server supports four environment types:

### Development
- **Purpose**: Local development and testing
- **Features**: Debug logging, hot reload, relaxed security
- **Port**: 8080 (default)
- **Host**: localhost
- **Session timeout**: 30 minutes

### Staging
- **Purpose**: Pre-production testing and integration
- **Features**: Production-like settings with enhanced logging
- **Port**: 8080
- **Host**: 0.0.0.0
- **Session timeout**: 1 hour

### Production
- **Purpose**: Live production environment
- **Features**: Optimized performance, minimal logging, strict security
- **Port**: 8080
- **Host**: 0.0.0.0
- **Session timeout**: 1 hour

### Test
- **Purpose**: Automated testing
- **Features**: Minimal logging, fast cleanup, isolated storage
- **Port**: 8081
- **Host**: localhost
- **Session timeout**: 1 hour

## Configuration Management

### Environment Variables

The server uses environment variables for configuration. Variables can be set through:

1. **Environment files** (`.env`, `.env.development`, etc.)
2. **System environment variables**
3. **Docker environment files**
4. **Configuration files** (JSON format)

### Configuration Priority

Configuration is loaded in this order (later sources override earlier ones):

1. Environment-specific defaults
2. Environment files (`.env.{environment}`)
3. Generic environment file (`.env`)
4. System environment variables
5. Command-line configuration files

### Required Configuration

All environments require these variables:

```bash
# PingOne AI IAM Core
PINGONE_BASE_URL=https://your-environment-id.forgeblocks.com:443
PINGONE_CLIENT_ID=your-client-id
PINGONE_CLIENT_SECRET=your-client-secret
PINGONE_INTROSPECTION_ENDPOINT=https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect
PINGONE_AUTHORIZATION_ENDPOINT=https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize
PINGONE_TOKEN_ENDPOINT=https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token

# Security
ENCRYPTION_KEY=your-64-character-encryption-key
```

> **📋 OAuth Client Setup Required**: Before configuring these variables, you need to set up OAuth clients in PingOne AI IAM Core. See the [PingOne OAuth Setup Guide](./pingone-oauth-setup.md) for detailed instructions on client configuration, scopes, and redirect URIs.

### Configuration Tools

```bash
# Generate example configurations
npm run config:example                    # All environments
npm run config:example development        # Specific environment
npm run config:example production --generate-keys  # With secure keys

# Validate configuration
npm run config:validate                   # Current environment
npm run config:validate .env.production  # Specific file

# Create Docker configurations
npm run config:example production .env.docker.production --docker
```

## Development Environment

### Setup

1. **Generate development configuration:**
   ```bash
   npm run config:example development .env.development --generate-keys
   ```

2. **Edit configuration:**
   ```bash
   # Required: Update PingOne AIC settings
   PINGONE_BASE_URL=https://your-dev-environment-id.forgeblocks.com:443
   PINGONE_CLIENT_ID=your-dev-client-id
   PINGONE_CLIENT_SECRET=your-dev-client-secret
   
   # Optional: Adjust banking API URL if different
   BANKING_API_BASE_URL=http://localhost:3001
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

### Development Features

- **Hot reload**: Automatic restart on code changes
- **Debug logging**: Detailed logs for troubleshooting
- **Relaxed validation**: More permissive configuration validation
- **Local storage**: Data stored in `./dev-data/`
- **Debug mode**: Available with `npm run dev:debug`

### Development Scripts

```bash
npm run dev              # Start with hot reload
npm run dev:debug        # Start with Node.js debugger
npm run test             # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
npm run lint             # Lint code
npm run lint:fix         # Fix linting issues
npm run typecheck        # Type checking
npm run validate         # Full validation (lint + type + test)
```

## Staging Environment

### Setup

1. **Generate staging configuration:**
   ```bash
   npm run config:example staging .env.staging --generate-keys
   ```

2. **Update configuration:**
   ```bash
   # Update with staging-specific values
   PINGONE_BASE_URL=https://your-staging-environment-id.forgeblocks.com:443
   BANKING_API_BASE_URL=https://staging-banking-api.example.com
   
   # Use production-like paths
   TOKEN_STORAGE_PATH=/app/data/tokens
   AUDIT_LOG_PATH=/app/logs/audit.log
   SECURITY_LOG_PATH=/app/logs/security.log
   ```

3. **Deploy and start:**
   ```bash
   npm run build
   npm run start:staging
   ```

### Staging Features

- **Production-like environment**: Similar to production settings
- **Enhanced logging**: More detailed logs than production
- **Integration testing**: Suitable for end-to-end testing
- **External services**: Uses staging versions of external APIs

## Production Environment

### Setup

1. **Generate production configuration:**
   ```bash
   npm run config:example production .env.production --generate-keys
   ```

2. **Secure configuration:**
   ```bash
   # Set proper file permissions
   chmod 600 .env.production
   
   # Update with production values
   PINGONE_BASE_URL=https://your-production-environment-id.forgeblocks.com:443
   BANKING_API_BASE_URL=https://banking-api.example.com
   
   # Use absolute paths
   TOKEN_STORAGE_PATH=/app/data/tokens
   AUDIT_LOG_PATH=/app/logs/audit.log
   SECURITY_LOG_PATH=/app/logs/security.log
   ```

3. **Deploy:**
   ```bash
   # Build for production
   npm run build:prod
   
   # Start production server
   npm run start:prod
   ```

### Production Features

- **Optimized performance**: Production build with optimizations
- **Minimal logging**: Only warnings and errors
- **Strict security**: Enhanced security validations
- **Resource limits**: Configured resource constraints
- **Health checks**: Built-in health monitoring

### Production Deployment Options

#### Option 1: Direct Node.js

```bash
# Using startup script
./scripts/start-server.sh --environment production --daemon

# Using npm scripts
npm run start:prod
```

#### Option 2: Process Manager (PM2)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### Option 3: System Service (Linux)

```bash
# Install as system service
sudo ./scripts/install.sh

# Manage service
sudo systemctl enable banking-mcp-server
sudo systemctl start banking-mcp-server
sudo systemctl status banking-mcp-server
```

## Docker Environment

### Development with Docker

```bash
# Build and run development container
npm run docker:dev

# Or manually
docker-compose -f docker-compose.dev.yml up
```

### Production with Docker

```bash
# Build production image
npm run docker:build

# Run production container
npm run docker:prod

# Or manually
docker-compose -f docker-compose.prod.yml up -d
```

### Docker Configuration

1. **Create Docker environment file:**
   ```bash
   npm run config:example production .env.docker.production --docker
   ```

2. **Build and run:**
   ```bash
   docker build -t banking-mcp-server .
   docker run -d \
     --name banking-mcp-server \
     -p 8080:8080 \
     --env-file .env.docker.production \
     banking-mcp-server
   ```

### Docker Features

- **Multi-stage build**: Optimized production images
- **Non-root user**: Security-focused container setup
- **Health checks**: Built-in container health monitoring
- **Volume mounts**: Persistent data and log storage
- **Resource limits**: Configurable CPU and memory limits

## Security Best Practices

### Encryption Keys

```bash
# Generate secure encryption key (64+ characters)
openssl rand -base64 48

# Or use the configuration generator
npm run config:example production --generate-keys
```

### File Permissions

```bash
# Configuration files
chmod 600 .env*

# Token storage directory
chmod 700 data/tokens

# Log directories
chmod 755 logs
```

### Environment Isolation

- Use separate PingOne environments for each deployment stage
- Use different encryption keys for each environment
- Isolate network access between environments
- Use separate databases/storage for each environment

### Secret Management

For production environments, consider using:

- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**
- **Kubernetes Secrets**

Example with AWS Secrets Manager:

```bash
# Store secrets
aws secretsmanager create-secret \
  --name "banking-mcp-server/production" \
  --secret-string file://.env.production

# Retrieve in application startup
aws secretsmanager get-secret-value \
  --secret-id "banking-mcp-server/production" \
  --query SecretString --output text > .env.production
```

## Troubleshooting

### Common Issues

1. **Configuration Validation Errors**
   ```bash
   # Check configuration
   npm run config:validate
   
   # Verify required variables
   echo $PINGONE_BASE_URL
   echo $ENCRYPTION_KEY
   ```

2. **Permission Errors**
   ```bash
   # Fix token storage permissions
   chmod 700 data/tokens
   
   # Fix log permissions
   chmod 755 logs
   ```

3. **Port Conflicts**
   ```bash
   # Check port usage
   lsof -i :8080
   
   # Use different port
   export MCP_SERVER_PORT=8081
   ```

4. **Memory Issues**
   ```bash
   # Increase Node.js memory limit
   export NODE_OPTIONS="--max-old-space-size=1024"
   ```

### Debug Mode

Enable debug logging:

```bash
# Set debug log level
export LOG_LEVEL=DEBUG

# Start with debugging
npm run dev:debug
```

### Health Checks

```bash
# Manual health check
npm run health-check

# Check specific endpoint
curl http://localhost:8080/health

# Detailed health information
curl http://localhost:8080/health/detailed
```

### Log Analysis

```bash
# View application logs
tail -f logs/audit.log
tail -f logs/security.log

# View system logs (Linux)
journalctl -u banking-mcp-server -f

# View Docker logs
docker logs banking-mcp-server -f
```

### Performance Monitoring

Monitor these metrics:

- **CPU usage**: Should be < 80% under normal load
- **Memory usage**: Should be < 512MB for typical workloads
- **Connection count**: Monitor active MCP connections
- **Response times**: Banking API response times
- **Error rates**: Authentication and API error rates

### Environment-Specific Troubleshooting

#### Development
- Check if Banking API server is running on port 3001
- Verify PingOne development environment configuration
- Check file permissions for local data directories

#### Staging
- Verify network connectivity to staging services
- Check SSL/TLS certificates for HTTPS endpoints
- Validate staging-specific configuration values

#### Production
- Monitor system resources and performance
- Check security logs for unusual activity
- Verify backup and disaster recovery procedures
- Monitor external service dependencies

## Support

For environment setup issues:

1. Check this troubleshooting guide
2. Validate configuration with `npm run config:validate`
3. Check application logs
4. Verify external service connectivity
5. Contact the development team with:
   - Environment type and configuration
   - Error messages and logs
   - Steps to reproduce the issue