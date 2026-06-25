# PingOne: Admin Token Exchange Setup Guide

Step-by-step setup for **admin users** to access elevated administrative operations using admin tokens with extended scopes. This enables admin-only MCP tools and privileged operations while maintaining security and audit compliance.

> **Regular user token exchange:** See [PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) for standard user token exchange setup.

**Product scope:** PingOne SaaS (`auth.pingone.com`).
This is NOT PingOne Advanced Identity Cloud (ForgeRock AM) — those are separate products.

---

## Architecture Overview

The admin token exchange pattern uses admin tokens as subject tokens in the standard RFC 8693 token exchange flow, providing elevated privileges for administrative operations.

```
Admin User (Admin Login)
  │
  │  PKCE Authorization Code login — admin authenticates with elevated scopes
  ▼
Admin Token  [TOKEN 1 — admin's session token]
  { sub: "<admin-id>",
    aud: ["https://ai-agent.pingdemo.com"],      ← AI Agent service validates this token
    scope: "admin:read admin:write users:read users:manage banking:read banking:write",
    may_act: { "sub": "<PINGONE_ADMIN_CLIENT_ID>" } }
              ↑ the client ID UUID of Super Banking Admin App — permits it to exchange this token
  │
  │  Token Exchange (RFC 8693)
  │  Banking app server POSTS the Admin Token to PingOne's /token endpoint.
  │  PingOne checks: may_act.sub == actorToken.aud[0]? → issues MCP Token.
  │  Exchanger: Super Banking Admin App (PINGONE_ADMIN_CLIENT_ID)
  ▼
MCP Token  [TOKEN 2 — delegated admin token]
  { sub: "<admin-id>",
    aud: ["https://mcp-server.pingdemo.com"],   ← MCP Server validates this token
    scope: "admin:read admin:write users:read users:manage banking:read banking:write",
    act: { "sub": "<PINGONE_ADMIN_CLIENT_ID>" } }
          ↑ the client ID UUID of the Admin App — verifiable delegation audit trail
  │
  │  Admin MCP Tool Execution
  │  MCP server uses admin token for privileged operations
  ▼
Admin Operations (User Management, System Status, Audit Logs, etc.)
```

---

## ⚠️ Critical: Admin Token Security Requirements

Admin tokens require enhanced security measures due to elevated privileges:

| Requirement | Implementation | Why it matters |
|------------|----------------|----------------|
| **Elevated Scopes** | `admin:read admin:write users:read users:manage` | Enables privileged operations |
| **Session Security** | httpOnly cookies, SameSite=Lax, CSRF protection | Prevents token theft |
| **Audit Logging** | All admin actions logged with user context | Compliance and security monitoring |
| **Token Validation** | Strict scope validation and claim verification | Prevents privilege escalation |
| **Feature Flag Control** | `ff_admin_token_exchange=true` | Enables/disables admin functionality |

---

## Phase 1: Create PingOne Admin Application

### 1.1 Create New Web Application

1. **Login to PingOne Admin Console**
   - Navigate to your PingOne environment
   - Go to **Applications → Applications**

2. **Create New Application**
   - Click **+ Add Application**
   - Select **Web App** type
   - Click **Next**

3. **Configure Basic Settings**
   ```
   Application Name: Super Banking Admin App
   Description: Administrative interface for Super Banking demo
   Protocol: OIDC
   Application Type: Web
   ```

4. **Configure URLs**
   ```
   Redirect URIs:
   - http://localhost:3000/api/auth/oauth/callback
   - https://your-domain.vercel.app/api/auth/oauth/callback
   
   Post Logout Redirect URIs:
   - http://localhost:3000/
   - https://your-domain.vercel.app/
   
   Allowed Origins:
   - http://localhost:3000
   - https://your-domain.vercel.app
   ```

5. **Enable PKCE**
   - Check **Enable PKCE** (required for security)
   - Leave **Proof Key for Code Exchange** enabled

### 1.2 Configure OIDC Settings

