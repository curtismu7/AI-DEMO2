Here’s the transcript of that video:

---

Agentic Trust: Securing AI Interactions with Tokens & Delegation  
Channel: IBM Technology

---

Howdy, everyone.

In this video, we will look at how to ensure secure and reliable AI interactions and discuss how trust is established and maintained across agentic AI systems.

As part of establishing trust, the concept of verifiable agent identities is also explored.

Building trust and security for IT systems has long been part of what we do.

The first real standards actually emerged back in 1985 around security.

And while AI systems are like those in many ways, there are unique challenges that bring new risk, especially when we consider the non-deterministic behavior of AI interactions.

All right, let's start by drawing a typical AI or agentic flow.

We start with a user.

And that user interacts with a chat.

That chat then determines what the user's gonna do and goes to an orchestrator.

And that orchestrator determines, okay, how is this flow ultimately gonna look?

So we may have a couple of AI agents, we could have a couple, we could one, we could multiple of these, all of these create ...

The orchestrator creates a flow to interact.

And then ultimately we're gonna have some tool that we want to connect to, whether that's data or systems.

And now we see an emergence of MCP servers that the agents talk to, and then that ultimately talks into the tools.

All right, so that's our first flow.

Now, also in agentic systems, we have LLMs.

And these LLMs can help us in a variety of places.

They may work with the chat, they may work with the orchestrator to give some intelligence to developing the flow.

They may work with each of the individual agents as we determine what they need to do and how they're going to respond to a prompt from the original user.

The other thing that we see a lot of is we have a company's identity provider that's basically authenticating the user.

We authenticate the user at the very beginning and that results in a token that we then can propagate through the whole flow, down to the tool, and that says who the user is.

So we know what kinds of things that the tool, the user's allowed to do.

So this is, there are differences and there are changes that can be part of this, but this is a typical agentic flow.

So let's start thinking about then, all right, what are some of the things that, where there's risk and where there are errors that we need to take into consideration?

Well, the first thing that we really want to think about is a credential replay.

And what this basically says is that there is some other person that wants to take over the identity of who we think is using the system, gain their privileges and their accesses, and then use that token in a bad way to propagate through and get access to things that we don't want them to get access to.

Now, so, how can this happen when we have a particular flow?

Well, there's several ways that this can happen.

One of the ways is that in our development of our agentic system, we may actually, in any of these steps, send up our token that was authenticated here into the LLM as part of just the communication with the LLM.

And what happens is now it's embedded in the LLM and a bad actor can actually use prompt engineering to get the LLM to give up that token, get access to that token or the credentials and then use that along the process.

The other thing that can happen is we can have a man-in-the-middle attack, where somewhere along this path, there's somebody that's inserted themselves because we have a non-secure flow or non-secure stores and they can actually intercept these tokens, get a hold of them and then use them to replay again and get access to things that we don't want them to get access to.

So, in this part of this, how do we prevent these kinds of risks from happening?

Well, first thing when we're talking about man-in-the-middle is we can use TLS or mTLS or ...

along our whole communication flow so that's encrypted and secured and we can prevent someone get in the middle.

If we store credentials, if we store anything along this flow, encrypt those where they're stored so we can do a lot to kind of prevent the man-in-the-middle.

The other thing is just make sure you're not passing in identity information to the LLM.

The LLM doesn't need that.

It just needs to be able to organize and figure out what the task is for it.

So do not send that in.

The next thing that we have to look at if we talk about securing our flows and being able to trust our agentic systems is we need to look at rogue agents.

So we have agents that are somewhere pop-up and they're either communicating with, you know, some of these other agents, they're communicating with MCP.

And what they're doing is they're spoofing the identity of these other agents.

So they're saying, hey, I'm the real agent, talk to me and get me access to this tool.

And we don't want this to happen.

We wanna make sure that we can trust that we know who the legitimate agents are.

And to do that, we really start looking at, again, we take an identity provider and we start using this for agents.

So we want to know the identity of the agents, and we want to be able to authenticate the agents.

So we have an agent come up, we have a agent come and we say, please prove you are who you say that you are.

This prevents us, much like we would do with a bad actor, then a rogue agent isn't able to authenticate itself and we can trust exactly who these agents are and we know whether or not it's a rogue agent or not.

