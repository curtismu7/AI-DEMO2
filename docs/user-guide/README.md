# User Guide Documentation

> A multi-vertical demonstration of how PingOne secures AI agents — real OAuth, RFC 8693 token exchange, HITL consent, and step-up MFA — visualised live in the browser. The default skin is **Super Banking**; other verticals (healthcare, retail, workforce, sporting-goods, plus a shared admin-console overlay) reuse the same security pipeline.

This folder is the user-facing documentation index. Architecture docs live one level up in `../`.

## Getting Started

- **[Setup Guide](SETUP.md)** — Install prerequisites and run the demo locally
- **[Getting Started](getting-started.md)** — First-run walkthrough
- **[User Guide](USER_GUIDE.md)** — Using the app as an end user
- **[App Overview](APP_OVERVIEW.md)** — All 13 services and how they fit together

## Features & Demo

- **[Features](FEATURES.md)** — Capability matrix across all verticals
- **[Agent Showcase Demo Scenarios](AGENT_SHOWCASE_DEMO_SCENARIOS.md)** — Scripted demo walkthroughs

## Configuration

- **[Environment Variables](ENV_VARS.md)** — Single source of truth for all configuration
- **[PingOne Configuration](PINGONE_CONFIG.md)** — Client IDs, resource servers, scopes, may_act rules
- **[Helix / Ping AI Setup](helix-setup.md)** — Configure the default LLM provider

## MFA

- **[MFA Setup Guide](MFA_SETUP_GUIDE.md)** — Configure multi-factor authentication
- **[MFA User Setup](MFA_USER_SETUP.md)** — Enrolling a user device for MFA

## Operations

- **[Development](development.md)** — Local development workflow
- **[Deployment](deployment.md)** — Deploying the demo (Docker and Kubernetes ship today)
- **[Error Codes & Remediation](ERROR_CODES_AND_REMEDIATION.md)** — Troubleshooting reference

## Postman

- **[Postman Guide](POSTMAN-GUIDE.md)** — Using the Postman collections
- **[Postman Collections Guide](POSTMAN_COLLECTIONS_GUIDE.md)** — Collection contents and usage
- **[Postman Collections README](POSTMAN_COLLECTIONS_README.md)** — Collection overview

## Architecture (one level up)

- **[Architecture](../ARCHITECTURE.md)** — System architecture and components
- **[Service Topology](../SERVICE_TOPOLOGY.md)** — Service map, ports, and traffic flow
- **[Security Architecture](../SECURITY_ARCHITECTURE.md)** — Token custody, delegation, and authorization model