1. **Response Type**
   - Check **Code** (Authorization Code flow)
   - **Uncheck** **ID Token** (admin flow doesn't need ID tokens)

2. **Token Settings**
   - **Access Token Lifetime:** 7200 seconds (2 hours for admin sessions)
   - **Refresh Token Lifetime:** 86400 seconds (24 hours)
   - **Refresh Token Usage:** Reuse
   - **Enable Refresh Token:** ✅ Checked

### 1.3 Configure Scopes

1. **Add Required Scopes**
   ```
   OpenID Connect Standard Scopes:
   - profile
   - email
   
   Custom Admin Scopes:
   - admin:read
   - admin:write
   - admin:delete
   - users:read
   - users:manage
   - banking:read
   - banking:write
   ```

2. **Scope Descriptions**
   ```
   admin:read    - Read administrative data and system status
   admin:write   - Modify administrative settings and configurations
   admin:delete  - Delete users and administrative resources
   users:read    - Read user profiles and account information
   users:manage  - Manage user accounts and permissions
   banking:read  - Read banking data and transaction history
   banking:write - Perform banking operations and transfers
   ```

---

## Phase 2: Configure Resource Server

### 2.1 Create MCP Resource Server

1. **Create Resource Server**
   - Go to **Applications → Resource Servers**
   - Click **+ Add Resource Server**
   - Configure settings:
   ```
   Resource Server Name: Super Banking MCP Server
   Resource Server ID: https://mcp-server.pingdemo.com
   Description: MCP server for admin tool execution
   ```

2. **Add Resource Server Scopes**
   ```
   Admin Scopes:
   - admin:read
   - admin:write
   - admin:delete
   - users:read
   - users:manage
   - banking:read
   - banking:write
   ```

3. **Configure Access Settings**
   - **Authentication Required:** Yes
   - **Include in Public Scopes:** No
   - **Require Consent:** No (admin apps are trusted)

### 2.2 Configure Token Customization

1. **Enable Token Customization**
   - Go to **Applications → [Admin App] → Token Settings**
   - Click **Enable Token Customization**

2. **Add may_act Claim**
   - **Claim Name:** `may_act`
   - **Claim Type:** JSON Object
   - **Value:** `{"sub": "{{PINGONE_ADMIN_CLIENT_ID}}"}`

3. **Add Custom Claims (Optional)**
   ```
   Claim Name: admin_level
   Claim Type: String
   Value: full_admin
   
   Claim Name: permissions
   Claim Type: JSON Array
   Value: ["user_management", "system_admin", "audit_access"]
   ```

---

## Phase 3: Configure Delegation Permissions

### 3.1 Enable Token Exchange

1. **Grant Type Configuration**
   - Go to **Applications → [Admin App] → Token Settings**
   - Enable **Token Exchange** grant type
   - Configure exchange settings:
   ```
   Allowed Actor Types: Client
   Maximum Token Lifetime: 3600 seconds
   Include Actor Token: Yes
   ```

2. **Configure Delegation Policy**
   - Go to **Applications → [Admin App] → Policies**
   - Create new policy:
   ```
   Policy Name: Admin Token Exchange Policy
   Policy Type: Token Exchange
   Conditions:
     - Actor must be this application
     - Subject must have admin scopes
     - Target audience must be MCP resource server
   ```

### 3.2 Set Up Resource Access

1. **Grant Resource Access**
   - Go to **Applications → [Admin App] → Resources**
   - Add access to MCP resource server:
   ```
   Resource Server: Super Banking MCP Server
   Scopes: All admin scopes
   Access Type: Direct
   ```

2. **Configure Scope Mapping**
   ```
   Requested Scope → Granted Scope
   admin:read → admin:read
   admin:write → admin:write
   admin:delete → admin:delete
   users:read → users:read
   users:manage → users:manage
   banking:read → banking:read
   banking:write → banking:write
   ```

---

## Phase 4: Environment Configuration

### 4.1 Backend Environment Variables

Add to your `.env` file or Vercel environment variables:

```bash
# Admin Application Configuration
PINGONE_ADMIN_CLIENT_ID=<admin-app-client-id>
PINGONE_ADMIN_CLIENT_SECRET=<admin-app-client-secret>

# Admin Token Exchange Control
ff_admin_token_exchange=true

# Admin Token Configuration
ADMIN_TOKEN_LIFETIME=7200
ADMIN_REFRESH_TOKEN_LIFETIME=86400

# MCP Resource Configuration
mcp_resource_uri=https://mcp-server.pingdemo.com

# Admin Scope Configuration
ADMIN_SCOPES=admin:read admin:write admin:delete users:read users:manage banking:read banking:write
```

### 4.2 Frontend Configuration

Add admin detection logic to your React app:

```javascript
// src/services/adminService.js
export const isAdminUser = (session) => {
  const clientId = session?.oauthTokens?.clientId;
  const adminClientId = process.env.REACT_APP_ADMIN_CLIENT_ID;
  return clientId === adminClientId;
};

export const getAdminScopes = () => {
  return [
    'admin:read',
    'admin:write', 
    'admin:delete',
    'users:read',
    'users:manage',
    'banking:read',
    'banking:write'
  ];
};
```

---

## Phase 5: Admin-Only MCP Tools Setup

### 5.1 Configure MCP Tool Registry

Add admin-only tools to your MCP server:

```typescript
// banking_mcp_server/src/tools/adminTools.ts
export const adminTools = [
  {
    name: 'admin_list_all_users',
    description: 'List all users in the system (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: 'Optional filters for user list'
        }
      }
    },
    requiredScopes: ['admin:read', 'users:read']
  },
  {
    name: 'admin_get_user_details',
    description: 'Get detailed user information (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to retrieve'
        }
      },
      required: ['userId']
    },
    requiredScopes: ['admin:read', 'users:read']
  },
  {
    name: 'admin_delete_user',
    description: 'Delete a user account (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to delete'
        },
        reason: {
          type: 'string',
          description: 'Reason for deletion'
        }
      },
      required: ['userId']
    },
    requiredScopes: ['admin:write', 'admin:delete', 'users:manage']
  },
  {
    name: 'admin_manage_accounts',
    description: 'Manage user account settings (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to manage'
        },
        settings: {
          type: 'object',
          description: 'Account settings to update'
        }
      },
      required: ['userId']
    },
    requiredScopes: ['admin:write', 'users:manage']
  },
  {
    name: 'admin_view_audit_logs',
    description: 'View system audit logs (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: 'Filters for audit log search'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log entries'
        }
      }
    },
    requiredScopes: ['admin:read']
  },
  {
    name: 'admin_system_status',
    description: 'Get system health and status (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Specific component to check'
        }
      }
    },
    requiredScopes: ['admin:read']
  }
];
```

### 5.2 Update Tool Registration

Register admin tools with proper scope validation:

```typescript
// banking_mcp_server/src/registry.ts
export const registerAdminTools = () => {
  adminTools.forEach(tool => {
    mcpServer.addTool(tool.name, tool.description, tool.inputSchema, async (args) => {
      // Validate admin scopes before execution
      const hasRequiredScopes = validateAdminScopes(tool.requiredScopes);
      if (!hasRequiredScopes) {
        throw new Error('Insufficient admin privileges');
      }
      
      // Execute admin tool logic
      return await executeAdminTool(tool.name, args);
    });
  });
};
```

---

## Phase 6: Testing and Validation

### 6.1 Admin Login Test

1. **Test Admin Authentication**
   ```bash
   # Navigate to admin login
   curl -X GET "http://localhost:3000/admin/login"
   
   # Complete PKCE flow with admin credentials
   # Verify admin token contains required scopes
   ```

2. **Validate Admin Token**
   ```javascript
   // Check admin token claims
   const adminToken = getSessionBearerForMcp(req);
   const decoded = jwt.decode(adminToken);
   
   console.log('Admin token scopes:', decoded.scope);
   console.log('Admin token may_act:', decoded.may_act);
   console.log('Admin token client_id:', decoded.client_id);
   ```

### 6.2 Admin Token Exchange Test

1. **Test Token Exchange**
   ```bash
   # Exchange admin token for MCP token
   curl -X POST "https://auth.pingone.com/{envId}/as/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
     -d "subject_token=<admin-access-token>" \
     -d "audience=https://mcp-server.pingdemo.com" \
     -d "scope=admin:read admin:write users:read users:manage"
   ```

2. **Validate MCP Token**
   ```javascript
   // Check MCP token claims
   const mcpToken = exchangeResponse.access_token;
   const decoded = jwt.decode(mcpToken);
   
   console.log('MCP token audience:', decoded.aud);
   console.log('MCP token scopes:', decoded.scope);
   console.log('MCP token act claim:', decoded.act);
   ```

### 6.3 Admin Tool Execution Test

1. **Test Admin-Only Tools**
   ```bash
   # Call admin tool with MCP token
   curl -X POST "http://localhost:8080/tools/call" \
     -H "Authorization: Bearer <mcp-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "admin_list_all_users",
       "arguments": {}
     }'
   ```

2. **Verify Tool Access Control**
   - Test with regular user token (should fail)
   - Test with admin token (should succeed)
   - Verify audit logging for admin actions

---

## Phase 7: Security and Compliance

### 7.1 Audit Trail Setup

1. **Enable Admin Action Logging**
   ```javascript
   // banking_api_server/services/adminAuditService.js
   const logAdminAction = (action, adminSub, details) => {
     const auditEvent = {
       type: 'admin_action',
       timestamp: new Date().toISOString(),
       adminSub,
       action,
       details,
       ip: req.ip,
       userAgent: req.get('User-Agent')
     };
     
     writeExchangeEvent('admin_action', auditEvent);
   };
   ```

2. **Configure Audit Retention**
   - Set retention period for admin logs (recommended: 7 years)
   - Configure log rotation and storage
   - Set up audit log monitoring and alerts

### 7.2 Security Monitoring

1. **Admin Token Monitoring**
   ```javascript
   // Monitor admin token usage patterns
   const monitorAdminTokens = () => {
     // Track admin login frequency
     // Detect unusual admin activity
     // Alert on privilege escalation attempts
   };
   ```

2. **Session Security**
   - Implement session timeout for admin users
   - Require re-authentication for sensitive operations
   - Monitor concurrent admin sessions

### 7.3 Compliance Requirements

1. **SOX Compliance**
   - All admin actions must be logged
   - Segregation of duties enforced
   - Regular access reviews required

2. **GDPR Compliance**
   - Admin access to personal data logged
   - Data minimization principles applied
   - Right to audit trail for users

3. **PCI DSS Compliance**
   - Admin access to card data restricted
   - Multi-factor authentication required
   - Regular security assessments

---

## Phase 8: Troubleshooting

### 8.1 Common Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Admin token missing scopes** | 403 Forbidden on admin tools | Verify admin app has required scopes in PingOne |
| **Token exchange fails** | invalid_scope error | Check resource server configuration and scope mapping |
| **Admin tools not available** | Tools not listed in MCP registry | Verify admin tool registration and scope validation |
| **Audit logs missing** | No admin action records | Check audit service configuration and logging levels |

### 8.2 Debug Commands

1. **Check Admin Token Claims**
   ```bash
   # Decode admin token
   echo "<admin-token>" | cut -d. -f2 | base64 -d | jq
   ```

2. **Verify Resource Server Access**
   ```bash
   # Check resource server grants
   curl -H "Authorization: Bearer <admin-token>" \
     "https://api.pingone.com/{envId}/applications/{appId}/grants"
   ```

3. **Test MCP Token Exchange**
   ```bash
   # Test token exchange manually
   curl -X POST "https://auth.pingone.com/{envId}/as/token" \
     -u "<admin-client-id>:<admin-client-secret>" \
     -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
     -d "subject_token=<admin-token>" \
     -d "audience=https://mcp-server.pingdemo.com"
   ```

---

## Phase 9: Production Deployment

### 9.1 Production Configuration

1. **Environment Variables**
   ```bash
   # Production admin settings
   PINGONE_ADMIN_CLIENT_ID=${PINGONE_ADMIN_CLIENT_ID}
   PINGONE_ADMIN_CLIENT_SECRET=${PINGONE_ADMIN_CLIENT_SECRET}
   ff_admin_token_exchange=true
   
   # Enhanced security settings
   ADMIN_SESSION_TIMEOUT=1800
   ADMIN_MFA_REQUIRED=true
   ADMIN_AUDIT_LEVEL=high
   ```

2. **Security Headers**
   ```javascript
   // Add security headers for admin routes
   app.use('/admin', helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'", "'unsafe-inline'"],
         styleSrc: ["'self'", "'unsafe-inline'"]
       }
     }
   }));
   ```

### 9.2 Monitoring and Alerting

1. **Admin Activity Monitoring**
   - Set up alerts for unusual admin login patterns
   - Monitor failed admin authentication attempts
   - Track admin token usage and expiration

2. **Performance Monitoring**
   - Monitor admin token exchange latency
   - Track MCP tool execution performance
   - Set up alerts for admin service degradation

---

## Quick Reference

### Essential Environment Variables
```bash
PINGONE_ADMIN_CLIENT_ID=<admin-app-client-id>
PINGONE_ADMIN_CLIENT_SECRET=<admin-app-client-secret>
ff_admin_token_exchange=true
mcp_resource_uri=https://mcp-server.pingdemo.com
```

### Admin Scopes
```bash
admin:read admin:write admin:delete users:read users:manage banking:read banking:write
```

### Admin-Only Tools
```bash
admin_list_all_users
admin_get_user_details
admin_delete_user
admin_manage_accounts
admin_view_audit_logs
admin_system_status
```

### Feature Flags
```bash
ff_admin_token_exchange=true  # Enable admin token exchange
ff_skip_token_exchange=false   # Ensure token exchange is performed
ff_inject_may_act=false       # Use proper may_act from PingOne
```

---

## Support and Resources

- **PingOne Documentation**: [PingOne Developer Portal](https://developer.pingidentity.com/)
- **RFC 8693**: [OAuth Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- **Admin Token Issues**: Check PingOne application and resource server configuration
- **Security Questions**: Contact your security team for admin access policies

---

## Next Steps

After completing this setup:

1. **Test Admin Functionality** - Verify all admin tools work correctly
2. **Configure Audit Monitoring** - Set up alerts for admin activity
3. **Train Admin Users** - Provide documentation and training materials
4. **Regular Security Reviews** - Schedule periodic access reviews and audits
5. **Backup and Recovery** - Ensure admin configuration is backed up

This setup provides a secure, auditable foundation for administrative operations in the Super Banking demo while maintaining compliance with security best practices.
