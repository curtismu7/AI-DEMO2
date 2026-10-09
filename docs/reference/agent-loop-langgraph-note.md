Agent loop: create_react_agent handles the cycle of the model calling a tool, getting the result, and calling the model again. The loop is a graph, so you don't hand-write it.
Memory: the MemorySaver checkpointer persists state per conversation.
HITL: the tests include test_hitl_interrupt_extraction, so the agent pauses for human approval. That depends on LangGraph's interrupt and resume.