# Postman Collections Guide

## Overview

This guide provides comprehensive instructions for using the Super Banking Postman collections, supporting both developer and workshop audiences. All collection and environment files live in [`docs/`](../) (relative to this file: `../<filename>`).

## Collections

### 1. Super Banking - 1-Exchange Step-by-Step (RFC 8693)
**Purpose**: Educational collection for learners and workshop participants  
**Audience**: Beginners, workshop attendees, developers learning token exchange

**Structure**:
- Step 1: Subject Token (Headless PKCE via pi.flow) - 4 sub-steps
- Step 2: MCP Token (RFC 8693 Token Exchange #1)
- Step 3: PingOne API Token (Client Credentials)
- Step 4: User Lookup (PingOne Management API)
- Utility: Decode Token (paste any JWT)
- Utility: Set mayAct on User (PATCH)

### 2. Super Banking - 1-Exchange Delegated Chain - pi.flow
**Purpose**: Production-ready collection for developers  
**Audience**: Experienced developers, production testing

**Structure**:
- Steps 1-7: Complete token chain in single requests
- Utilities: Token introspection and management

### 3. Super Banking - 2-Exchange Delegated Chain - pi.flow
**Purpose**: Advanced 2-exchange pattern testing  
**Audience**: Advanced developers, production scenarios

**Structure**:
- Steps 1-8: Two-exchange delegation chain
- Advanced utilities and monitoring

### 4. Super Banking - Advanced Utilities
**Purpose**: Advanced testing and debugging utilities  
**Audience**: Developers, DevOps, security teams

**Structure**:
- PAZ Policy Decision testing
- Token Revocation
- BFF API monitoring
- Exchange mode management

## Environment Setup

### Required Environment Files
1. **Super-Banking-Shared.postman_environment.json** - Main environment
2. **Super-Banking-Vercel.postman_environment.json** - Example/legacy Vercel environment (Vercel is not the current deploy path; kept for reference)

### Environment Variables

#### Core Variables (Both Collections)
```json
{
  "PINGONE_ENVIRONMENT_ID": "your-env-id",
  "PINGONE_REGION": "com",
  "PINGONE_CORE_USER_CLIENT_ID": "user-app-client-id",
  "PINGONE_CORE_CLIENT_ID": "banking-app-client-id",
  "PINGONE_CORE_CLIENT_SECRET": "banking-app-client-secret",
  "MCP_CLIENT_ID": "mcp-service-client-id",
  "MCP_CLIENT_SECRET": "mcp-service-client-secret",
  "ENDUSER_AUDIENCE": "enduser.ping.demo",
  "MCP_RESOURCE_URI": "mcpserver.ping.demo",
  "PINGONE_API_AUDIENCE": "https://api.pingone.com"
}
```

#### Test User Variables (Step-by-Step Collection)
```json
{
  "TEST_USERNAME": "test.user@example.com",
  "TEST_PASSWORD": "user-password"
}
```

#### Advanced Variables (Advanced Utilities)
```json
{
  "PAZ_DECISION_ENDPOINT_ID": "paz-endpoint-uuid",
  "mcp_exchanged_token": "runtime-variable",
  "token_to_revoke": "paste-token-here"
}
```

## Usage Instructions

### For Workshop Participants (Beginners)

1. **Import Collections**
   - Import "Super Banking - 1-Exchange Step-by-Step"
   - Import "Super-Banking-Shared.postman_environment.json"

2. **Setup Environment**
   - Fill in all required variables in the environment
   - Set TEST_USERNAME and TEST_PASSWORD

3. **Run Step-by-Step**
   - Run Step 1 sub-steps in order: 1a -> 1b -> 1c -> 1d
   - Run Step 2 (Token Exchange)
   - Run Step 3 (Client Credentials)
   - Run Step 4 (User Lookup)

4. **Use Utilities**
   - Run "Utility - Set mayAct on User" if Step 2 fails
   - Use "Utility - Decode Token" to inspect any token

### For Developers (Production Testing)

1. **Import Collections**
   - Import "Super Banking - 1-Exchange Delegated Chain - pi.flow"
   - Import "Super Banking - Advanced Utilities"
   - Import appropriate environment file

2. **Setup Environment**
   - Configure all production variables
   - Set up PAZ decision endpoint for advanced testing

3. **Run Complete Flow**
   - Run Steps 1-7 sequentially
   - Use Advanced Utilities for debugging and monitoring

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. "may_act missing" Error
**Cause**: User's mayAct attribute not set  
**Solution**: Run "Utility - Set mayAct on User" after Step 3

#### 2. "invalid_scope" Error
**Cause**: Resource server not configured with required scopes  
**Solution**: Check PingOne resource server configuration

#### 3. "authorization_pending" in CIBA
**Cause**: User hasn't approved the authentication request  
**Solution**: Check user's email/device for approval prompt

#### 4. "Token validation failed"
**Cause**: Incorrect audience or expired token  
**Solution**: Verify ENDUSER_AUDIENCE and MCP_RESOURCE_URI variables

### Debugging Steps

1. **Check Environment Variables**
   - Ensure all required variables are set
   - Verify no trailing spaces or special characters

2. **Use Token Decoder Utility**
   - Decode tokens at each step to verify claims
   - Check aud, sub, and may_act claims

3. **Check PingOne Console**
   - Verify resource server configuration
   - Check application permissions
   - Review user attributes

4. **Use Advanced Utilities**
   - Run PAZ Policy Decision to test token validation
   - Use BFF monitoring endpoints to check system status

## Best Practices

### For Workshop Settings
1. **Pre-configure Environment**: Set up environment files before workshop
2. **Use Test Users**: Create dedicated test users with proper attributes
3. **Clear Sessions**: Clear cookies between test runs
4. **Document Steps**: Provide step-by-step instructions

### For Development
1. **Version Control**: Track collection changes in git
2. **Automation**: Use collections in CI/CD pipelines
3. **Monitoring**: Integrate with logging and monitoring
4. **Security**: Never commit secrets to version control

### For Production
1. **Rate Limiting**: Be aware of PingOne API rate limits
2. **Token Management**: Implement proper token refresh and revocation
3. **Error Handling**: Build robust error handling in applications
4. **Audit Trail**: Maintain comprehensive audit logs

## Collection Maintenance

### Regular Updates
1. **Update URLs**: Keep endpoint URLs current
2. **Refresh Documentation**: Update descriptions and instructions
3. **Test Scripts**: Verify test scripts work with latest APIs
4. **Environment Variables**: Add new variables as features are added

### Version Control
1. **Semantic Versioning**: Use version numbers for collection updates
2. **Change Log**: Document changes between versions
3. **Backward Compatibility**: Maintain compatibility when possible
4. **Migration Guides**: Provide upgrade instructions

## Integration with Development Workflow

### CI/CD Integration
```bash
# Example: Run Postman collections in CI
newman run "docs/Super-Banking-1-Exchange-Step-by-Step.postman_collection.json" \
  --environment "docs/Super-Banking-Shared.postman_environment.json" \
  --reporters cli,junit \
  --reporter-junit-export "test-results.xml"
```

### Local Development
```bash
# Example: Run collections with Newman CLI
newman run "docs/Super-Banking-Advanced-Utilities.postman_collection.json" \
  --environment "docs/Super-Banking-Shared.postman_environment.json" \
  --globals "globals.json"
```

## Security Considerations

### Token Security
1. **Never Log Tokens**: Avoid logging sensitive token data
2. **Secure Storage**: Use secure storage for environment variables
3. **Token Expiration**: Monitor token expiration times
4. **Revocation**: Implement proper token revocation procedures

### API Security
1. **HTTPS Only**: Always use HTTPS endpoints
2. **Certificate Validation**: Verify SSL certificates
3. **Input Validation**: Validate all inputs and parameters
4. **Access Control**: Implement proper access controls

## Performance Optimization

### Collection Performance
1. **Parallel Execution**: Run independent requests in parallel
2. **Caching**: Cache frequently used data
3. **Batch Operations**: Use batch operations where possible
4. **Timeouts**: Set appropriate timeouts for requests

### Environment Optimization
1. **Variable Reuse**: Reuse variables across collections
2. **Environment Switching**: Use environment switching for different setups
3. **Global Variables**: Use global variables for shared data
4. **Dynamic Variables**: Use scripts for dynamic variable generation

## Support and Resources

### Documentation
- [PingOne API Documentation](https://apidocs.pingidentity.com/pingone/platform/v1/api/)
- [RFC 8693 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [RFC 8707 Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707)
- [Super Banking Architecture Guide](../SUPER_BANKING_ARCHITECTURE_GUIDE.md)

### Tools and Utilities
- [Postman Desktop](https://www.postman.com/downloads/)
- [Newman CLI](https://learning.postman.com/docs/postman/collections/using-newman-cli/)
- [JWT Decoder](https://jwt.io/)
- [PingIdentity JWT Decoder](https://developer.pingidentity.com/en/tools/jwt-decoder.html)

### Community Support
- [PingOne Community](https://community.pingidentity.com/)
