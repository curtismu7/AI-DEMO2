// demo_api_ui/src/data/a2aRecordedRun.js
//
// A REAL captured A2A run, replayed by A2AProtocolLearningPage when the visitor
// is signed out (the delegation mints real PingOne tokens, so it needs a
// session) or when a live run fails.
//
// CAPTURE RECIPE — signed in as a customer, with the stack serving code that
// has the LLM authorization gate removed (PR #2610 / commit 5bca57388):
//
//   POST /api/a2a/init
//   POST /api/a2a/message
//     { "message": "hand off to a specialist to review the sensitive membership details",
//       "vertical": "sporting-goods" }
//
// Copy the response's tokenEvents into `tokenEvents`, and
// GET /a2a/specialists/sporting-goods/.well-known/agent-card.json into `agentCard`.
//
// That wording matters: if the LLM is down, orchestrateDelegation falls back to
// heuristicOrchestration, whose delegationPhrases need one of
// hand off / delegate / specialist / sensitive. This phrasing hits three, so the
// capture still delegates with the LLM dead.
//
// NOTHING HERE IS A SECRET. buildA2aEvent never emits raw token strings — only
// decoded claims — and the capture script asserts no JWT-shaped string is
// present before writing. Re-run that assertion if you re-capture.
//
// Anti-rot: __tests__/A2AProtocolLearningPage.test.jsx feeds this through
// buildA2aChainDetail + buildA2aTeachingPanes and fails if the event ids or
// extra shapes drift. A stale fixture that still renders is the failure mode
// this guards.

