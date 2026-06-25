# PingOne Core OAuth Integration Setup Guide

This guide explains how to configure PingOne AI IAM Core OAuth2 authorization code flow for admin user authentication.

## Prerequisites

1. A PingOne Core tenant with admin access
2. Node.js application running on port 3001
3. Valid domain/URL for redirect URI

## PingOne Core Configuration

### 1. Create OAuth2 Client in PingOne Core

1. Log into your PingOne Core admin console
2. Navigate to **Applications** > **OAuth2/OpenID Connect** > **Clients**
3. Click **Create Client**
4. Configure the client with these settings:

```
Client ID: your-client-id
Client Secret: your-client-secret
Client Type: Confidential
Grant Types: Authorization Code
Response Types: code
Scopes: openid profile email
Redirect URIs: http://localhost:3001/api/auth/oauth/callback
```

### 2. Configure User Roles

1. Navigate to **Users** > **Roles**
2. Create or identify an admin role (e.g., "admin", "banking-admin")
3. Assign this role to users who should have admin access

### 3. Configure User Attributes

Ensure your users have the following attributes mapped:
- `sub` (Subject ID)
- `preferred_username` or `username`
- `email`
- `given_name` (First Name)
- `family_name` (Last Name)
- `roles` or `groups` (for role-based access)

## Environment Configuration

### Option 1: Quick Setup (Recommended)

Run the setup script to automatically create your `.env` file:

```bash
./setup-env.sh
```

This script will:
- Copy `env.example` to `.env`
- Generate a secure session secret
- Provide next steps and required configuration

### Option 2: Manual Setup

1. **Copy the example environment file:**
   ```bash
   cp env.example .env
   ```

2. **Edit the `.env` file** and replace the placeholder values with your actual PingOne Core configuration:

   ```env
   # PingOne Core Tenant Configuration
   PINGONE_CORE_TENANT_NAME=your-tenant-name

   # OAuth2 Client Configuration
   PINGONE_CORE_CLIENT_ID=your-client-id
   PINGONE_CORE_CLIENT_SECRET=your-client-secret

   # Redirect URI (must match what's configured in PingOne Core)
   PINGONE_CORE_REDIRECT_URI=http://localhost:3001/api/auth/oauth/callback

   # Session Configuration
   SESSION_SECRET=your-session-secret-key-change-this-in-production

   # Admin Role Configuration
   ADMIN_ROLE=admin

   # Server Configuration
   PORT=3001
   NODE_ENV=development

   # Optional: Debug logging for OAuth flow
   DEBUG_OAUTH=false
   ```

3. **Generate a secure session secret** for production:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

> **Note:** The `.env` file is included in `.gitignore` to prevent sensitive configuration from being committed to version control. The `env.example` file serves as a template and can be safely committed to the repository.

## Installation

1. Install the new dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Access the application at `http://localhost:3000`

## OAuth Flow

### Authorization Code Flow

1. **User clicks "Sign in with PingOne Core"**
   - Application generates authorization URL with state parameter
   - User is redirected to PingOne Core authorization endpoint

2. **User authenticates with PingOne Core**
   - User enters credentials (may include MFA)
   - PingOne Core validates user and checks permissions

3. **PingOne Core redirects back with authorization code**
   - PingOne Core redirects to callback URL with code and state
   - Application validates state parameter

4. **Application exchanges code for tokens**
   - Application sends code to PingOne Core token endpoint
   - PingOne Core returns access token and refresh token

5. **Application gets user information**
   - Application uses access token to call userinfo endpoint
   - PingOne Core returns user profile and role information

6. **User is logged in**
   - Application creates/updates user in local database
   - User is redirected to admin dashboard

## Security Features

- **CSRF Protection**: State parameter prevents CSRF attacks
- **Session Management**: Secure session handling with httpOnly cookies
- **Role-based Access**: Only users with admin role can access admin features
- **Token Validation**: Access tokens are validated on each request
- **Secure Redirects**: Validated redirect URIs prevent open redirect attacks

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**
   - Ensure the redirect URI in your `.env` file exactly matches what's configured in PingOne Core
   - Check for trailing slashes or protocol mismatches

2. **"Invalid client"**
   - Verify your client ID and secret are correct
   - Ensure the client is configured for authorization code flow

3. **"Insufficient permissions"**
   - Check that the user has the admin role assigned in PingOne Core
   - Verify the role attribute mapping in user profile

4. **"Invalid state parameter"**
   - This usually indicates a session issue
   - Check that sessions are properly configured

### Debug Mode

Enable debug logging by setting:
```env
NODE_ENV=development
DEBUG=oauth:*
```

## Production Deployment

For production deployment:

1. **Update redirect URIs** to use your production domain
2. **Use HTTPS** for all OAuth endpoints
3. **Set secure session cookies**:
   ```env
   NODE_ENV=production
   ```
4. **Use strong session secrets**
5. **Configure proper CORS** settings
6. **Set up proper logging** and monitoring

## API Endpoints

- `GET /api/auth/oauth/login` - Initiate OAuth login
- `GET /api/auth/oauth/callback` - OAuth callback handler
- `GET /api/auth/oauth/logout` - Logout and clear session
- `GET /api/auth/oauth/status` - Get current session status
- `POST /api/auth/oauth/refresh` - Refresh access tokens

## Testing

1. **Test with regular login** first to ensure basic functionality
2. **Test OAuth flow** with a test user in PingOne Core
3. **Test role-based access** with users having different roles
4. **Test logout** and session clearing
5. **Test error scenarios** (invalid tokens, expired sessions, etc.)
