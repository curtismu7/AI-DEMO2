# PingOne Management API Setup Guide

## Overview

The PingOne Management API provides automated setup of resource servers, scopes, and applications for the Super Banking banking demo. This guide explains how to configure and use the Management API features.

## Prerequisites

### 1. Create a Service Account

1. **Go to PingOne Admin Console**
   - Navigate to: `https://admin.pingone.com`
   - Select your environment

2. **Create Service Account**
   - Go to `Service Accounts` in the left menu
   - Click `+ Add Service Account`
   - Name: `Super Banking Management API`
   - Description: `Service account for automated resource server and application setup`

3. **Configure Permissions**
   - Add the following scopes:
     - `pingone:manage.read` - Read access to resources
     - `pingone:manage.write` - Write access to resources
     - `pingone:manage.applications` - Application management
     - `pingone:manage.resource_servers` - Resource server management

4. **Generate Token**
   - Click `Generate Token`
   - Copy the token (this is your `PINGONE_MANAGEMENT_API_TOKEN`)
   - Store it securely in your environment variables

### 2. Environment Variables

Add the following to your `.env` file:

```bash
# Management API Configuration
PINGONE_MANAGEMENT_API_TOKEN=<your-service-account-token>
PINGONE_ENVIRONMENT_ID=<your-environment-id>
PINGONE_REGION=<your-region>  # com, eu, ca, asia, com.au
```

## Available Configurations

### 1. MCP Server Configuration

**Purpose**: Setup for MCP AI agent service with banking capabilities

**Creates**:
- Resource Server: `Super Banking AI Agent Service`
- Audience: `https://ai-agent.pingdemo.com`
- Scopes:
  - `banking:ai:agent:read` - AI agent read banking operations (primary delegation scope)
  - `banking:ai:agent:write` - AI agent write operations
  - `banking:ai:agent:admin` - AI agent admin operations
  - `banking:read` - Read access to banking data
  - `banking:write` - Write access to banking operations
- Application: `Super Banking AI Agent App` (Worker type)

**Use Case**: Standard MCP server setup for AI agent integration

### 2. Two-Exchange Delegation Configuration

**Purpose**: Setup for 2-exchange token delegation with agent capabilities

**Creates**:
- Resource Server: `Super Banking AI Agent Service`
- Audience: `https://resource-server.pingdemo.com`
- Scopes:
  - `banking:ai:agent:read` - AI agent delegation permission (primary scope for 2-exchange)
  - `banking:ai:agent:write` - AI agent write operations
  - `banking:ai:agent:admin` - AI agent admin operations
- Application: `Super Banking AI Agent App` (Worker type)

**Use Case**: Enhanced security with 2-exchange delegation pattern

## Usage Methods

### 1. Command Line Script

Use the provided setup script for quick automation:

```bash
# Validate Management API connection
node banking_api_server/scripts/setupResourceServers.js validate

# Setup MCP server configuration
node banking_api_server/scripts/setupResourceServers.js setup mcp-server

# Setup two-exchange delegation
node banking_api_server/scripts/setupResourceServers.js setup two-exchange

# Setup all configurations
node banking_api_server/scripts/setupResourceServers.js setup all

# List existing resource servers
node banking_api_server/scripts/setupResourceServers.js list
```

### 2. Admin API Endpoints

Use the REST API endpoints for programmatic access:

#### Check Management API Status
```bash
GET /api/admin/management/status
```

#### Setup Resource Server
```bash
POST /api/admin/management/setup-resource-server
Content-Type: application/json

{
  "configType": "mcp-server"
}
```

#### List Resource Servers
```bash
GET /api/admin/management/resource-servers
```

#### Create Custom Resource Server
```bash
POST /api/admin/management/create-resource-server
Content-Type: application/json

{
  "name": "Custom Resource Server",
  "description": "Custom resource server for specific use case",
  "audienceUri": "https://custom.example.com"
}
```

## Configuration Examples

### Using the Setup Script

```bash
# Step 1: Validate connection
cd banking_api_server
node scripts/setupResourceServers.js validate

# Step 2: Setup MCP server
node scripts/setupResourceServers.js setup mcp-server

# Step 3: Verify setup
node scripts/setupResourceServers.js list
```

### Using the Admin API

```javascript
// Check if Management API is configured
fetch('/api/admin/management/status')
  .then(response => response.json())
  .then(data => {
    if (data.configured) {
      console.log('Management API is ready');
    }
  });

// Setup resource server
fetch('/api/admin/management/setup-resource-server', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    configType: 'mcp-server'
  })
})
  .then(response => response.json())
  .then(data => {
    console.log('Setup completed:', data);
  });
```

## Post-Setup Configuration

### 1. Update Environment Variables

After setting up the resource server, update your `.env` file with the new application credentials:

