"""
LangChain callback handler for detailed execution tracing.

This module provides a callback handler that captures detailed information
about LangChain agent execution, including tool calls, LLM interactions,
and chain executions.
"""
import logging
from typing import Dict, List, Any, Optional, Union
from datetime import datetime
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from langchain_core.messages import BaseMessage

from .execution_tracer import AgentExecutionTracer

logger = logging.getLogger(__name__)


class DetailedTracingCallbackHandler(BaseCallbackHandler):
    """
    Callback handler that captures detailed execution information for visualization.
    """
    
    def __init__(self, tracer: AgentExecutionTracer):
        super().__init__()
        self.tracer = tracer
        self.tool_start_times = {}
        self.chain_start_times = {}
        self.llm_start_times = {}
    
    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool starts running."""
        tool_name = serialized.get("name", "unknown_tool")
        self.tool_start_times[run_id] = datetime.now()
        
        # Parse input parameters if it's JSON
        input_params = {}
        try:
            import json
            if input_str.strip().startswith('{'):
                input_params = json.loads(input_str)
            else:
                input_params = {"input": input_str}
        except Exception:
            input_params = {"input": input_str}
        
        self.tracer.log_step("tool_start", f"Tool: {tool_name}", {
            "tool_name": tool_name,
            "input_parameters": input_params,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {},
            "tool_category": self._categorize_tool(tool_name)
        })
    
    def on_tool_end(
        self,
        output: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool finishes running."""
        start_time = self.tool_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.tool_start_times[run_id]
        
        # Parse output if it's JSON
        parsed_output = output
        try:
            import json
            if output.strip().startswith('{') or output.strip().startswith('['):
                parsed_output = json.loads(output)
        except Exception:
            parsed_output = output
        
        self.tracer.log_step("tool_end", "Tool Execution", {
            "output": parsed_output,
            "raw_output": output,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": True,
            "output_size": len(output)
        })
    
    def on_tool_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool encounters an error."""
        start_time = self.tool_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.tool_start_times[run_id]
        
        self.tracer.log_step("tool_error", "Tool Execution", {
            "error": str(error),
            "error_type": type(error).__name__,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": False
        })
    
    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM starts running."""
        self.llm_start_times[run_id] = datetime.now()
        
        model_name = serialized.get("name", "unknown_model")
        
        # Combine all prompts
        full_prompt = "\n".join(prompts) if prompts else ""
        
        self.tracer.log_step("llm_start", f"LLM: {model_name}", {
            "model_name": model_name,
            "prompt": full_prompt[:1000] + "..." if len(full_prompt) > 1000 else full_prompt,
            "prompt_count": len(prompts),
            "estimated_tokens": len(full_prompt.split()) * 1.3,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {}
        })
    
    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM finishes running."""
        start_time = self.llm_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.llm_start_times[run_id]
        
        # Extract response text
        response_text = ""
        if response.generations:
            response_text = "\n".join([
                gen.text for generation_list in response.generations 
                for gen in generation_list
            ])
        
        # Extract token usage if available
        token_usage = {}
        if hasattr(response, 'llm_output') and response.llm_output:
            token_usage = response.llm_output.get('token_usage', {})
        
        self.tracer.log_step("llm_end", "LLM Response", {
            "response": response_text[:500] + "..." if len(response_text) > 500 else response_text,
            "full_response_length": len(response_text),
            "duration_ms": duration_ms,
            "token_usage": token_usage,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "generation_count": len(response.generations) if response.generations else 0
        })
    
    def on_llm_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM encounters an error."""
        start_time = self.llm_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.llm_start_times[run_id]
        
        self.tracer.log_step("llm_error", "LLM Error", {
            "error": str(error),
            "error_type": type(error).__name__,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id
        })
    
    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain starts running."""
        self.chain_start_times[run_id] = datetime.now()
        
        chain_name = serialized.get("name", "unknown_chain")
        
        self.tracer.log_step("chain_start", f"Chain: {chain_name}", {
            "chain_name": chain_name,
            "inputs": inputs,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {}
        })
    
    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain finishes running."""
        start_time = self.chain_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.chain_start_times[run_id]
        
        self.tracer.log_step("chain_end", "Chain Completion", {
            "outputs": outputs,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": True
        })
    
    def on_chain_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain encounters an error."""
        start_time = self.chain_start_times.get(run_id)
        duration_ms = 0
        if start_time:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            del self.chain_start_times[run_id]
        
        self.tracer.log_step("chain_error", "Chain Error", {
            "error": str(error),
            "error_type": type(error).__name__,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": False
        })
    
    def _categorize_tool(self, tool_name: str) -> str:
        """Categorize tool by its name."""
        if "banking_" in tool_name:
            return "banking"
        elif "user_management_" in tool_name:
            return "user_management"
        elif "oauth" in tool_name.lower():
            return "authentication"
        else:
            return "general"