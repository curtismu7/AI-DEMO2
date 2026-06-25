# **Primer**

## **Technical Enablement Guide: AI and Agentic Systems Primer**

### **Version 1.3**

This document provides a precise technical vocabulary and foundational primer for internal staff. It serves as a reference to ensure that communication with customers remains accurate, technically grounded, and free of common industry misconceptions.

This is a critical initiative. In the current landscape, the misuse of terms like "Agent" versus "LLM" or "Automation" often leads to overpromising or technical misalignment, both of which erode professional credibility.

## ---

**Section 1: Nomenclature and Terminology**

**Artificial Intelligence (AI):** A field of computer science dedicated to building systems that process information in a way that mimics cognitive functions. It is an umbrella term for many different technologies and should not be used to describe a specific product or feature without further qualification.

*Link:* [NIST Artificial Intelligence Resource Center](https://www.google.com/search?q=https://www.nist.gov/ai)

**Machine Learning (ML):** A specific approach to AI where a system is trained on data to identify patterns and make decisions. Unlike traditional software, which relies on hard-coded logic, ML models adjust their internal parameters based on the data they ingest.

*Link:* [ISO/IEC 23053:2022 Framework for Artificial Intelligence Using Machine Learning](https://www.iso.org/standard/74442.html)

**Large Language Model (LLM):** A sophisticated statistical model trained on massive text datasets to predict the next most likely word or token in a sequence. It is important to note that an LLM is a reasoning engine, not a database. It does not store facts in a structured table, but rather stores weights or associations between concepts.

*Link:* [Attention Is All You Need (Original Transformer Research Paper)](https://arxiv.org/abs/1706.03762)

**Generative AI:** A subset of AI models that focus on creating new data that resembles the training data. While traditional AI might classify an existing image, Generative AI creates a new one.

*Link:* [NIST Glossary of AI Terms](https://www.google.com/search?q=https://airc.nist.gov/AI_Glossary)

**Agent:** A software system that uses an LLM to perceive its environment, reason about how to achieve a goal, and execute actions via external tools. A distinction must be made between the agent and the user interface. A chatbot is the presentation layer, or frontend, while the agent is the backend reasoning and execution layer that manages tasks.

*Link:* [IBM: What are AI Agents?](https://www.ibm.com/topics/ai-agents)

**Agentic AI:** A system architecture where the primary logic is driven by autonomous agents. This move from chat-based AI to agentic AI represents a shift from a user asking questions to a user delegating complex workflows to a system that can work independently.

**Model Context Protocol (MCP):** An open standard designed to enable seamless, secure integration between AI models and local or remote data sources. It is important to clarify that MCP is a protocol, not a proxy or a data warehouse. It defines the communication schema so that any model can interact with any data source that implements the standard without custom integration code.

*Link:* [Official Model Context Protocol Specification](https://modelcontextprotocol.io)

**Identity and Access Management (IAM):** A security framework for managing digital identities. In AI contexts, IAM is used to ensure that an agent only accesses data or performs actions that the specific user or service account is authorized to execute.

*Link:* [NIST Special Publication 800-63 (Digital Identity Guidelines)](https://pages.nist.gov/800-63-3/)

**Retrieval-Augmented Generation (RAG):** An architecture that allows an LLM to access specific, up-to-date data during a conversation by retrieving relevant documents from an external source and providing them to the model as context. This process augments the reasoning capabilities of the model with information it was not originally trained on. This is required because LLMs are not real-time systems like search engines... they are limited by a fixed training cutoff date.

*Link:* [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)

## ---

**Section 2: Foundational Primer**

### **Distinguishing LLMs from Databases**

A common misconception is treating a Large Language Model as a database or a search engine. A database stores exact data points that can be retrieved with 100% fidelity. An LLM is a probabilistic engine. When it provides an answer, it is calculating the most likely sequence of words based on its training. If the model is not provided with external data via RAG or MCP, it may generate hallucinations, which are responses that sound plausible but are factually incorrect.

### **The Role of MCP as a Universal Interface**

In many customer environments, data is siloed across different applications and servers. Historically, to give an AI access to this data, a developer would have to write custom APIs or proxy layers for every single connection. The Model Context Protocol provides a standardized way for an agent to say "show me the files in this folder" or "query this database" using a common language. By implementing MCP, a company ensures that their AI tools are interoperable and that the model can be swapped out or upgraded without rewriting the data connections.

### **Machine Learning Types: Generative, Predictive, and Discriminative**

While the current market focus is on Generative AI, customers may also require Predictive or Discriminative AI.

* Predictive AI uses historical data to forecast future events, such as inventory needs or equipment failure.  
* Discriminative AI is used to categorize data, such as identifying whether an email is spam or if a medical image shows a specific condition.  
  Generative AI differs because its primary output is a new synthesis of information rather than a label or a numerical forecast.

### **The Logic of Agentic RAG**

Simple RAG is a linear process: a user asks a question, the system looks up a document, and the model summarizes it. Agentic RAG is more advanced because the agent can evaluate the quality of the information it finds. If the initial search results are insufficient or contradictory, an agent can decide to search a different database, refine its search terms, or ask the user for more clarification. This creates a more reliable and robust system for complex technical or legal inquiries.

### **Securing Agents with IAM**

When an AI agent is given the ability to take actions, such as updating a customer record in a CRM, it must be treated as a distinct identity within the network. This requires applying the Principle of Least Privilege. An agent should never be given admin access by default. Instead, IAM policies should be configured so that the agent operates under a service account with the minimum permissions necessary to perform its specific task. This ensures that even if an agentic system misinterprets a prompt, the potential for unauthorized data access or system damage is restricted.

A Must read is, The lethal trifecta for AI agents: private data, untrusted content, and external communication, ([https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)) 16 June 2025\.

### **Effective Prompt Construction**

The effectiveness of an LLM or an Agent is determined by the quality of the instructions provided, a practice known as prompt engineering. A successful prompt is not a simple question but a structured set of requirements.

*Link:* [OpenAI: Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)

A professional prompt typically includes:

1. Context: The background information or role the model should assume.  
2. Goals: A clear description of the problem the model needs to solve.  
3. Outcomes: The specific format, length, or tone expected for the output.  
4. Constraints: The rules the model must follow, such as what to avoid or what data to prioritize.

If prompts are simplistic and lack these details, the model is forced to fill in the gaps with its own statistical biases. This often leads to underspecification, where the AI provides a generic answer that fails to meet the actual technical or business need.

### **Interaction Workflow**

To summarize how these technologies work together in a professional environment:

1. A user provides a structured prompt to the system interface.  
2. The Agent receives the prompt and uses an LLM to reason about the required steps.  
3. The Agent uses RAG or MCP to retrieve factual context from authorized company sources.  
4. The IAM layer validates that the Agent has the permission to access those specific sources.  
5. The LLM processes the retrieved context and generates a suggested action or response.  
6. The Agent executes the action or presents the final output to the human user.

## 

# **Prompts Used**

For this session you are an expert software engineer and instructor now specializing in AI, and Agentic AI engineering, machine learning, prompt design, MCP, and any related topics and technologies related to AI-based technologies and development.

The problem I am solving is that AI technologies are new to our company and employees, and when speaking to customers, we need to speak the same language and speak it properly without conflating terms. Language matters. Words have meaning. If we get it wrong it turns into miscommunication or creates a lack of trust in our company and sales people.

I need a document or guide that outlines the terminology and nomenclature of AI, Agents, Agentic AI, Machine Learning, MCP, LLMs, IAM as it relates to securing agents, and related aspects. The nomenclature and terminology section should be followed by a section that gives a "For Dummies" level of explanation of what those technologies are, what their purpose is, how they interact with other parts of AI technology. A sort of foundational or primer type guide.

Ask me questions for clarity before generating it. Let's avoid marketing fluff style descriptions or corporate buzzwords. This needs to be a matter of fact and pedantic. Let's avoid the icons and emojis so this looks very professional. Also avoid using emdash unless it truly is appropriate. You can use commas or ellipses. After the first draft we will iterate on the content.

---

*This is a critical initiative. In the current landscape, the misuse of terms like "Agent" versus "LLM" or "Automation" often leads to overpromising or technical misalignment, both of which erode professional credibility.*

*To ensure this guide is as precise and useful as possible for your team, please provide clarification on the following points:*

1. ***The definition of MCP:** In this context, are you referring specifically to the **Model Context Protocol** (the open standard for connecting AI models to data sources and tools) or a more proprietary **Model Control Plane**?*  
2. ***The scope of IAM:** When discussing Identity and Access Management for agents, are we focusing on **Human-in-the-Loop (HITL)** authorization, or are we addressing the technical implementation of **Service Accounts** and **Machine-to-Machine (M2M)** credentials where the agent acts as a distinct identity?*  
3. ***The depth of Machine Learning:** Should we strictly define ML as the foundational backbone of LLMs, or do you need to distinguish between **Generative AI** and **Discriminative/Predictive AI** for your customers?*  
4. ***Agentic vs. Non-Agentic:** Is it important for your team to distinguish between **Simple RAG** (Retrieval-Augmented Generation) and **Agentic RAG**, or should we keep the focus on the broader "Agent" definition?*  
5. ***Target Deliverable Format:** While I will provide a text-based draft, is this intended to be a quick-reference "cheat sheet" (one page) or an exhaustive internal white paper?*

*Once you clarify these points, I will begin the first draft of the nomenclature and the foundational primer.*

Answering your questions in respective order...  
1\. MCP \= model context protocol in this case. This document is all AI related.  
2\. We are  focusing on both, but it just needs to be short "For Dummies" style, or maybe similar to BarCharts. This can't be an exhaustive training guide. Just a primer.  
3\. Let's include both. But I think the Discriminative/Predictive AI bits can be more like side notes. That doesn't really come up for us, but we should be aware of the terms and the difference.  
4.The broader agent definition is more important for this document, but similar to Discriminative/Predictive AI, there should be a kind of side note explaining simple and agentic RAG just so they are not surprised when they hear those terms.  
5\. I think it's too much for a cheat sheet, but I don't think the white paper format is appropriate here as I understand white papers. This is intended to be a technical enablement guide.   
Also, one other format criteria, let's avoid making words bold mid-sentence. Headers and keywords before their definition are OK. I want to stay inline with common writing standards. We don't have to be strictly aligned to things like AP Style. We just want to avoid the "flare".

---

*Result generated*  
---

This looks good. For the next iteration, for terms that have either an official specification, such as MCP, or have an industry standard or best practice, include a link with each item so the reader can link out for more detailed reading. Let's choose more formal or official sites vs. blogs or articles where possible.  
Let's add a little more detail for each item where feasible. As an example, in the case of MCP, let's make sure it clarifies what an MCP is and what it isn't. Some may think it's just another proxy server. Or in the case of LLMs, that they are not databases. 

---

*Result generated*  
---

Looking better. Let's not change anything in this next iteration except the following items. Keep the rest identical.  
\- For "Agent", let's additionally include clarity, as an example, that the chat bot you're talking to is not the agent itself, but an interface. Describe how you see best. That is just my example.  
\- For "Retrieval-Augmented Generation (RAG)", let's also include that RAG exists to augment data in the LLM and the reasoning, such as LLMs are not real time data like a search engine.   
Then validate any updates are still inline with the existing content and not causing conflicting explanations which would cause confusion to the reader.

---

*Result generated*  
---

One last change before I send it out for review. Let's keep everything in this current version the same, but we need to add a new topic in section 2 that talks about what prompts need to be more successful, such as context, goals, outcomes, constraints, and what happens if prompts are simplistic and lack details and context.