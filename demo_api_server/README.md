# Banking API with PingOne Core OAuth Integration

A comprehensive banking API server with administrative UI and PingOne AI IAM Core OAuth2 integration for secure admin authentication.

## Features

- **RESTful Banking APIs**: CRUD operations for users, accounts, and transactions
- **Admin Dashboard**: Comprehensive administrative interface with activity logging
- **PingOne Core OAuth Integration**: Enterprise-grade authentication using authorization code flow
- **Activity Logging**: Detailed request/response logging with filtering and export
- **Runtime Seed Data**: Loads from committed JSON at startup; redeploy/restart reapplies the seed state
- **Security**: JWT authentication, rate limiting, CORS, and Helmet security headers

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- PingOne Core tenant with admin access
- OAuth2 client configured in PingOne Core

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd agentic_mcp_server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

3. **Set up environment configuration:**
   ```bash
   ./setup-env.sh
   ```

4. **Configure PingOne Core OAuth client:**
   - Follow the detailed instructions in `PINGONE_CORE_SETUP.md`
   - Update the `.env` file with your PingOne Core configuration

5. **Start the application:**
   ```bash
   npm start
   ```

6. **Access the application:**
   - Frontend: http://localhost:3000
   - API: http://localhost:3001

## Authentication Options

### Regular Login (Demo)
- Username: `admin`
- Password: `admin123`
- Suitable for development and testing

### PingOne Core OAuth (Production)
- Enterprise-grade authentication
- Single Sign-On (SSO) support
- Multi-Factor Authentication (MFA)
- Role-based access control
- Secure token management

## API Endpoints

### Authentication
- `POST /api/auth/login` - Regular login
- `GET /api/auth/oauth/login` - Initiate OAuth login
- `GET /api/auth/oauth/callback` - OAuth callback
- `GET /api/auth/oauth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Banking Operations
- `GET /api/users` - Get all users
- `GET /api/accounts` - Get all accounts
- `GET /api/accounts/:id/balance` - Check account balance
- `POST /api/transactions/transfer` - Transfer money
- `GET /api/transactions` - Get transactions

### Admin Operations
- `GET /api/admin/stats` - System statistics
- `GET /api/admin/activity` - Activity logs
- `GET /api/admin/activity/summary` - Activity summary

## Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
# PingOne Core Configuration
PINGONE_CORE_TENANT_NAME=your-tenant-name
PINGONE_CORE_CLIENT_ID=your-client-id
PINGONE_CORE_CLIENT_SECRET=your-client-secret
PINGONE_CORE_REDIRECT_URI=http://localhost:3001/api/auth/oauth/callback
# Also register https://api.pingdeme.org/api/auth/oauth/callback (and user callback) in PingOne if you use that host.

# Security
SESSION_SECRET=your-session-secret
ADMIN_ROLE=admin

# Server
PORT=3001
NODE_ENV=development
```

### PingOne Core Setup

1. Create OAuth2 client in PingOne Core admin console
2. Configure redirect URIs (add **all** origins you use): `http://localhost:3001/api/auth/oauth/callback` and, if applicable, `https://api.pingdeme.org/api/auth/oauth/callback` — same for the end-user app with `/api/auth/oauth/user/callback`. See `GET /api/auth/oauth/redirect-info` on a running server or **Configuration → Register these redirect URIs** in the app.
3. Set grant types to "Authorization Code"
4. Configure user roles and attributes
5. Update `.env` file with client credentials

## Development

### Refresh Bootstrap Seed

- Run `npm run data:export-bootstrap` to write the current in-memory runtime data to `data/bootstrapData.json`.
- Optional custom file: `npm run data:export-bootstrap -- ./data/my-seed.json`
- Next app restart/redeploy will load from that JSON seed.
- From the **Admin Dashboard** (while signed in as admin): **Export seed JSON** downloads the same snapshot; on `localhost`, **Save seed on server** calls `POST /api/admin/bootstrap/export` (disabled on Vercel; in production requires `ALLOW_BOOTSTRAP_EXPORT_WRITE=true`).

### Project Structure

```
├── config/           # Configuration files
├── data/            # Data store and sample data
├── middleware/      # Express middleware
├── routes/          # API route handlers
├── services/        # Business logic services
├── client/          # React frontend
├── server.js        # Main server file
└── setup-env.sh     # Environment setup script
```

### Available Scripts

- `npm start` - Start the server
- `npm run dev` - Start with nodemon
- `npm run build` - Build React app
- `./setup-env.sh` - Set up environment

## Security Features

- **OAuth2 Authorization Code Flow**: Secure authentication
- **CSRF Protection**: State parameter validation
- **Session Management**: Secure httpOnly cookies
- **Rate Limiting**: Request throttling
- **CORS**: Cross-origin resource sharing
- **Helmet**: Security headers
- **JWT Tokens**: Stateless authentication

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**
   - Ensure the callback URL matches PingOne **exactly** (scheme, host, path). Register **localhost** and **https://api.pingdeme.org** (or your API host) if you switch between dev and hosted BFF — PingOne allows multiple redirect URIs per application.

2. **"Invalid client"**
   - Verify client ID and secret in `.env` file

3. **"Insufficient permissions"**
   - Check user role assignment in PingOne Core

4. **Session issues**
   - Verify session secret is properly set

### Debug Mode

Enable OAuth debugging:
```env
DEBUG_OAUTH=true
```

## Documentation

- `PINGONE_CORE_SETUP.md` - Detailed PingOne Core configuration guide
- `env.example` - Environment configuration template
- `setup-env.sh` - Automated environment setup

## License

MIT License - see LICENSE file for details.
