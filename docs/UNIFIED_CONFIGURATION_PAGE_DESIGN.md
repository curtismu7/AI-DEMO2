# Unified Configuration Page Design - Phase 64.1

## Executive Summary

This design document outlines the consolidation of the current `/config` and `/demo-data` pages into a unified configuration page that provides a consistent, user-friendly interface for all configuration needs.

**Design Date**: April 7, 2026  
**Scope**: Configuration page unification and user experience improvement  
**Current State**: Two separate configuration pages with overlapping functionality

## Current State Analysis

### 1. Existing Configuration Pages

#### 1.1 `/config` Page (Config.js)
- **Purpose**: System configuration and setup
- **Features**:
  - PingOne configuration (region, environment ID, client IDs)
  - Industry branding and presets
  - Agent UI mode settings
  - MCP scope configuration
  - Setup wizard integration
  - Vercel configuration
  - Worker app configuration
- **Access**: Requires authentication (admin role)
- **Structure**: Collapsible sections with tabs

#### 1.2 `/demo-data` Page (DemoDataPage.js)
- **Purpose**: Demo data management and presentation settings
- **Features**:
  - Demo scenario management
  - Account type configuration
  - Transaction data setup
  - Agent authentication demo modes
  - Industry branding
  - Education UI settings
  - Agent UI mode toggle
- **Access**: Publicly accessible (no auth required)
- **Structure**: Tabbed interface with vertical switcher

### 2. Issues Identified

#### 2.1 User Experience Issues
- **Duplicate functionality**: Both pages have industry branding and agent UI mode settings
- **Inconsistent UI**: Different design patterns and component usage
- **Navigation confusion**: Users don't know which page to use for specific settings
- **Access control inconsistency**: Some settings are public, others require auth

#### 2.2 Technical Issues
- **Code duplication**: Shared components and logic are duplicated
- **State management**: Inconsistent state handling between pages
- **Maintenance overhead**: Changes need to be made in multiple places
- **Testing complexity**: Duplicate functionality requires duplicate tests

#### 2.3 Content Issues
- **Unclear categorization**: Settings are not logically grouped
- **Missing context**: Users don't understand the relationship between settings
- **Incomplete documentation**: Some settings lack proper explanations

## Unified Configuration Page Design

### 1. Design Principles

#### 1.1 User-Centered Design
- **Single source of truth**: All configuration in one place
- **Contextual organization**: Settings grouped by purpose and user role
- **Progressive disclosure**: Show relevant settings based on context
- **Clear hierarchy**: Logical grouping and visual hierarchy

#### 1.2 Technical Principles
- **Component reusability**: Shared components for common functionality
- **Consistent state management**: Unified state handling approach
- **Accessibility**: WCAG 2.1 AA compliance
- **Responsive design**: Works on all device sizes

#### 1.3 Security Principles
- **Role-based access**: Settings shown based on user permissions
- **Secure defaults**: Safe default configurations
- **Audit trail**: Track configuration changes
- **Validation**: Client and server-side validation

### 2. Page Structure

#### 2.1 Overall Layout
```
Unified Configuration Page (/configure)
  - Header (breadcrumbs, save status, help)
  - Tab Navigation (context-based)
  - Main Content Area
    - Left Sidebar (navigation)
    - Right Content Panel (settings)
  - Footer (additional resources)
```

#### 2.2 Tab Structure
```typescript
interface ConfigurationTab {
  id: string;
  label: string;
  icon: string;
  description: string;
  requiresAuth: boolean;
  requiredRole?: 'admin' | 'user';
  sections: ConfigurationSection[];
}
```

