Transcript: MCP Gateway and Agentic AI Security Architecture (Recording GMT20260519-161149)

1. Metadata and Participants

Metadata Type	Details
Filename	GMT20260519-161149_Recording_1920x1080.mp4
Date/Time Stamp	2026-05-19, 16:11:49
Document Type	Full Technical Word-for-Word Transcript

Participants

* Active Speakers: Patrick, Curtis, Stephen, Adam (silent active).
* Referenced Participants: Tam, Campbell, Brian, Ivan, Dory, Sanjay, Delta (Organization).


--------------------------------------------------------------------------------


2. Segment 1: Fine-Grained Authorization at the Gateway

Patrick: ...while he's for it.

Stephen: So you said fine-grained [sic] authorization at the MCP but our—MCP at the MCP gateway at the gateway—right? But it's not in the gateway right? That's where we're going to call out the gateway is going to have—

Patrick: Oh yeah, when I say that, when I say fine-grained [sic] authorization I'm saying a call out to Ping Authorize at that point.

Stephen: Okay. That's what I wanted to get. Yes, okay okay. So in other words, so simply put you drop the token exchange at the MCP gateway to the MCP server.

Patrick: Yeah.

Stephen: Okay. I don't think—

Patrick: Other way around. The token exchange happens at the m— Well, so the inbound transaction token is validated at the gateway. All right. It needs to be passed down to the MCP server and can be—

Stephen: Okay.

Patrick: It doesn't need to be additional um because the MCP server doesn't need to validate the token because it's already been validated for it up front.

Architectural Analogy: It's like the notion of traditional, you know, Ping Access sitting in front of a website. All right, Ping Access validated the session cookie for you and then you just passed the information down to the website and it just trusted it basically at that point, right?

Stephen: And I can tell you kind of what the—that's the way we originally had this when this thing's gone through so many iterations. The reason we landed here was just uh Tam kind of had a diagram and he said, you know, if we scope the token to the gateway, then the agent can't wind up doing an end-run to the MCP server. That assumes that you haven't done the traditional reverse proxy thing where you lock down, you know, all the channels where it can only—


--------------------------------------------------------------------------------


3. Segment 2: Gateway Implementation Challenges (AWS vs. GCP)

Patrick: Exactly. What—And what do you think, guys? What's simpler to implement? Honestly, yeah. Just pass through. So, I'm not saying that we—So, again, this comes down to what's the simplest approach to get our customers comfortable with this. Showing multiple token exchanges is going to look complex and latency and confusing, stuff like that. So, we should start with the simplest approach and if they have issues with it, then we can grow into the more advanced approaches in my mind. Now the problem is that AWS and I believe GCP has taken a different approach on their gateway. So if that MCP gateway is the AWS um Agent Core gateway, it actually exposes a single MCP server endpoint for the multitude of backend MCP servers it's protecting. Right. So it it's a—and essentially it aggregates all of the tools of those, you know, backend MCP servers into a single tool list on their gateway, right?

Stephen: I can see where that's bad for management. But does that also imply they're all over scoped or am I reading too much into that?

Patrick: No, that's right. If what they're like—I just ran into—I literally hung up with Delta to come here. Right. So, what it's going to wind up being is they will have a gateway per MCP.

Stephen: Yeah. Okay.

Note on Complexity: To avoid collisions on the tool names, they add a prefix to every single tool name to basically, you know, differentiate between them all. You end up with this master list of possibly thousands of tools on that single MCP server URL, which I think's a freaking nightmare. Honestly, I don't know.


--------------------------------------------------------------------------------


4. Segment 3: Token Exchange and Transaction Tokens

Stephen: Well, one more—if I may. One more quick thing. You said to simplify it, right? But it's true that there's still another token exchange happening. You're just saying it's happening in the gateway, right? Like we don't need—

Patrick: Well, it's a—it depends what we mean by token exchange. When I talk token exchange, I'm explicitly talking OAuth, right? All right. And the token exchange endpoint on your OAuth authorization server, right? You—we might end up needing to um effectively have the gateway find and get access to some other secret so it can talk to the service in the back end. But I wouldn't necessarily call that token exchange at that point. So that example there of that API key that wouldn't be token exchange. That's the fact that it needs to go get an API key to be able to talk to the API basically.

Stephen: Exactly. Scroll to the left a little Curtis. So we're basically saying—so just we take the first token, the human token, do the one exchange that gets us basically the act claim right here. Right.

Patrick: Yes. Yep. And in the token we're going to have that. We're going to have like act—and that's it. Right. Not unless there's explicitly—if you go down, go to the right. Let's say that API needs to make a call to another service. All right. Some downstream additional service. To me, the MCP gateway, the MCP server, and the API, you could put a dotted box around them effectively. They're all kind of one thing. Basically all right, but now let's say the API needs to make another service call to some other API. All right, that is where that API would do a token exchange to get to that downstream service effectively, and that's the point of transaction tokens. They're meant to be able to be used service-to-service-to-service like this. So it's when it is now talking to some other service to get something done that it would do token exchange and we'd add another actor in here at that point.

