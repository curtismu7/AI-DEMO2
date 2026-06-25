### **Follow this page until you get down to  the tutorial section:** [**https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html**](https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html)

You’ll also need to update these two files after you download the sample agent:  
 [sample-mcp-agent.py](https://drive.google.com/file/d/1DFjCxKQkQhZkAhkDPlznYwTlbwS3uftT/view?usp=sharing)  
[README.md](https://drive.google.com/file/d/1Aa5y4DKRe54uTMW-SVBSN4hLIuxzmTMn/view?usp=sharing)

### **New stuff:**

### **Tutorial task 1: Before you begin**

* Prepare and test the sample MCP and agent software as described in [Preparation](https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html#preparation).  
* Install and configure PingGateway as described in [Get Started](https://docs.pingidentity.com/pinggateway/2025.11/getting-started/preface.html) (setting up the sample application not required for this tutorial).  
* Configure PingGateway for server side SSL (**ig.example.com:8443**) with a self-signed certificate as described in [Configure PingGateway for TLS (server-side)](https://docs.pingidentity.com/pinggateway/2025.11/installation-guide/securing-connections.html#server-side-tls).  
  1. Example .openig/config/admin.json file for SSL (user “macuser” with secrets folder /Users/macuser/.openig/secrets containing self signed certificate for ig.example.com):

```
{
  "adminConnector": {
    "host": "localhost",
    "port": 8085
  },
  "connectors": [
    {
      "port": 8080
    },
    {
      "port": 8443,
      "tls": "ServerTlsOptions-1"
    }
  ],
  "streamingEnabled": true,
  "heap": [
    {
      "name": "ServerTlsOptions-1",
      "type": "ServerTlsOptions",
      "config": {
        "keyManager": {
          "type": "SecretsKeyManager",
          "config": {
            "signingSecretId": "key.manager.secret.id",
            "secretsProvider": "ServerIdentityStore"
          }
        }
      }
    },
    {
      "name": "ServerIdentityStore",
      "type": "FileSystemSecretStore",
      "config": {
        "format": "PLAIN",
        "directory": "/Users/macuser/.openig/secrets",
        "suffix": ".pem",
        "mappings": [{
          "secretId": "key.manager.secret.id",
          "format": {
            "type": "PemPropertyFormat"
          }
        }]
      }
    }
  ]
}

```

* Make sure you can access your PingOne tenant as an administrator.  
* Create a PingOne test environment and user as described in [PingGateway and PingOne](https://docs.pingidentity.com/pinggateway/2025.11/pingone/preface.html).

**Tutorial task 2: Prepare PingOne as the AS**

1. Sign on to the PingOne test environment admin console as an administrator.  
2. In the test environment, **Resources** with the following values:  
   * **Resource Name**: test  
     1. **Audience**: [https://ig.example.com:8443/mcp](https://ig.example.com:8443/mcp)   
     2. Click **Next**   
     3. Click the gears icon in the sub attribute  
     4. For the expression, paste in \#root.context.requestData.subjectToken.sub  
     5. Click **Save**  
     6. Click **\+Add**  
     7. Attribute name: act    
     8. Click the gears icon in the act attribute  
     9. For the expression, paste in (\#root.context.requestData.subjectToken.may\_act.sub \== \#root.context.requestData.actorToken.client\_id)?\#root.context.requestData.subjectToken.may\_act:null  
     10. Click **Save**  
     11. Click **Next**  
     12. Click **\+Add Scope**   
     13. **Scope Name**:  test   
     14. Save the resource  
     15. In the resource **Overview** panel, make note of the **Resource ID** and **Client Secret**  
     16. These will be required for your PingOne Gateway configuration   
   * **Resource Name**: agent  
     1. **Audience**: agent   
     2. Click **Next**  
     3. Change the **PingOne Mapping** for sub to **Username**  
     4. Click **\+Add**  
     5. Attribute name: may\_act    
     6. Click the gears icon in the may\_act attribute  
     7. For the expression, paste in (\#root.context.requestData.grantType \== "client\_credentials")?null:({ "sub": \#root.context.appConfig.clientId })  
     8. Click **Save**  
     9. Click **Next**  
     10. Click **\+Add Scope**  
     11. **Scope Name**:  agent   
     12. Save the resource  
3. In the environment, create an **Agreement** (found under **User Experience**)  
   * **Name**: Agent Consent  
   * **Description**: Consent for a digital assistant agent   
   * **Reconsent Every**: 180 days  
   * Click **Save**  
   * Click **Edit Localized Content**  
   * Add a Language (English)  
   * Click **Save**  
   * In the **Localized Agreement Content** enter:  
     1. I consent to allow digital assistants created by MyCompany to act on my behalf   
   * Click **Save**  
   * Use the slider at the top to enable **English (default)**  
   * Click **Save**  
   * Click the ‘X’ in the top right corner  
   * Use the slider on the right side to enable the agreement  
4. In the environment, create an **Authentication Policy** (found under **Authentication**)  
   * **Policy Name**: Agent-Consent-Login  
   * **Step Type**: Login   
   * Click **\+Add step**  
   * Select Agreement Prompt   
   * Select the Agent Consent agreement  
   * Click **Save**

   

5. In the environment, create an **AI Agent** with the following values:  
   * **Name**: MCP Tutorial  
   * **Description**: MCP Agent for PingGateway tutorial  
6. In the agent, select the **Configuration** panel and click the pencil to edit.  
7. In the **OIDC Settings**, configure:  
   * **Response Type:** Code  
   * **Grant Types:** Authorization Code, Refresh Token, Client Credentials, Token Exchange  
   * **PKCE Enforcement:** Optional  
   * **Token Endpoint Authentication Method:** Client Secret Basic  
8. In the **Redirect URIs** field, add [http://localhost:3000/callback](http://localhost:3000/callback).  
9. Click **Save**  
10. In the **Resources** panel, click the pencil to edit then select the test and agent scope in addition to the default openid scope, and click **Save**.  
11. In the **Policies** panel, click **\+Add Policies**  
    * Select **Agent-Consent-Login** and **Save**  
12. At the top-right of the page, click the slider to enable the agent.  
13. In the **Overview** panel, make note of the **Client ID**  
    * This will be required when re-starting the MCP agent

You have successfully prepared PingOne to act as the AS.

### 

### **Tutorial task 3: Configure PingGateway**

Configure PingGateway to protect the sample MCP server:

1. In the admin.json file for PingGateway, [enable streaming](https://docs.pingidentity.com/pinggateway/2025.11/reference/AdminHttpApplication.html#AdminHttpApplication-streamingEnabled):

```
"streamingEnabled": true
```

   * If you used the example admin.json file from earlier, this should already be enabled  
   * PingGateway requires this setting for [server-side events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), part of MCP.  
2. Export an environment variable called RESOURCE\_SECRET\_ID with the base64 encoded client secret for the PingOne test resource (make sure not to include a newline)  
   bash: export RESOURCE\_SECRET\_ID=$(echo \-n "\<Resource client secret\>" | base64)  
3. Add the following route to PingGateway **updating "**properties**" as needed for your deployment the the PingOne environment ID, and PingOne resource ID**:  
   *Linux*  
   $HOME/.openig/config/routes/mcp.json  
   *Windows*  
   %appdata%\\OpenIG\\config\\routes\\mcp.json   
   

```
{
  "name": "mcp",
  "condition": "${find(request.uri.path, '^/mcp')}",
  "properties": {
    "pingOneEnvID": "https://auth.pingone.com/<PingOne Environment ID>",
    "pingOneResourceID": "<PingOne test resource ID>",
    "gatewayUrl": "https://ig.example.com:8443",
    "mcpServerUrl": "http://localhost:8000"
  },
  "baseURI": "&{mcpServerUrl}",
  "heap": [
    {
      "name": "SystemAndEnvSecretStore-1",
      "type": "SystemAndEnvSecretStore"
    },
    {
      "name": "AuditService",
      "type": "AuditService",
      "config": {
        "eventHandlers": [
          {
            "class": "org.forgerock.audit.handlers.json.JsonAuditEventHandler",
            "config": {
              "name": "json",
              "logDirectory": "&{ig.instance.dir}/audit",
              "topics": ["access", "mcp"]
            }
          }
        ]
      }
    },
    {
      "name": "rsFilter",
      "type": "OAuth2ResourceServerFilter",
      "config": {
        "requireHttps": false,
        "scopes": ["test"],
        "accessTokenResolver": {
          "type": "TokenIntrospectionAccessTokenResolver",
          "config": {
            "endpoint": "&{pingOneEnvID}/as/introspect",
            "providerHandler": {
              "type": "Chain",
              "config": {
                "filters": [
                      {
                        "type": "HttpBasicAuthenticationClientFilter",
                        "config": {
                          "username": "&{pingOneResourceID}",
                          "passwordSecretId": "resource.secret.id",
                          "secretsProvider": "SystemAndEnvSecretStore-1"
                        }
                      }
                    ],
                "handler": "ForgeRockClientHandler"
              }
            }
          }
        }
      }
    }
  ],
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        {
          "type": "McpAuditFilter",
          "config": {
            "auditService": "AuditService"
          }
        },
        {
          "type": "UriPathRewriteFilter",
          "config": {
            "mappings": { "/mcp": "/" }
          }
        },
        {
          "type": "McpProtectionFilter",
          "config": {
            "resourceId": "&{gatewayUrl}/mcp",
            "authorizationServerUri": "&{pingOneEnvID}/as",
            "resourceServerFilter": "rsFilter",
            "supportedScopes": ["test"],
            "resourceIdPointer": "/aud/0"
          }
        },
        {
          "type": "McpValidationFilter",
          "config": {
            "acceptedOrigins": ".*"
          }
        }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "config": {
          "soTimeout": "20 seconds"
        }
      }
    }
  }
}
```

   

4. **Restart PingGateway to apply the changes**  
   Notice the following features of the route:  
   * The sample route uses a secret obtained from an environment variable.  
   * PingGateway acts as an OAuth 2.0 resource server (RS) when protecting the sample MCP server.  
   * The [McpAuditFilter](https://docs.pingidentity.com/pinggateway/2025.11/reference/McpAuditFilter.html) audits MCP requests. PingGateway records MCP audit events in an audit/mcp.audit.json file.  
   * The [UriPathRewriteFilter](https://docs.pingidentity.com/pinggateway/2025.11/reference/UriPathRewriteFilter.html) sends the request to the root resource of the MCP server. The MCP server expects requests at /.  
   * The [McpProtectionFilter](https://docs.pingidentity.com/pinggateway/2025.11/reference/McpProtectionFilter.html) uses the RS configuration, extending it for MCP.  
   * PingGateway validates MCP requests with an [McpValidationFilter](https://docs.pingidentity.com/pinggateway/2025.11/reference/McpValidationFilter.html).  
   * The [ReverseProxyHandler](https://docs.pingidentity.com/pinggateway/2025.11/reference/ReverseProxyHandler.html) uses a long "soTimeout" setting to accommodate an MCP agent receiving few or infrequent SSE updates.  
5. This simple route doesn’t show [throttling](https://docs.pingidentity.com/pinggateway/2025.11/reference/ThrottlingPolicies.html) or fine-grained access control. Add those features as needed to meet your security requirements.  
6. Check the PingGateway log to verify the route loads successfully.

You have successfully configured PingGateway to protect the sample MCP server.

### **Tutorial task 4: Start the MCP agent**

In the directory where you unpacked the sample MCP agent, export the AI agent secret as an environment variable called AGENT\_SECRET, and start the sample MCP agent again, this time with an added option of **–client id**.  You will need the client ID from the PingOne “MCP Agent” application you created.  This time, point it to the PingGateway route for MCP requests:

```

bash-3.2$ export AGENT_SECRET=yjS0IWMX9LS91...
bash-3.2$ python3 sample-mcp-agent.py --client-id <PingOne AI agent client ID> --mcp-server-url https://ig.example.com:8443/mcp
```

You have successfully started the sample MCP agent.

## **Validation**

With PingGateway protecting the MCP server, the sample MCP agent directs you to the AS to sign on as an end user and authorize access to make MCP requests.

1. Allow it to open a browser automatically, or choose ‘n’ then copy the authorization URL the sample MCP agent now displays in your terminal window, and navigate there in your browser.  
   The URL looks similar to https://auth.pingone.com/082e56dd-1a0f-4e1d-a28e-77d51ecf1705/as/authorize?response\_type=code\&client\_id=3fffb1bf-106c-4449-a9bd-df6fa76d8f41\&redirect\_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback\&state=…​  
2. Sign on with the test user and consent to allow a digital assistant if asked, before closing the browser tab as prompted.  
     
   In the terminal where the sample MCP agent runs, notice the available commands:

```

[INFO] Discovered tools [https://ig.example.com:8443/mcp]:
[INFO] - geocode: Returns a list of objects containing city name, latitude, longitude, country, admin1 (region), and timezone for each matching city
[INFO] - forecast_daily: Returns a multi-day weather forecast for a given location
[INFO] - forecast_periods: Returns weather forecasts for each representative period of the current day
[INFO] - forecast_hourly: Returns an hourly weather forecast for the current day
[INFO] - weather_at_time: Returns the forecasted weather for a specific time at a given location

Enter your message (or 'exit|quit|q'):
```

5.   
   Enter a prompt and get a response from the MCP server through PingGateway, then exit the agent:  
   The following example uses the forecast\_daily tool to get the daily forecast for Tokyo:

```

Enter your message (or 'exit|quit|q'): What is the daily forecast for Tokyo?
Agent: The daily forecast for Tokyo is:

<MCP server response with forecast details>

Enter your message (or 'exit|quit|q'): exit
User requested exit. Goodbye!
```

8. Note the different tokens used throughout the transaction  
   1. **Actor token**: the AI agent’s access token  
   2. **Subject token:** The end user’s access token  
      1. Note the **may-act** claim, asserting that the agent is allowed to act on the user’s behalf  
   3. **MCP token**: an on-behalf-of token obtained through a PingOne token exchange  
      1. Note the **act** and **sub** claims asserting that this token is being used by the agent on behalf of the test user

```


Agent token (actor token):
{
  "aud": [
    "agent"
  ],
  "client_id": "adeeb901-7b64-453d-92bc-059bcbcc5958",
  "env": "4631af52-7ec7-48cf-848f-48cf8ca8e1ab",
  "exp": 1774043329,
  "iat": 1774039729,
  "iss": "https://auth.pingone.com/4631af52-7ec7-48cf-848f-48cf8ca8e1ab/as",
  "jti": "722238d2-4748-4681-889d-7fe7a321b037",
  "org": "84c4c0c0-0ca2-43b4-a62c-d830882855bc",
  "p1.rid": "722238d2-4748-4681-889d-7fe7a321b037",
  "scope": "agent"
}

...

User token (subject token):
{
  "acr": "Agent-Consent-Login",
  "aud": [
    "agent"
  ],
  "auth_time": 1774039361,
  "client_id": "adeeb901-7b64-453d-92bc-059bcbcc5958",
  "env": "4631af52-7ec7-48cf-848f-48cf8ca8e1ab",
  "exp": 1774043333,
  "iat": 1774039733,
  "iss": "https://auth.pingone.com/4631af52-7ec7-48cf-848f-48cf8ca8e1ab/as",
  "jti": "3121e22a-5958-4bf1-a369-ba296b444930",
  "may_act": {
    "sub": "adeeb901-7b64-453d-92bc-059bcbcc5958"
  },
  "org": "84c4c0c0-0ca2-43b4-a62c-d830882855bc",
  "p1.userId": "cf025143-501a-4d70-9c80-95d69121d7b3",
  "scope": "agent",
  "sid": "2dd6d4a4-0b59-4c99-8a57-4c189f09b24f",
  "sub": "demouser"
}

[INFO] Exchanging actor token and subject token for a new mcp token (scope='test')

Exchanged on-behalf-of token (mcp token):
{
  "acr": "Agent-Consent-Login",
  "act": {
    "sub": "adeeb901-7b64-453d-92bc-059bcbcc5958"
  },
  "aud": [
    "https://ig.example.com:8443/mcp"
  ],
  "auth_time": 1774039361,
  "client_id": "adeeb901-7b64-453d-92bc-059bcbcc5958",
  "env": "4631af52-7ec7-48cf-848f-48cf8ca8e1ab",
  "exp": 1774043333,
  "iat": 1774039733,
  "iss": "https://auth.pingone.com/4631af52-7ec7-48cf-848f-48cf8ca8e1ab/as",
  "jti": "e1e90599-b09f-4549-8ea9-6a297490e53c",
  "org": "84c4c0c0-0ca2-43b4-a62c-d830882855bc",
  "p1.userId": "cf025143-501a-4d70-9c80-95d69121d7b3",
  "scope": "test",
  "sid": "2dd6d4a4-0b59-4c99-8a57-4c189f09b24f",
  "sub": "demouser"
}

```

9. Find additional details about the MCP request in the PingGateway log.

You have successfully validated that PingGateway can protect the MCP server.  
