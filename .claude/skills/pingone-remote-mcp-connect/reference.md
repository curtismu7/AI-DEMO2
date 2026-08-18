# Connect to the PingOne Remote MCP Server (source)

Verbatim onboarding text from Ping Identity (saved for skill reference).

---

**Connect to the PingOne Remote MCP Server**

You will need a feature flag to use the remote MCP server, if you do not have it enabled contact [Amit Ben-Chanoch](mailto:amitben-chanoch@pingidentity.com) or [Nathan Langton](mailto:nlangton@pingidentity.com) or [Saparja Dey](mailto:sdey@pingidentity.com)

**Setup a worker app**

The PingOne MCP Server requires a worker application to authenticate with the PingOne APIs.

1. In the [PingOne admin console](https://admin.pingone.com/), select the environment where you want to connect. This should be where your administrator identity lives.
2. Click **Applications** > **Applications** in the left navigation menu.
3. Click **+ Add Application** and select **Worker**.
   - Enter the following:
     - **Name:** For example, PingOne MCP Server.
     - **Description:** Optional.
   - Click **Save**.
   - Enable the application using the toggle at the top right of the details panel.
4. On the **Configuration** tab, click the **Edit** icon and set:
   - **Grant Types:** Authorization Code, Refresh Token
   - **Response Type:** Code
   - **PKCE Enforcement:** S256_REQUIRED
   - **Redirect URIs:** http://127.0.0.1:7474/callback
     - **For VS Code, use a Redirect URI Pattern:** http://127.0.0.1/*
   - **Token Endpoint Authentication Method:** None (Public Client)
5. Click **Save**.
6. Copy the **Client ID** from the **Configuration** tab.

**Claude code**

NA Example  
Replace your worker app clientID and environment ID and paste in terminal

```bash
claude mcp add --transport http --client-id {clientId} --callback-port 7474 pingone https://mcp.pingone.com/admin/{envId}/mcp
```

**Github Copilot**

⚠️ **FAQ**

1. **Using PingOne Remote MCP with existing PingOne and DaVinci Local MCPs.**

   To avoid conflicts, ensure that any existing "PingOne" or "DaVinci" Local MCP servers set up in the same directory are disabled.

2. **What Roles should be assigned to the user to view all the tools of PingOne Remote MCP Server?**

   The specific tools available to you within the PingOne Remote MCP Server are determined by your assigned Admin Role.  
   To ensure you have full admin visibility:

   - **For PingOne tools**: Assign the "Environment Admin" role.
   - **For DaVinci tools**: Assign either the "DaVinci Admin" role.

3. **Modify the administrative roles for the account used during authentication.**

   If you update the Admin roles for the user connected to the Remote MCP Server, you must perform a reconnection to make the revised list of tools visible.