Curtis: You keep mentioning transaction token. This is a new token type.

Patrick: It's a—it's a specific RFC specific token type, craft I think version 8 or something. Yep. Um we're seeing this—this came up initially my awareness of this came up when I started talking to CBA Commonwealth Bank last year. So Tam is very aware of this um given those interactions. But yeah, it's a specific—really what it is it's an extension of token exchange where they define some additional claims that you where you can put in certain information basically. It's building on top of token exchange which incorporates the act—you know the act act as—claims with some additional claims beyond that that we can use.

Curtis: So we can literally just construct this in the core products AIC, Ping One, Ping Federate today just by adding—

Patrick: And Ping Federate I think is extensible enough to basically create one of these through its own extension mechanism. We don't actually, you know, it—we—we can treat it as—we can create a custom token processor or something like that and create it today.

Curtis: Now, now you mentioned this token. I had looked at it a little bit and I was familiar with RAR and you just mentioned RAR. Do you—do you see those? I almost was thinking this was going to replace RAR, but it sounds like no that you see.

Patrick: No, we could. Yeah, there's a placeholder for that level of rich authorization information in the transaction token as a claim you can put there.

Summary of Validated Claims: The speakers agree that in current POC implementation policies, the following four criteria must be checked:

1. Token Activity: Is the token active?
2. Subject: Does the subject line up?
3. Audience: Does the audience line up?
4. Actor: Is the ACT claim correct?


--------------------------------------------------------------------------------


5. Segment 4: Scopes, Audiences, and Externalized Authorization

Patrick: The other piece of this that I talked to Campbell about is that we're spending a lot of time talking about scopes effectively and audiences. All right. Um and transaction tokens are actually designed to be very broadly used effectively. So if we go to the left in the diagram, all right, let's say this agent, agent one here needs to talk to, you know, to complete the query, it ends up needing to talk to three or four or five different MCP servers to complete the transaction. Okay, generally speaking, the transaction token is meant to be able to be used across all of those three or four or five different services, which implies at the audience level, it's really set to bxf.com. All right, because it—it can be used across any and all of these services especially, you know, so—so that you can avoid the need to do again token exchange unless you're—unless you're doing adding another actor in.

Patrick: And so then you get into questions about, all right, well, what are the scopes here? And do scopes even make sense in these situations? I'm wondering whether we should be setting the scopes at the point of token issuance when we don't really know what the agent kind of needs to do versus making all of the authorization decisions at the gateway via Ping Authorize. I don't see what value the scopes are adding here beyond creating confusion and complexity. I'm worried that token—I mean I've been saying for a while that you know what problem are we solving for agents? I've been saying token exchange somewhat facetiously because really that's what we do, but that's kind of commoditized to the point where I think we need to be really pushing on why externalizing fine-grained authorization is going to be so important here.

Section: The Authorization "Bounce" and Externalized Auth Patrick: There was a missing piece here where we talked about scopes and kind of how you landed on them, but it was like, you know, basically the first prompt comes through with literally no scope. I mean or some birthright scope or whatever, and then some something you know once it decides which tool it needs to go try and call, then at that point Authorize is basically returning back you know what scope is required to get at that particular tool and it's sort of a two-way bounce back and forth kind of process here that's not really well represented in just looking at the diagram.


--------------------------------------------------------------------------------


6. Segment 5: Agent Credentials and Workload Identity (Spiffy/SVID)

Patrick: The other thing is is um the agent itself and the—and the notion of an agent credential and how it authenticates. So, and this is where the spiffy stuff comes in. We understand what the agent ID is so we can start to stuff that into the transaction token.

Stephen: That's the line that goes number one on it which is for the most part just been client credentials.

Patrick: Yeah. Client ID and client secret today. The recommendation here is that the agent should move to a model where it's using a private key. So at minimum we can use a PK JWT and authenticate the agent via a PK JWT. Then the question becomes, well, who issues the private key and manages the private key? Well, that's an M&A conversation we're having.

Patrick: The other model that emerges for that is where the organization is using spiffy as a mechanism for workload identity. The agent is issued an SVID jot and we can validate that, or alternatively, it can also be issued an X509 SVID effectively a certificate, and we can do MTLS against Ping Federate there as well. We're recommending SVID jot there. This implies the customer has like a spiffy infrastructure they're using like Spire, which is an open source thing. But and again we’re looking to close the gap there where we can also issue our own SVID jots too. But when you hear about that stuff to me it's about Ping needs to also be responsible for managing the credentials of the agents cuz if we're not doing that then we're leaving it to someone else. With spiffy, honestly, you can get to zero secrets. It's actually pretty cool. We're trying to break the model of long-lived credentials. Everything should still be protected with an HSM.


