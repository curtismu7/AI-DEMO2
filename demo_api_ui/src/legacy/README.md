# src/legacy — archived, not bundled

Components with zero live importers, moved out of `components/` in October 2026
to leave one master frontend (see the vertical-branding Stage 2 work). Nothing
imports these; Vite never bundles them; the tests here were moved with their
components and keep passing against the local copies.

Restore one: `git mv` it back into `components/` and re-point its importer —
these files are frozen as they were, not reworked.

| File | What it was |
|---|---|
| ChaseTopNav | Chase-branded top-nav experiment, superseded by TopNav + vertical manifests |
| AuthButton | old sign-in button, replaced by the pi.flow modal entry points |
| CustomChipsTab | config tab whose feature shipped inside UnifiedConfigurationPage |
| DashboardQuickNav | quick-nav rail, superseded by AdminSideNav |
| DemoSetupPanel | setup wizard panel folded into PingOneSetup |
| EditableSticky | inline-edit widget without a remaining consumer |
| MFALogsModal / MigrationPanel / OAuthHealthDashboard / RunServersModal | admin panels superseded by the unified admin surfaces |
| McpInspectorSetupWizard | inspector onboarding folded into its page |
| SessionExpiryTimer | superseded by the timer in agentChrome.js |