#### 2.3 Tab Definitions
```typescript
const CONFIGURATION_TABS = [
  {
    id: 'quick-start',
    label: 'Quick Start',
    icon: 'rocket',
    description: 'Get started with basic configuration',
    requiresAuth: false,
    sections: ['pingone-basics', 'demo-data-setup', 'industry-branding']
  },
  {
    id: 'pingone-config',
    label: 'PingOne Setup',
    icon: 'shield',
    description: 'Configure PingOne authentication and services',
    requiresAuth: true,
    requiredRole: 'admin',
    sections: ['pingone-connection', 'oauth-flows', 'mfa-settings', 'token-exchange']
  },
  {
    id: 'demo-management',
    label: 'Demo Data',
    icon: 'database',
    description: 'Manage demo scenarios and test data',
    requiresAuth: false,
    sections: ['demo-scenarios', 'account-setup', 'transaction-data', 'agent-modes']
  },
  {
    id: 'agent-configuration',
    label: 'Agent Settings',
    icon: 'robot',
    description: 'Configure AI agent behavior and integration',
    requiresAuth: true,
    sections: ['agent-ui-mode', 'mcp-scopes', 'education-settings', 'token-chain']
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: 'settings',
    description: 'Advanced configuration and troubleshooting',
    requiresAuth: true,
    requiredRole: 'admin',
    sections: ['vercel-config', 'worker-app', 'debug-settings', 'api-keys']
  }
];
```

### 3. Component Architecture

#### 3.1 Main Component Structure
```typescript
// UnifiedConfigurationPage.tsx
interface UnifiedConfigurationPageProps {
  user: User | null;
  onLogout: () => void;
}

const UnifiedConfigurationPage: React.FC<UnifiedConfigurationPageProps> = ({
  user,
  onLogout
}) => {
  // State management
  const [activeTab, setActiveTab] = useState('quick-start');
  const [configState, setConfigState] = useState<ConfigurationState>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  // Logic for tab access control
  const accessibleTabs = useMemo(() => {
    return CONFIGURATION_TABS.filter(tab => {
      if (tab.requiresAuth && !user) return false;
      if (tab.requiredRole && user?.role !== tab.requiredRole) return false;
      return true;
    });
  }, [user]);

  return (
    <div className="unified-configuration-page">
      <ConfigurationHeader
        title="Configuration"
        subtitle="Manage your banking demo settings"
        saveStatus={saveStatus}
        onSave={handleSave}
      />
      
      <ConfigurationTabs
        tabs={accessibleTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      
      <ConfigurationContent
        tab={accessibleTabs.find(t => t.id === activeTab)}
        configState={configState}
        onConfigChange={setConfigState}
        user={user}
      />
      
      <ConfigurationFooter />
    </div>
  );
};
```

#### 3.2 Tab Component
```typescript
// ConfigurationTabs.tsx
interface ConfigurationTabsProps {
  tabs: ConfigurationTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const ConfigurationTabs: React.FC<ConfigurationTabsProps> = ({
  tabs,
  activeTab,
  onTabChange
}) => {
  return (
    <nav className="configuration-tabs" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`configuration-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
        >
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
          <span className="tab-description">{tab.description}</span>
        </button>
      ))}
    </nav>
  );
};
```

#### 3.3 Content Component
```typescript
// ConfigurationContent.tsx
interface ConfigurationContentProps {
  tab: ConfigurationTab | undefined;
  configState: ConfigurationState;
  onConfigChange: (updates: Partial<ConfigurationState>) => void;
  user: User | null;
}

