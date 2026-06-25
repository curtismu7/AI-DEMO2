#!/usr/bin/env python3
"""
Test script for the real-time execution tracing functionality.

This script demonstrates how the tracing works by creating a simple
execution trace and visualization.
"""
import sys
import asyncio
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from agent.execution_tracer import AgentExecutionTracer


async def test_tracing():
    """Test the execution tracing functionality."""
    print("🧪 Testing LangChain MCP Agent Execution Tracing")
    print("=" * 60)
    
    # Create a test tracer
    session_id = "test_session_001"
    tracer = AgentExecutionTracer(session_id)
    
    print(f"📊 Created tracer for session: {session_id}")
    
    # Simulate a typical agent execution flow
    print("🔄 Simulating agent execution steps...")
    
    # Step 1: WebSocket incoming message
    tracer.log_step("websocket_incoming", "WebSocket Handler", {
        "direction": "incoming",
        "message_type": "user_message",
        "payload": {
            "type": "user_message",
            "content": "Hi, I'm john@example.com and I want to check my balance",
            "session_id": session_id,
            "timestamp": "2024-09-26T16:48:22.123Z",
            "client_info": {
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                "ip_address": "192.168.1.100"
            }
        },
        "payload_size": 245
    })
    
    # Step 2: User input processing
    tracer.log_step("user_input", "WebSocket Handler", {
        "message": "Hi, I'm john@example.com and I want to check my balance",
        "session_id": session_id,
        "message_length": 52
    })
    
    await asyncio.sleep(0.1)  # Simulate processing time
    
    # Step 2: Agent start
    tracer.log_step("agent_start", "LangChain Agent", {
        "agent_type": "LangChainMCPAgent",
        "tools_available": 5,
        "model": "gpt-3.5-turbo"
    })
    
    await asyncio.sleep(0.2)
    
    # Step 3: Memory check
    tracer.log_step("memory_check", "Conversation Memory", {
        "action": "check_user_identification",
        "user_identified": False
    })
    
    await asyncio.sleep(0.1)
    
    # Step 4: Email detection
    tracer.log_step("email_detection", "LangChain Agent", {
        "detected_email": "john@example.com",
        "action": "user_identification_attempt"
    })
    
    await asyncio.sleep(0.1)
    
    # Step 5: Tool selection
    tracer.log_step("tool_selection", "MCP Tool Provider", {
        "selected_tool": "banking_query_user_by_email",
        "reason": "User identification required",
        "input_params": {"email": "john@example.com"}
    })
    
    await asyncio.sleep(0.3)
    
    # Step 6: MCP tool request with detailed payload
    tracer.log_step("mcp_tool_request", "MCP Server: banking", {
        "tool_name": "banking_query_user_by_email",
        "server_name": "banking",
        "input_parameters": {
            "email": "john@example.com",
            "include_profile": True,
            "check_status": "active"
        },
        "session_id": session_id,
        "agent_token_present": True,
        "tool_description": "Query user information by email address",
        "request_timestamp": "2024-09-26T17:05:15.123Z"
    })
    
    await asyncio.sleep(0.5)  # Simulate MCP server call
    
    # Step 7: MCP tool response with detailed payload
    tracer.log_step("mcp_tool_response", "MCP Server: banking", {
        "tool_name": "banking_query_user_by_email",
        "server_name": "banking",
        "result": {
            "type": "success",
            "data": {
                "exists": True,
                "user": {
                    "id": "12345",
                    "firstName": "John",
                    "lastName": "Doe",
                    "email": "john@example.com",
                    "status": "active",
                    "created_at": "2023-01-15T10:30:00Z",
                    "last_login": "2024-09-26T16:45:00Z"
                }
            },
            "metadata": {
                "query_time_ms": 45,
                "cache_hit": False,
                "server_version": "1.2.3"
            }
        },
        "result_type": "dict",
        "execution_time_ms": 450,
        "session_id": session_id,
        "success": True,
        "response_timestamp": "2024-09-26T17:05:15.573Z",
        "has_auth_challenge": False
    })
    
    await asyncio.sleep(0.1)
    
    # Step 8: Memory update
    tracer.log_step("memory_update", "Conversation Memory", {
        "action": "set_user_identified",
        "user_id": "12345",
        "user_email": "john@example.com"
    })
    
    await asyncio.sleep(0.2)
    
    # Step 9: Template response generation (no LLM call for user identification)
    response_text = "✅ Welcome back, John! I've identified your account. How can I help you with your banking today?"
    
    tracer.log_step("template_response_generation", "Response Generator", {
        "response_type": "user_identification_success",
        "template_used": "welcome_back_template",
        "variables": {
            "first_name": "John",
            "user_id": "12345",
            "email": "john@example.com"
        },
        "generated_response": response_text,
        "llm_used": False,
        "reason": "System template for user identification - no LLM needed for simple welcome message"
    })
    
    await asyncio.sleep(0.1)
    
    # Step 10: Final memory update
    tracer.log_step("memory_update", "Conversation Memory", {
        "action": "store_conversation",
        "user_message_length": 52,
        "assistant_response_length": 156
    })
    
    await asyncio.sleep(0.1)
    
    # Step 11: WebSocket outgoing message
    tracer.log_step("websocket_outgoing", "WebSocket Handler", {
        "direction": "outgoing",
        "message_type": "assistant_response",
        "payload": {
            "type": "assistant_response",
            "content": response_text,
            "session_id": session_id,
            "timestamp": "2024-09-26T16:48:25.456Z",
            "processing_time_ms": 2612,
            "metadata": {
                "tools_used": ["banking_query_user_by_email"],
                "user_identified": True,
                "response_type": "welcome"
            }
        },
        "payload_size": 387
    })
    
    # Step 12: Example tool retry (to show enhanced naming)
    tracer.log_step("tool_retry_start", "MCP Server: banking", {
        "tool_name": "banking_get_account_balance",
        "server_name": "banking",
        "original_parameters": {
            "account_id": "acc_123"
        },
        "session_id": session_id,
        "retry_reason": "OAuth authorization completed",
        "agent_token_present": True
    })
    
    await asyncio.sleep(0.3)
    
    # Step 13: Tool retry response
    tracer.log_step("tool_retry_response", "MCP Server: banking", {
        "tool_name": "banking_get_account_balance",
        "server_name": "banking",
        "result": {
            "account_id": "acc_123",
            "balance": 1234.56,
            "currency": "USD",
            "available_balance": 1234.56
        },
        "result_type": "dict",
        "execution_time_ms": 290,
        "session_id": session_id,
        "success": True,
        "retry_successful": True
    })
    
    await asyncio.sleep(0.1)
    
    # Step 14: Response sent
    tracer.log_step("response_sent", "WebSocket Handler", {
        "response_length": len(response_text),
        "session_id": session_id,
        "total_steps": 14
    })
    
    print("✅ Simulation completed!")
    
    # Save trace and create visualization
    print("💾 Saving execution trace and creating visualization...")
    html_file = tracer.save_trace_and_create_visualization()
    
    print(f"🎨 Visualization created: {html_file}")
    
    # Show summary
    trace = tracer.execution_steps
    total_time = trace[-1]['elapsed_ms'] if trace else 0
    mcp_tools = len([s for s in trace if 'mcp_tool' in s['type']])
    llm_calls = len([s for s in trace if 'llm_start' in s['type']])
    template_responses = len([s for s in trace if 'template_response' in s['type']])
    memory_updates = len([s for s in trace if s['type'] == 'memory_update'])
    
    print()
    print("📈 Execution Summary:")
    print(f"   • Total Steps: {len(trace)}")
    print(f"   • Total Time: {total_time}ms")
    print(f"   • MCP Tools Used: {mcp_tools}")
    print(f"   • LLM Calls: {llm_calls}")
    print(f"   • Template Responses: {template_responses}")
    print(f"   • Memory Updates: {memory_updates}")
    print()
    print("💡 Note: User identification uses template responses, not LLM calls")
    print("   This is more efficient for simple system responses.")
    
    print()
    print("🎉 Test completed successfully!")
    print(f"   Open {html_file} in your browser to see the interactive execution trace")
    print("   This is exactly what your agent will generate for every conversation!")


if __name__ == "__main__":
    asyncio.run(test_tracing())