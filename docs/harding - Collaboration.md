# Collaboration

## Product Team Action Items

- Implement support for IDJAG (JWT Secured Authorization Grant) in PingOne and PingFederate (both as OAuth AS and RP)
- Develop agent registry functionality for storing and managing agent credentials and public keys
- Implement token vaulting functionality for managing API keys and client secrets
- Add support for transaction token standard in products
- Implement support for agent credential management including private keys
- Develop integration between agent registry and runtime engines for centralized agent management
- Add support for MCP elicitation functionality
- Implement support for prompt validation in Authorize

---

## Summary

### Technical Meeting Setup Challenges

The meeting began with technical difficulties as participants joined and some experienced connectivity issues. Glen accidentally sent a meeting invite to the wrong people but corrected it before starting the walkthrough with Patrick Harding. The team discussed preparing to record the session and share diagrams, with Curtis taking responsibility for sharing the diagram in Lucid. Patrick mentioned he was late due to internet issues while presenting in Milan, Italy, and acknowledged being a source of disruption in previous discussions about paying products and cloud provider decisions.

### MCP Gateway Architecture Decisions

Curtis and Patrick discussed the architecture decisions made for the MCP Gateway system, including the placement of token validation and authorization processes. Patrick explained that the MCP Gateway functions as a reverse proxy with a tight trust relationship to the MCP server, handling token validation and fine-grained authorization through Ping Authorize before passing the token unchanged to the MCP server. The team clarified that token exchange occurs at the gateway level, with the MCP server trusting the validated token without performing additional validation.

### Gateway Token Exchange Implementation

The team discussed token exchange approaches for gateway implementation, with Patrick advocating for the simplest approach that would use a single token exchange at the gateway rather than showing multiple exchanges to customers. They noted that AWS and GCP take a different approach by exposing a single MCP server endpoint, which Patrick considered problematic. The discussion clarified that while there would still be token exchanges happening, they would be contained within the gateway, with Patrick distinguishing between OAuth token exchange and API key access for downstream services.

### Token Exchange System Implementation

Patrick discussed the implementation of token exchange in their system architecture, explaining that it would be needed when an actor needs to interact with another service. He expressed concerns about adding complexity and latency through widespread token exchange implementation. Patrick also explained that transaction tokens are designed to be broadly used across multiple services, which raises questions about whether scopes should be set at token issuance or handled through Ping Authorize at the gateway level.

### OAuth Scopes System Discussion

Patrick questioned the value of scopes in the current system, arguing they create confusion and complexity without clear benefits. Chris explained that scopes emerge through a two-way process between the initial prompt and tool authorization, which isn't well represented in the current diagram. Patrick suggested making token audiences broad to avoid multiple token requests and proposed that authorization decisions should be made at the tool level based on the prompt in the transaction token. Paul confirmed his current POCs only check basic token validation criteria and don't involve scope verification. Steven asked about refactoring scope-oriented APIs, but Patrick indicated that scopes weren't commonly used in service-to-service interactions within organizations and suggested existing APIs likely don't rely on OAuth scopes.

### Transaction Token Implementation Strategy

The team discussed implementing transaction tokens and authorization mechanisms in their system. Patrick explained that transaction tokens, while still in draft form, could help build their value proposition around Ping and authorization, and could include rich authorization information and user-driven data. The group aligned on using a one-to-one mapping between scopes and tools, with enforcement happening either in the gateway or through Authorize. They also discussed the need for agent credential management, including the potential use of SPKI and ID JAG tokens, though Patrick noted that ID JAG support would need to be implemented in PingOne. The team identified several missing pieces in their current implementation, including an agent registry and token vaulting capabilities, with Patrick emphasizing the need to catch up to competitors like Okta who are already implementing these features.