--------------------------------------------------------------------------------


7. Segment 6: Human-in-the-Loop and Elicitation

Stephen: We talk about human in the loop. Authorize makes the decision, say we've got a one-to-one scope mapping to tool. They try to call a tool that needs additional approval. We kind of landed where it's going to send a prompt back basically to the agent that says, "Hey, you need to go get the human approval. Go figure it out."

Patrick: Have you guys looked at the MCP elicitation stuff at all? Elicitation. E-L-I-C-I-T-A-T-I-O-N. Elicitation. My understanding is that MCP elicitation allows the MCP server to signal to the agent that it needs to go do something.

Stephen: So Patrick, where we went to UKG—I'm on a digital assistant, I say I want to take next week off and that's going to do a human in loop which is not me, that's my manager. And three days later my manager comes back in and approves it. Does that mean the agent needs to have a long-lived memory and it's an asynchronous process?

Patrick: A digital worker example I could see that actually where it's sort of more of an autonomous agent and to get something done it needs an additional entitlement that gets—it's like a JIT request. It sends to its supervisor or custodian and at some point the supervisor sees it and approves it and then the agent gets kind of notified at that point.

Intent Drift: Where this level of elicitation matters is "Intent Drift." If the agent is drifting from its original intent, we need to be able to have a way to recognize and understand that basically.


--------------------------------------------------------------------------------


8. Segment 7: ID JAG and Cross-Domain Delegation

Patrick: The other one you're gonna hear about is um ID JAG. So the cross-domain stuff. If the agent needs to talk to a third-party MCP server, the agent takes the access token from the user and exchanges it for an ID JAG basically and sends the ID JAG directly to the OAuth authorization server at the third party.

Stephen: I have one question on ID JAG. We've been going to market saying it's delegation, not impersonation. But ID JAG has that RFC 7523 where you have a digital certificate that's trusted and you say "Give me an OAuth token for John Doe." That feels to me like that's impersonation.

Patrick: It depends on the specific use case. If I want Claude to access my ServiceNow account, ID JAG is kind of like SAML in that case. It's Claude needing to go to ServiceNow directly and I'm allowing Claude to log in as me basically. It's essentially a way of dealing with when a SAS vendor exposes an API for a customer workload to access it. ID JAG is used to eliminate the need for that client secret. It's kind of federation for the agent.

Stephen: Do we have to update our IDPs to support ID JAG?

Patrick: Yes. Yes. We'll need to go there. And by the way, we also need to support it on the RP side. We need to get Ivan and Dory to like rapidly implement this in Ping One.


--------------------------------------------------------------------------------


9. Strategic Roadmap and Gaps

Patrick: The piece that we aren't doing well yet and haven't aligned on, I'll call it an Agent Registry. Where is the store where we basically have the master list of agents and agent credentials like their public key and the resources the agents allowed to access? There's a collision with what Sanjay's building around agent discovery where he goes and discovers all of the agents that have been built and deployed inside Agent Core and Vertex and Foundry on Azure. We need our runtime engines to be able to access that information.

Strategic Roadmap Gaps:

* Token Vaulting: The ability for the gateway to retrieve API keys or client secrets for backend services.
* Credential Management: Native management of agent private keys and SVID issuance to avoid reliance on third-party validation.
* ID JAG Implementation: Competitive parity with Okta; must be implemented on both IDP and RP sides this year.

Patrick: If—so we're looking at a company called Ambit (A-E-M-I-T), but please keep that confidential. We have to get it done this year. Next time we talk about this, let's loop Adam in as well because he needs—

Stephen: He was on for about half the call.

Patrick: Oh, was he? All right. Cool. Okay. Thanks a lot.

Stephen: Thank you, Patrick.

Patrick: Good luck.

Stephen: Okay, thanks. Curtis, you're still there?


--------------------------------------------------------------------------------


10. Glossary of Technical Terms (Derived Context)

Term	Definition from Transcript Context
MCP Gateway	An architectural component that sits in front of backend MCP servers to validate inbound tokens and aggregate tools into a single list (though potentially complex when thousands of tools are involved).
Transaction Token	A specific RFC token type (extension of token exchange) designed for service-to-service use, capable of carrying actor claims, prompt information, and RAR data.
SVID	A workload identity credential (JOT or X509) used within a spiffy infrastructure (like Spire) to achieve "zero secret" authentication and break the model of long-lived credentials.
ID JAG	A "federation-like" mechanism for agents based on RFC 7523 that enables cross-domain delegation, allowing an agent to access third-party SAS APIs (e.g., ServiceNow) without client secrets.
Agent Registry	A centralized store serving as the authoritative source for the master list of agents, their public keys, and lifecycle management data, analogous to a user directory.
