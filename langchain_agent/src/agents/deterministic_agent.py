"""
Deterministic Agent - Direct tool mapping without LLM
Provides predictable, rule-based tool execution for known commands
"""

import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ToolMapping:
    """Maps user intent to specific tool and parameters"""
    tool_name: str
    parameter_mapping: Dict[str, str]
    description: str


class DeterministicAgent:
    """
    Deterministic agent that maps known commands directly to MCP tools
    without LLM inference. Provides fast, predictable execution for
    common banking operations.
    """
    
    def __init__(self, mcp_client):
        """
        Initialize deterministic agent with MCP client
        
        Args:
            mcp_client: MCP client for tool execution
        """
        self.mcp_client = mcp_client
        self.tool_mappings = self._initialize_tool_mappings()
        logger.info("Deterministic agent initialized with %d tool mappings", len(self.tool_mappings))
    
    def _initialize_tool_mappings(self) -> Dict[str, ToolMapping]:
        """Initialize command to tool mappings"""
        return {
            # Account operations
            "list_accounts": ToolMapping(
                tool_name="get_accounts",
                parameter_mapping={},
                description="List all user accounts"
            ),
            "get_accounts": ToolMapping(
                tool_name="get_accounts",
                parameter_mapping={},
                description="Get all accounts"
            ),
            "show_accounts": ToolMapping(
                tool_name="get_accounts",
                parameter_mapping={},
                description="Show all accounts"
            ),
            
            # Balance operations
            "check_balance": ToolMapping(
                tool_name="get_balance",
                parameter_mapping={"account_id": "account_id"},
                description="Check account balance"
            ),
            "get_balance": ToolMapping(
                tool_name="get_balance",
                parameter_mapping={"account_id": "account_id"},
                description="Get account balance"
            ),
            "show_balance": ToolMapping(
                tool_name="get_balance",
                parameter_mapping={"account_id": "account_id"},
                description="Show account balance"
            ),
            
            # Transaction operations
            "list_transactions": ToolMapping(
                tool_name="get_transactions",
                parameter_mapping={"account_id": "account_id"},
                description="List account transactions"
            ),
            "get_transactions": ToolMapping(
                tool_name="get_transactions",
                parameter_mapping={"account_id": "account_id"},
                description="Get account transactions"
            ),
            "show_transactions": ToolMapping(
                tool_name="get_transactions",
                parameter_mapping={"account_id": "account_id"},
                description="Show account transactions"
            ),
            
            # Transfer operations
            "transfer": ToolMapping(
                tool_name="create_transfer",
                parameter_mapping={
                    "from_account_id": "from_account_id",
                    "to_account_id": "to_account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Transfer money between accounts"
            ),
            "create_transfer": ToolMapping(
                tool_name="create_transfer",
                parameter_mapping={
                    "from_account_id": "from_account_id",
                    "to_account_id": "to_account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Create a transfer"
            ),
            
            # Deposit operations
            "deposit": ToolMapping(
                tool_name="create_deposit",
                parameter_mapping={
                    "account_id": "account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Deposit money into account"
            ),
            "create_deposit": ToolMapping(
                tool_name="create_deposit",
                parameter_mapping={
                    "account_id": "account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Create a deposit"
            ),
            
            # Withdrawal operations
            "withdraw": ToolMapping(
                tool_name="create_withdrawal",
                parameter_mapping={
                    "account_id": "account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Withdraw money from account"
            ),
            "create_withdrawal": ToolMapping(
                tool_name="create_withdrawal",
                parameter_mapping={
                    "account_id": "account_id",
                    "amount": "amount",
                    "description": "description"
                },
                description="Create a withdrawal"
            ),
        }
    
    def execute_command(self, command: str, parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute a deterministic command
        
        Args:
            command: Command name (e.g., "list_accounts", "check_balance")
            parameters: Command parameters
            
        Returns:
            Tool execution result
            
        Raises:
            ValueError: If command is not recognized
        """
        command_lower = command.lower().strip()
        parameters = parameters or {}
        
        # Check if command is mapped
        if command_lower not in self.tool_mappings:
            available_commands = ", ".join(sorted(self.tool_mappings.keys()))
            raise ValueError(
                f"Unknown command: {command}. Available commands: {available_commands}"
            )
        
        mapping = self.tool_mappings[command_lower]
        
        # Map parameters
        tool_params = {}
        for param_name, mapping_key in mapping.parameter_mapping.items():
            if mapping_key in parameters:
                tool_params[param_name] = parameters[mapping_key]
        
        logger.info(
            "Executing deterministic command: %s -> tool: %s with params: %s",
            command,
            mapping.tool_name,
            tool_params
        )
        
        # Execute tool via MCP
        try:
            result = self.mcp_client.call_tool(mapping.tool_name, tool_params)
            
            return {
                "success": True,
                "command": command,
                "tool": mapping.tool_name,
                "result": result,
                "mode": "deterministic"
            }
        except Exception as e:
            logger.error("Deterministic command execution failed: %s", str(e))
            return {
                "success": False,
                "command": command,
                "tool": mapping.tool_name,
                "error": str(e),
                "mode": "deterministic"
            }
    
    def get_available_commands(self) -> List[Dict[str, str]]:
        """
        Get list of available deterministic commands
        
        Returns:
            List of command information dictionaries
        """
        return [
            {
                "command": cmd,
                "tool": mapping.tool_name,
                "description": mapping.description,
                "parameters": list(mapping.parameter_mapping.keys())
            }
            for cmd, mapping in sorted(self.tool_mappings.items())
        ]
    
    def is_deterministic_command(self, user_input: str) -> bool:
        """
        Check if user input matches a deterministic command
        
        Args:
            user_input: User's input text
            
        Returns:
            True if input matches a known command
        """
        # Simple check - first word matches a command
        first_word = user_input.lower().strip().split()[0] if user_input else ""
        return first_word in self.tool_mappings
    
    def parse_command_from_input(self, user_input: str) -> Optional[Dict[str, Any]]:
        """
        Parse command and parameters from user input
        
        Args:
            user_input: User's input text
            
        Returns:
            Dictionary with command and parameters, or None if not parseable
        """
        words = user_input.lower().strip().split()
        if not words:
            return None
        
        command = words[0]
        if command not in self.tool_mappings:
            return None
        
        # Simple parameter extraction (can be enhanced)
        parameters = {}
        
        # Look for account_id patterns
        for i, word in enumerate(words):
            if word in ["account", "from", "to"] and i + 1 < len(words):
                next_word = words[i + 1]
                if next_word.isdigit():
                    if word == "from":
                        parameters["from_account_id"] = next_word
                    elif word == "to":
                        parameters["to_account_id"] = next_word
                    else:
                        parameters["account_id"] = next_word
            
            # Look for amount
            if word == "amount" and i + 1 < len(words):
                try:
                    parameters["amount"] = float(words[i + 1].replace("$", ""))
                except ValueError:
                    pass
        
        return {
            "command": command,
            "parameters": parameters
        }


def create_deterministic_agent(mcp_client):
    """
    Factory function to create a deterministic agent
    
    Args:
        mcp_client: MCP client instance
        
    Returns:
        DeterministicAgent instance
    """
    return DeterministicAgent(mcp_client)
