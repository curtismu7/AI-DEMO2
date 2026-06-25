# PingOne Application Organization Guide

## Overview

PingOne provides distinct application groups to help organize and manage different types of applications. This guide explains the recommended organization for the Super Banking banking demo applications.

## Application Groups

### AI Agents Group

Applications that represent AI agents, MCP services, and automated systems should be organized under the **AI Agents** group.

#### Applications in AI Agents Group:

| Application Name | Client ID | Purpose | Type |
|------------------|------------|---------|------|
| **Super Banking AI Agent App** | `80145519` | OIDC application for AI agent identity in 2-exchange delegation | Web App |
| **Super Banking MCP Service** | `d98f4336` | MCP service application for token exchange | Web App |
| **Super Banking MCP ServiceV1** | `bdf0fa76` | Introspection service application for token validation | Worker |

#### Why AI Agents Group?

- **Clear Identity**: Distinguishes AI systems from human user applications
- **Policy Management**: Enables applying specific policies to AI-related applications
- **Audit Clarity**: Makes it easy to identify AI vs human activities in logs
- **Demo Presentation**: Clear separation when demonstrating to stakeholders

### Applications Group

User-facing OIDC applications should remain under the standard **Applications** group.

#### Applications in Applications Group:

| Application Name | Client ID | Purpose | Type |
|------------------|------------|---------|------|
| **Super Banking User** | `5df1fbdb` | End-user authentication application | Web App |
| **Super Banking App** | `949a748e` | Banking web application interface | Web App |
| **Super Banking User App** | - | User authentication application | Web App |
| **Super Banking Admin App** | `14cefa5b-d9d6-4e51-8749-e938d4edd1c0` | Admin authentication application | Web App |

#### Why Applications Group?

- **User Focus**: Groups applications that humans interact with directly
- **Traditional Organization**: Follows standard OIDC application patterns
- **Access Control**: Enables user-centric access policies
- **Compliance**: Aligns with typical enterprise application organization

## Setup Instructions

### Step 1: Access PingOne Console

1. Log into PingOne console
2. Navigate to environment `d02d2305`
3. Go to **Applications → Applications** or **Applications → AI Agents**

### Step 2: Move Applications to AI Agents Group

For each AI-related application:

1. **Select the application**:
   - `Super Banking AI Agent App` (`80145519`)
   - `Super Banking MCP Service` (`d98f4336`)
   - `Super Banking MCP ServiceV1` (`bdf0fa76`)

2. **Click "Edit"** or the pencil icon

3. **In the "General" tab**:
   - Verify the application details
   - Ensure the application type is correct (Web App or Worker)

4. **Save the application** - it will remain in its current group but be properly categorized

### Step 3: Verify Applications Group

Ensure user-facing applications remain in the **Applications** group:

1. **Super Banking User** (`5df1fbdb`)
2. **Super Banking App** (`949a748e`)
3. **Super Banking User App**
4. **Super Banking Admin App**

### Step 4: Validate Configuration

1. **Test authentication flows** to ensure moving between groups doesn't break functionality
2. **Verify token exchange** works correctly with the new organization
3. **Check logs** to confirm proper application identification

## Best Practices

### When Creating New Applications

#### AI-Related Applications
- Use the **AI Agents** group for:
  - AI agent identity applications
  - MCP service applications
  - Automated system applications
  - Bot and automation applications

#### User-Facing Applications
- Use the **Applications** group for:
  - Human user authentication
  - Web applications
  - Mobile applications
  - Admin interfaces

### Naming Conventions

Follow these naming patterns for consistency:

#### AI Agents Group
- `Super Banking AI Agent App` - AI agent identities
- `Super Banking MCP Service` - MCP service applications
- `Super Banking Automation Service` - Other automated services

#### Applications Group
- `Super Banking User` - End-user applications
- `Super Banking App` - Main application interfaces
- `Super Banking Admin App` - Administrative interfaces

### Documentation Updates

When adding new applications:

1. **Update this guide** with the new application details
2. **Update relevant setup documentation** with group information
3. **Update environment configuration** files if needed
4. **Update architecture diagrams** to reflect organization

## Troubleshooting

### Common Issues

#### Application Not Visible in Expected Group
- **Check**: Application type and configuration
- **Solution**: Ensure application is properly categorized in PingOne

#### Token Exchange Issues
- **Check**: Application group doesn't affect token behavior
- **Solution**: Verify client IDs and configurations are correct

#### Policy Application Problems
- **Check**: Group-specific policies
- **Solution**: Review policy assignments per group

### Validation Steps

1. **Console Organization**: Verify applications appear in correct groups
2. **Authentication Testing**: Test all authentication flows
3. **Token Exchange**: Validate RFC 8693 token exchange works
4. **Log Analysis**: Check application identification in logs

## Impact Analysis

### What Changes When Moving Between Groups

#### **No Functional Impact**
- **Token Behavior**: Moving between groups doesn't affect token issuance or validation
- **Authentication**: All authentication flows continue to work normally
- **API Integration**: No impact on API calls or integrations

#### **Organizational Benefits**
- **Clarity**: Easier to understand application purposes
- **Management**: Simplified policy and permission management
- **Audit**: Clear distinction between AI and human activities

#### **Demo Presentation**
- **Stakeholder Clarity**: Easier to explain application architecture
- **Visual Organization**: Cleaner console presentation
- **Professional Appearance**: Better organized for demonstrations

## Maintenance

### Ongoing Tasks

1. **Regular Reviews**: Periodically review application organization
2. **New Applications**: Ensure new applications follow grouping guidelines
3. **Documentation Updates**: Keep this guide current with application changes
4. **Training**: Educate team members on organization standards

### Review Checklist

- [ ] All AI-related applications in AI Agents group
- [ ] All user-facing applications in Applications group
- [ ] Documentation reflects current organization
- [ ] Setup guides include group information
- [ ] No authentication or token exchange issues

## References

- [PingOne Documentation: Application Groups](https://docs.pingidentity.com/pingone/p1_cloud__platform_main_landing_page.html)
- [Super Banking Architecture Overview](ARCHITECTURE_WALKTHROUGH.md)
- [PingOne Token Exchange Setup](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md)
- [PingOne Two-Exchange Setup](PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md)