```bash
# Agent OAuth Configuration (from setup result)
AGENT_OAUTH_CLIENT_ID=<generated-client-id>
AGENT_OAUTH_CLIENT_SECRET=<generated-client-secret>
AGENT_OAUTH_CLIENT_SCOPES=openid
USE_AGENT_ACTOR_FOR_MCP=true
```

### 2. Configure Application

1. **Update PingOne Applications**
   - Enable Token Exchange grant on your BFF application
   - Configure may_act policy to allow BFF to act as the agent

2. **Test Token Exchange**
   - Use the admin interface to test 2-exchange delegation
   - Verify MCP token generation works correctly

### 3. Validate Setup

```bash
# Test Management API connection
curl -X POST http://localhost:3001/api/admin/management/validate-connection \
  -H "Authorization: Bearer <admin-session-token>"

# Check resource servers
curl http://localhost:3001/api/admin/management/resource-servers \
  -H "Authorization: Bearer <admin-session-token>"
```

## Troubleshooting

### Common Issues

#### 1. "Management API token not configured"
**Solution**: Ensure `PINGONE_MANAGEMENT_API_TOKEN` is set in your environment variables

#### 2. "Invalid or expired token"
**Solution**: Generate a new service account token in PingOne Admin

#### 3. "Insufficient permissions"
**Solution**: Ensure your service account has the required scopes:
- `pingone:manage.read`
- `pingone:manage.write`
- `pingone:manage.applications`
- `pingone:manage.resource_servers`

#### 4. "Resource server already exists"
**Solution**: Use the list command to check existing resources and use different names if needed

#### 5. "Connection failed"
**Solution**: Verify your environment ID and region are correct

### Debug Commands

```bash
# Check environment variables
echo "PINGONE_MANAGEMENT_API_TOKEN: ${PINGONE_MANAGEMENT_API_TOKEN:0:10}..."
echo "PINGONE_ENVIRONMENT_ID: $PINGONE_ENVIRONMENT_ID"
echo "PINGONE_REGION: $PINGONE_REGION"

# Test Management API connection manually
curl -H "Authorization: Bearer $PINGONE_MANAGEMENT_API_TOKEN" \
  "https://api.pingone.$PINGONE_REGION/$PINGONE_ENVIRONMENT_ID"

# Run setup with verbose logging
DEBUG=* node scripts/setupResourceServers.js validate
```

## Security Considerations

### 1. Token Security
- Store Management API tokens securely
- Rotate tokens regularly
- Use least privilege principle for scopes

### 2. Access Control
- Management API endpoints require admin authentication
- Use separate service accounts for different environments
- Monitor API usage and access patterns

### 3. Audit Trail
- Management API operations are logged in the server logs
- PingOne provides audit logs for all Management API calls
- Review resource server creation and modifications

## Advanced Usage

### Custom Configurations

Create custom resource server configurations:

```javascript
const customConfig = {
  name: 'Custom Banking Service',
  description: 'Custom resource server for specific banking operations',
  audienceUri: 'https://custom-banking.example.com',
  scopes: [
    {
      name: 'banking:custom:read',
      description: 'Custom read access for banking operations'
    },
    {
      name: 'banking:custom:write',
      description: 'Custom write access for banking operations'
    }
  ],
  applications: [
    {
      name: 'Custom Banking App',
      description: 'Custom application for banking operations',
      type: 'worker',
      grantTypes: ['client_credentials'],
      redirectUris: []
    }
  ]
};

// Use custom configuration
fetch('/api/admin/management/setup-resource-server', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customConfig: customConfig
  })
});
```

### Batch Operations

```bash
# Setup multiple configurations
for config in mcp-server two-exchange; do
  echo "Setting up $config..."
  node scripts/setupResourceServers.js setup $config
done

# Verify all setups
node scripts/setupResourceServers.js list
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Setup PingOne Resources

on:
  workflow_dispatch:

jobs:
  setup-resources:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: |
          cd banking_api_server
          npm install
          
      - name: Setup PingOne Resources
        env:
          PINGONE_MANAGEMENT_API_TOKEN: ${{ secrets.PINGONE_MANAGEMENT_API_TOKEN }}
          PINGONE_ENVIRONMENT_ID: ${{ secrets.PINGONE_ENVIRONMENT_ID }}
          PINGONE_REGION: ${{ secrets.PINGONE_REGION }}
        run: |
          cd banking_api_server
          node scripts/setupResourceServers.js validate
          node scripts/setupResourceServers.js setup mcp-server
```

## Support

For issues with the Management API setup:

1. Check the server logs for detailed error messages
2. Verify your PingOne configuration in the admin console
3. Ensure your service account has the required permissions
4. Test the Management API connection manually

For additional help, refer to:
- PingOne Management API documentation
- Super Banking banking demo documentation
- Server logs and error messages