And when we get to an MCP server at this point, then we can validate.

In fact, we can actually validate at multiple points throughout this flow.

When agent one is talking to agent two, we can go up and validate that we trust that that was an authenticated, legitimate agent.

Same with the MCP.

We can look at agent two and make sure that we trust it was authenticated.

So this is a big piece of making sure that we know who the agents are in this system.

Now, next piece that we wanna look at is impersonation.

And what this is really saying is that even if we kind of think that we trust who an agent is, we don't want them to tell us, well, this is the person that I am working for without having any validation of that individual.

So in other words, the agent is impersonating the user.

And so what we do here is we actually start looking at delegation.

And this really is about having an agent work on behalf of a user.

So what we wanna do is make sure that we have this user properly authenticated.

We take their token and that becomes part of ...

Once an agent authenticates itself, now we have a combined token that has the subject, which is the user, it has the actor, which is the agent.

So now when we're going through the flow, we can trust that we've authenticated the user because that's contained within our token and we can also trust that we have authenticated the agent and who they're supposed to be operating on behalf of.

And all of this happens at the identity provider.

Not anywhere along this way can an agent assert what it's doing.

It has to be validated and provided by an independent party, in this case, which is the identity provider.

So this is another piece of this.

Now, as we talked about at the very beginning, we have these tokens that kind of flow through the system.

That is also a point of risk because we just need to make sure that at each node in each hop that that token is actually the one that we trust through the entire flow.

We do that through doing a token exchange.

And what this really says is at each node and hop, we make a call to our provider and we say, please exchange the incoming token for another.

We know the starting point, we know the end point, we bring those tokens in, then we exchange it.

So the trust and the validation is really for this flow, then we trust and validate for this low.

So that way we know that everything is propagating correctly along this flow.

Again, so we trust the user, trust the agents, securely move the identities through this system as we're getting it to the tools.

The next thing that we really want to think about then is at the tool side is overpermissioning.

And what this says is that a user could be allowed to do a lot of stuff.

An agent could be allowed to do a lot a stuff, but we only want what happens within this flow to only be what is needed for the prompt that's happening.

What is the actual tool that we need to connect to?

A user may be able to connect a lots of tools, but in the context of this flow, we only want to be able to show what that user can connect to.

Same with the agents.

And this really gets then into scopes.

When we do these exchanges at each node of this flow, we're validating everything, but we're also restricting the scopes in the token to only be what is necessary.

Agent one can talk to agent two.

It has an audience of agent two.

Agent two can connect with this tool, so we go through MCP and we validate all this.

So this really then gets us a good end-to-end flow that we can now trust.

Now, the final piece that we wanna think about when we're looking at how do we trust and secure our agentic system is really the last mile.

And this is really happening between MCP and the tool.

From this point it's tokens, it's flowing, we are trusting, we're validating, but now the MCP server is gonna talk to a tool and then they do that over an API.

It may do that over a variety of different mechanisms which really are not necessarily what we've established in the flow.

So how do we do that?

We want to have ...

we don't want the MCP server to store and keep credentials that it uses to access the tool because now we have a potential risk and exposure here.

So what we do for the last mile is we introduce a vault, a secure vault, and this manages the credentials to the tool and then feeds a temporary credential to MCP.

So we have the user, we have the agent.

It wants to connect to a tool, it does an exchange within a vault to get a temporary credential that is used for the tool and now we connect to the tool.

All right, so this is a good view of how we can start through a typical agentic system and do things with trust, where we trust the identities and we trust the authentication.

So we know who is operating across this flow and we trust that.

We also can make sure that we are doing secure flows.

And this is really about authorization, which ultimately is our scopes and what we're allowing using least privilege.

It is also about delegation, making sure that the agents, we know who they are and they're working on behalf of a user and we can trust those two components.

And then it's about propagation.

Can all of this information be securely transferred along our agentic flow and back to the results of the prompt?

And doing these things will allow you to have trust in that agentic system. ¹

---

Would you like a summarized version, timestamps, or key takeaways from this transcript?

### Works cited:

1. Agentic Trust: Securing AI Interactions with Tokens & Delegation [https://youtu.be/lUQ2NKkCW\_Q](https://youtu.be/lUQ2NKkCW_Q)

