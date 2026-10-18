// Setup text for the two real ID-JAG clients (mcpc, VS Code), shared by Guides and the playground.
// Secrets appear only as placeholders: $VARS for the shell, <NAMES> to paste.

export const mcpcCommand = ({ pfUrl, mcpUrl }) => `npx -y @apify/mcpc@0.7.0 login ${mcpUrl} --grant id-jag \\
  --idp ${pfUrl} --idp-client-id id-jag-mcpc --idp-client-secret "$MCPC_IDP_CLIENT_SECRET" \\
  --client-id id-jag-desktop --client-secret "$DESKTOP_RESOURCE_CLIENT_SECRET" --scope "read mcp:invoke"
npx -y @apify/mcpc@0.7.0 connect ${mcpUrl} @kit
npx -y @apify/mcpc@0.7.0 @kit tools-call whoami`;

export const vscodeSettings = ({ pfUrl }) => `"mcp.enterpriseManagedAuth.idp": {
  "issuer": "${pfUrl}",
  "clientId": "id-jag-vscode",
  "clientSecret": "<VSCODE_IDP_CLIENT_SECRET>"
}`;

export const vscodeMcpJson = ({ mcpUrl }) => `"servers": {
  "id-jag-kit": {
    "type": "http",
    "url": "${mcpUrl}",
    "oauth": { "clientId": "id-jag-desktop", "enterpriseManaged": true }
  }
}`;