export const A2A_RECORDED_RUN = {
  "capturedAt": "2026-08-29",
  "vertical": "sporting-goods",
  "message": "hand off to a specialist to review the sensitive membership details",
  "tokenEvents": [
    {
      "id": "user-token",
      "label": "Authenticated user token · A2A subject",
      "status": "active",
      "timestamp": "2026-08-29T18:13:54.090Z",
      "alg": "RS256",
      "claims": {
        "client_id": "83572007-b2c7-4862-8197-dc225a9fb8e1",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "46ea24cd-00f0-4a06-9adc-e66d98765d90",
        "iat": 1788027229,
        "exp": 1788030829,
        "aud": [
          "enduser.ping.demo"
        ],
        "scope": "ai:agent:read read transfer openid profile offline_access write email mortgage:read",
        "sub": "1aee74ae-3d09-4bcf-a69f-7e1bc225b761",
        "sid": "17698419-8b97-408f-9aee-57c8841b3687",
        "auth_time": 1788027228,
        "acr": "Agent-Consent-Login",
        "may_act": {
          "sub": "0b412e8b-cfbc-4c7d-a773-0d46118de09d"
        },
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096"
      },
      "explanation": "The signed-in user token is the subject presented to Exchange #1; subsequent actor and exchange events must preserve this user identity.",
      "a2aRole": "user-subject",
      "vertical": "sporting-goods",
      "userSub": "1aee74ae-3d09-4bcf-a69f-7e1bc225b761"
    },
    {
      "id": "a2a-agent1-actor",
      "label": "A2A — Agent 1 (generalist) Actor Token · client_credentials",
      "status": "acquired",
      "timestamp": "2026-08-29T18:13:54.191Z",
      "alg": "RS256",
      "claims": {
        "client_id": "0b412e8b-cfbc-4c7d-a773-0d46118de09d",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "c7387ad7-3b88-4620-8e1f-99f91e19cf82",
        "iat": 1788027234,
        "exp": 1788030834,
        "aud": [
          "agentgateway.ping.demo"
        ],
        "scope": "agent:invoke",
        "may_act": "{\"sub\":\"f4dd707d-f78d-4417-ba56-dc8707d10a1f\"}",
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096",
        "p1.rid": "c7387ad7-3b88-4620-8e1f-99f91e19cf82"
      },
      "explanation": "The generalist agent authenticates as itself (RFC 6749 §4.4). This actor token names Agent 1 as the party acting on the user’s behalf in Exchange #1.",
      "a2aRole": "agent1-actor",
      "vertical": "sporting-goods"
    },
    {
      "id": "a2a-exchange1",
      "label": "A2A Exchange #1 — User → Agent 1 delegated token (RFC 8693 §2.1)",
      "status": "exchanged",
      "timestamp": "2026-08-29T18:13:54.380Z",
      "alg": "RS256",
      "claims": {
        "client_id": "0b412e8b-cfbc-4c7d-a773-0d46118de09d",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "02189927-c491-4cc7-813d-2ac27b38fb88",
        "iat": 1788027234,
        "exp": 1788030834,
        "aud": [
          "a2a-intermediate-membership.ping.demo"
        ],
        "scope": "agent:invoke:membership",
        "sub": "1aee74ae-3d09-4bcf-a69f-7e1bc225b761",
        "sid": "17698419-8b97-408f-9aee-57c8841b3687",
        "auth_time": 1788027228,
        "acr": "Agent-Consent-Login",
        "act": {
          "sub": "0b412e8b-cfbc-4c7d-a773-0d46118de09d"
        },
        "may_act": "{\"sub\":\"5a5d730f-864c-46b4-a651-53516a6f709c\"}",
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096"
      },
      "explanation": "PingOne mints a delegated token: subject stays the user, act:{sub:agent1} records that Agent 1 is acting on their behalf. No may_act — the chain is the source of truth; whether the delegation is allowed is decided by Authorize.",
      "a2aRole": "exchange1",
      "actPresent": true,
      "a2aSubtask": "hand off to a specialist to review the sensitive membership details",
      "vertical": "sporting-goods",
      "exchangeRequest": {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "actor_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "audience": "a2a-intermediate-membership.ping.demo",
        "scope": "agent:invoke:membership",
        "has_actor_token": true,
        "exchanger_client_id": "0b412e8b-cfbc-4c7d-a773-0d46118de09d"
      }
    },
    {
      "id": "a2a-agent2-actor",
      "label": "A2A — Membership Specialist (Agent 2) Actor Token · client_credentials",
      "status": "acquired",
      "timestamp": "2026-08-29T18:13:54.576Z",
      "alg": "RS256",
      "claims": {
        "client_id": "68712a9b-4855-4aba-a210-c4d63ba93c58",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "296978b9-96d8-494d-a199-b261036390a3",
        "iat": 1788027234,
        "exp": 1788030834,
        "aud": [
          "a2a-intermediate-membership.ping.demo"
        ],
        "scope": "agent:invoke:membership",
        "may_act": "{\"sub\":\"5a5d730f-864c-46b4-a651-53516a6f709c\"}",
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096",
        "p1.rid": "296978b9-96d8-494d-a199-b261036390a3"
      },
      "explanation": "The Membership Specialist authenticates as itself (scoped to the A2A intermediate resource) for sensitive_membership_details only. Authorize is what approves the delegated call.",
      "a2aRole": "agent2-actor",
      "vertical": "sporting-goods",
      "specialist": "Membership Specialist"
    },
    {
      "id": "a2a-exchange2",
      "label": "A2A Exchange #2 — nested act {Membership Specialist → generalist} (RFC 8693 §4.1)",
      "status": "exchanged",
      "timestamp": "2026-08-29T18:13:54.726Z",
      "alg": "RS256",
      "claims": {
        "client_id": "68712a9b-4855-4aba-a210-c4d63ba93c58",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "962bcca4-f890-4240-a3e6-20c7e2d6ffed",
        "iat": 1788027234,
        "exp": 1788030834,
        "aud": [
          "mcpgateway-a2a.ping.demo"
        ],
        "scope": "membership:read",
        "sub": "1aee74ae-3d09-4bcf-a69f-7e1bc225b761",
        "sid": "17698419-8b97-408f-9aee-57c8841b3687",
        "auth_time": 1788027228,
        "acr": "Agent-Consent-Login",
        "act": {
          "sub": "68712a9b-4855-4aba-a210-c4d63ba93c58",
          "act": {
            "sub": "0b412e8b-cfbc-4c7d-a773-0d46118de09d"
          }
        },
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096"
      },
      "explanation": "PingOne nests the actor chain: act:{sub:agent2, act:{sub:agent1}}, subject still the user. The resource server now sees the FULL agent chain that acted on the user’s behalf — auditable end to end — while the token stays bound to the user. PingOne Authorize then decides PERMIT/DENY over this chain.",
      "a2aRole": "exchange2",
      "actPresent": true,
      "actChainDepth": 2,
      "a2aTool": "sensitive_membership_details",
      "scope": "membership:read",
      "vertical": "sporting-goods",
      "specialist": "Membership Specialist",
      "exchangeRequest": {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "actor_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "audience": "mcpgateway-a2a.ping.demo",
        "scope": "membership:read",
        "has_actor_token": true,
        "exchanger_client_id": "68712a9b-4855-4aba-a210-c4d63ba93c58"
      }
    },
    {
      "id": "a2a-protocol-bearer",
      "label": "A2A Protocol — PingOne wire bearer · client_credentials",
      "status": "acquired",
      "timestamp": "2026-08-29T18:13:54.902Z",
      "alg": "RS256",
      "claims": {
        "client_id": "0b412e8b-cfbc-4c7d-a773-0d46118de09d",
        "iss": "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as",
        "jti": "6977cf09-5696-4b26-a84e-4dc79709c1fc",
        "iat": 1788027234,
        "exp": 1788030834,
        "aud": [
          "agentgateway.ping.demo"
        ],
        "scope": "agent:invoke",
        "may_act": "{\"sub\":\"f4dd707d-f78d-4417-ba56-dc8707d10a1f\"}",
        "env": "01d89b06-66d5-430e-9f28-65636843788b",
        "org": "97ba44f2-f7ee-4144-aa95-9e636b57c096",
        "p1.rid": "6977cf09-5696-4b26-a84e-4dc79709c1fc"
      },
      "explanation": "Separate from nested-act MCP tokens. Pattern: Magic 8 Ball security sample (bearer to A2A server) with PingOne as IdP.",
      "a2aRole": "protocol-bearer",
      "vertical": "sporting-goods",
      "publicCardUrl": "https://local.ping-devops.com:4000/a2a/specialists/sporting-goods/.well-known/agent-card.json",
      "clientId": "0b412e8b-cfbc-4c7d-a773-0d46118de09d"
    },
    {
      "id": "a2a-agent-card",
      "label": "A2A Protocol — Agent Card · Membership Specialist",
      "status": "discovered",
      "timestamp": "2026-08-29T18:13:54.903Z",
      "alg": null,
      "claims": null,
      "explanation": "Specialist Agent Card (A2A discovery). Skills and PingOne Bearer security advertised before SendMessage.",
      "a2aRole": "agent-card",
      "vertical": "sporting-goods",
      "agentName": "Membership Specialist",
      "cardUrl": "https://local.ping-devops.com:4000/a2a/specialists/sporting-goods/.well-known/agent-card.json",
      "skills": [
        "sensitive_membership_details"
      ],
      "protocolVersion": "1.0",
      "protocolBinding": "JSONRPC",
      "securitySchemes": [
        "pingoneBearer"
      ],
      "mode": "in-process",
      "agentCard": {
        "name": "Membership Specialist",
        "description": "Super Banking Membership Specialist Agent — A2A specialist for vertical \"sporting-goods\". Wire auth is PingOne Bearer; MCP tools still require nested-act delegation.",
        "version": "1.0.0",
        "documentationUrl": "https://a2a-protocol.org/dev/tutorials/",
        "provider": {
          "organization": "Ping Identity Demo",
          "url": "https://a2a-protocol.org"
        },
        "capabilities": {
          "streaming": false,
          "pushNotifications": false,
          "extensions": [],
          "extendedAgentCard": false
        },
        "securitySchemes": {
          "pingoneBearer": {
            "scheme": {
              "$case": "httpAuthSecurityScheme",
              "value": {
                "description": "PingOne access token (client_credentials) for the A2A hop",
                "scheme": "Bearer",
                "bearerFormat": "JWT"
              }
            }
          }
        },
        "securityRequirements": [
          {
            "schemes": {
              "pingoneBearer": {
                "list": []
              }
            }
          }
        ],
        "defaultInputModes": [
          "text/plain"
        ],
        "defaultOutputModes": [
          "text/plain"
        ],
        "skills": [
          {
            "id": "sensitive_membership_details",
            "name": "sensitive membership details",
            "description": "Membership Specialist skill: sensitive_membership_details",
            "tags": [
              "sporting-goods",
              "a2a",
              "membership"
            ],
            "examples": [
              "review the sensitive membership details"
            ],
            "inputModes": [
              "text/plain"
            ],
            "outputModes": [
              "text/plain"
            ],
            "securityRequirements": []
          }
        ],
        "signatures": [],
        "supportedInterfaces": [
          {
            "url": "https://local.ping-devops.com:4000/a2a/specialists/sporting-goods",
            "protocolBinding": "JSONRPC",
            "tenant": "",
            "protocolVersion": "1.0"
          }
        ]
      }
    },
    {
      "id": "a2a-protocol-message",
      "label": "A2A Protocol — SendMessage → Membership Specialist",
      "status": "completed",
      "timestamp": "2026-08-29T18:13:54.905Z",
      "alg": null,
      "claims": null,
      "explanation": "A2A handoff received by Membership Specialist. Wire auth: PingOne Bearer. MCP tools still require nested-act delegation. Task: hand off to a specialist to review the sensitive membership details",
      "a2aRole": "protocol-message",
      "vertical": "sporting-goods",
      "agentName": "Membership Specialist",
      "replyText": "A2A handoff received by Membership Specialist. Wire auth: PingOne Bearer. MCP tools still require nested-act delegation. Task: hand off to a specialist to review the sensitive membership details",
      "mode": "in-process",
      "protocolRequest": {
        "method": "message/send",
        "mode": "in-process",
        "message": {
          "role": "user",
          "text": "hand off to a specialist to review the sensitive membership details",
          "metadata": {
            "vertical": "sporting-goods",
            "demoLayer": "a2a-protocol-wire"
          }
        }
      },
      "protocolResponse": {
        "replyText": "A2A handoff received by Membership Specialist. Wire auth: PingOne Bearer. MCP tools still require nested-act delegation. Task: hand off to a specialist to review the sensitive membership details",
        "ok": true
      }
    }
  ],
  "agentCard": {
    "name": "Membership Specialist",
    "description": "Super Banking Membership Specialist Agent — A2A specialist for vertical \"sporting-goods\". Wire auth is PingOne Bearer; MCP tools still require nested-act delegation.",
    "version": "1.0.0",
    "documentationUrl": "https://a2a-protocol.org/dev/tutorials/",
    "provider": {
      "organization": "Ping Identity Demo",
      "url": "https://a2a-protocol.org"
    },
    "capabilities": {
      "streaming": false,
      "pushNotifications": false,
      "extensions": [],
      "extendedAgentCard": false
    },
    "securitySchemes": {
      "pingoneBearer": {
        "scheme": {
          "$case": "httpAuthSecurityScheme",
          "value": {
            "description": "PingOne access token (client_credentials) for the A2A hop",
            "scheme": "Bearer",
            "bearerFormat": "JWT"
          }
        }
      }
    },
    "securityRequirements": [
      {
        "schemes": {
          "pingoneBearer": {
            "list": []
          }
        }
      }
    ],
    "defaultInputModes": [
      "text/plain"
    ],
    "defaultOutputModes": [
      "text/plain"
    ],
    "skills": [
      {
        "id": "sensitive_membership_details",
        "name": "sensitive membership details",
        "description": "Membership Specialist skill: sensitive_membership_details",
        "tags": [
          "sporting-goods",
          "a2a",
          "membership"
        ],
        "examples": [
          "review the sensitive membership details"
        ],
        "inputModes": [
          "text/plain"
        ],
        "outputModes": [
          "text/plain"
        ],
        "securityRequirements": []
      }
    ],
    "signatures": [],
    "supportedInterfaces": [
      {
        "url": "https://local.ping-devops.com:4000/a2a/specialists/sporting-goods",
        "protocolBinding": "JSONRPC",
        "tenant": "",
        "protocolVersion": "1.0"
      }
    ]
  }
};