const ConfigurationContent: React.FC<ConfigurationContentProps> = ({
  tab,
  configState,
  onConfigChange,
  user
}) => {
  if (!tab) return null;

  return (
    <div className="configuration-content">
      <div className="configuration-sidebar">
        <SectionNavigation
          sections={tab.sections}
          activeSection={configState.activeSection}
          onSectionChange={(section) => onConfigChange({ activeSection: section })}
        />
      </div>
      
      <div className="configuration-main">
        <SectionRenderer
          section={configState.activeSection || tab.sections[0]}
          configState={configState}
          onConfigChange={onConfigChange}
          user={user}
        />
      </div>
    </div>
  );
};
```

### 4. Section Organization

#### 4.1 Quick Start Section
```typescript
const QUICK_START_SECTIONS = [
  {
    id: 'pingone-basics',
    title: 'PingOne Basics',
    description: 'Essential PingOne configuration',
    component: PingOneBasicsSection,
    requiredAuth: false
  },
  {
    id: 'demo-data-setup',
    title: 'Demo Data Setup',
    description: 'Configure demo scenarios',
    component: DemoDataSetupSection,
    requiredAuth: false
  },
  {
    id: 'industry-branding',
    title: 'Industry Branding',
    description: 'Choose your industry theme',
    component: IndustryBrandingSection,
    requiredAuth: false
  }
];
```

#### 4.2 PingOne Setup Section
```typescript
const PINGONE_SETUP_SECTIONS = [
  {
    id: 'pingone-connection',
    title: 'Connection Settings',
    description: 'PingOne API connection configuration',
    component: PingOneConnectionSection,
    requiredAuth: true,
    requiredRole: 'admin'
  },
  {
    id: 'oauth-flows',
    title: 'OAuth Flows',
    description: 'Configure OAuth authentication flows',
    component: OAuthFlowsSection,
    requiredAuth: true,
    requiredRole: 'admin'
  },
  {
    id: 'mfa-settings',
    title: 'Multi-Factor Authentication',
    description: 'MFA configuration and policies',
    component: MFASettingsSection,
    requiredAuth: true,
    requiredRole: 'admin'
  },
  {
    id: 'token-exchange',
    title: 'Token Exchange',
    description: 'RFC 8693 token exchange settings',
    component: TokenExchangeSection,
    requiredAuth: true,
    requiredRole: 'admin'
  }
];
```

### 5. State Management

#### 5.1 Configuration State Structure
```typescript
interface ConfigurationState {
  // PingOne Configuration
  pingoneRegion: string;
  pingoneEnvironmentId: string;
  pingoneClientId: string;
  pingoneWorkerClientId: string;
  
  // Demo Data Configuration
  demoScenario: string;
  accountTypes: AccountTypeConfig[];
  transactionData: TransactionDataConfig;
  agentAuthDemoMode: string;
  
  // Agent Configuration
  agentUiMode: string;
  mcpScopes: string[];
  educationSettings: EducationConfig;
  tokenChainSettings: TokenChainConfig;
  
  // Industry Branding
  industryId: string;
  customBranding: CustomBrandingConfig;
  
  // Advanced Configuration
  vercelConfig: VercelConfig;
  workerAppConfig: WorkerAppConfig;
  debugSettings: DebugConfig;
  
  // UI State
  activeSection: string;
  validationErrors: Record<string, string[]>;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}
```

#### 5.2 State Management Strategy
```typescript
// ConfigurationContext.tsx
interface ConfigurationContextValue {
  state: ConfigurationState;
  updateState: (updates: Partial<ConfigurationState>) => void;
  saveConfiguration: () => Promise<void>;
  resetConfiguration: () => void;
  validateSection: (sectionId: string) => ValidationResult;
}

const ConfigurationProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [state, setState] = useState<ConfigurationState>(getDefaultState());
  
  const updateState = useCallback((updates: Partial<ConfigurationState>) => {
    setState(prevState => ({ ...prevState, ...updates }));
  }, []);
  
  const saveConfiguration = useCallback(async () => {
    setState(prev => ({ ...prev, saveStatus: 'saving' }));
    
    try {
      await saveConfigurationToServer(state);
      setState(prev => ({ ...prev, saveStatus: 'saved' }));
    } catch (error) {
      setState(prev => ({ ...prev, saveStatus: 'error' }));
      throw error;
    }
  }, [state]);
  
  const validateSection = useCallback((sectionId: string) => {
    return validateConfigurationSection(state, sectionId);
  }, [state]);
  
  return (
    <ConfigurationContext.Provider value={{
      state,
      updateState,
      saveConfiguration,
      resetConfiguration: () => setState(getDefaultState()),
      validateSection
    }}>
      {children}
    </ConfigurationContext.Provider>
  );
};
```

### 6. Migration Strategy

#### 6.1 Phase 1: Design and Structure
- [ ] Create unified configuration page component structure
- [ ] Define configuration state management
- [ ] Create reusable configuration components
- [ ] Implement tab navigation and section organization

#### 6.2 Phase 2: Core Functionality Migration
- [ ] Migrate PingOne configuration from Config.js
- [ ] Migrate demo data management from DemoDataPage.js
- [ ] Consolidate industry branding functionality
- [ ] Implement unified agent configuration

#### 6.3 Phase 3: Advanced Features
- [ ] Add validation and error handling
- [ ] Implement configuration import/export
- [ ] Add configuration history and rollback
- [ ] Implement access control and permissions

#### 6.4 Phase 4: Integration and Testing
- [ ] Update routing and navigation
- [ ] Migrate existing user preferences
- [ ] Implement comprehensive testing
- [ ] Update documentation and help content

### 7. User Experience Improvements

#### 7.1 Progressive Disclosure
- Show only relevant settings based on user role and context
- Use collapsible sections for advanced options
- Provide contextual help and documentation links
- Implement search functionality for settings

#### 7.2 Visual Design
- Consistent styling with existing design system
- Clear visual hierarchy and grouping
- Responsive design for mobile devices
- Accessibility compliance (WCAG 2.1 AA)

#### 7.3 Interaction Design
- Auto-save functionality for non-critical settings
- Clear save status indicators
- Undo/redo functionality for configuration changes
- Keyboard navigation support

### 8. Technical Implementation

#### 8.1 Component Structure
```
src/components/Configuration/
  - UnifiedConfigurationPage.tsx
  - ConfigurationHeader.tsx
  - ConfigurationTabs.tsx
  - ConfigurationContent.tsx
  - ConfigurationSidebar.tsx
  - sections/
    - PingOneBasicsSection.tsx
    - DemoDataSetupSection.tsx
    - IndustryBrandingSection.tsx
    - OAuthFlowsSection.tsx
    - MFASettingsSection.tsx
    - TokenExchangeSection.tsx
    - AgentConfigurationSection.tsx
    - AdvancedSettingsSection.tsx
  - shared/
    - ConfigurationField.tsx
    - ConfigurationSection.tsx
    - ValidationMessage.tsx
    - SaveIndicator.tsx
```

#### 8.2 Routing Changes
```typescript
// App.js - Update routing
<Route path="/configure" element={
  <main className="main-content">
    <EducationBar />
    <UnifiedConfigurationPage user={user} onLogout={logout} />
  </main>
} />

// Legacy routes for backward compatibility
<Route path="/config" element={<Navigate to="/configure?tab=pingone-config" replace />} />
<Route path="/demo-data" element={<Navigate to="/configure?tab=demo-management" replace />} />
```

#### 8.3 State Persistence
```typescript
// Configuration persistence strategy
const saveConfigurationToServer = async (config: ConfigurationState) => {
  // Save user-specific settings
  if (user) {
    await apiClient.post('/api/config/user', config);
  }
  
  // Save public settings
  await apiClient.post('/api/config/public', config);
  
  // Save to localStorage for immediate feedback
  localStorage.setItem('banking-demo-config', JSON.stringify(config));
};
```

### 9. Success Criteria

#### 9.1 User Experience Criteria
- [ ] Single page for all configuration needs
- [ ] Intuitive navigation and organization
- [ ] Clear visual hierarchy and grouping
- [ ] Responsive design on all devices
- [ ] Accessibility compliance (WCAG 2.1 AA)

#### 9.2 Technical Criteria
- [ ] Consolidated codebase with reduced duplication
- [ ] Consistent state management
- [ ] Comprehensive validation and error handling
- [ ] Backward compatibility with existing configurations
- [ ] Performance optimization for large configurations

#### 9.3 Business Criteria
- [ ] Reduced support requests for configuration issues
- [ ] Improved user satisfaction with configuration experience
- [ ] Easier maintenance and updates
- [ ] Better onboarding experience for new users

## Conclusion

The unified configuration page design provides a comprehensive solution to the current fragmentation and inconsistency issues. By consolidating `/config` and `/demo-data` into a single, well-organized interface, we can significantly improve the user experience while reducing technical complexity and maintenance overhead.

**Next Steps**: Begin implementation of Phase 64.1 with the unified configuration page component structure and state management.

---

**Status**: Phase 64.1 design completed  
**Next Action**: Implement unified configuration page component  
**Target Completion**: May 26, 2026
