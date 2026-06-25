"""
Integrated Trace Server for LangChain MCP Agent

This module provides an integrated trace server that can be started alongside
your main agent to provide real-time trace viewing capabilities.
"""
import asyncio
import logging
from pathlib import Path
from typing import Optional

from .trace_server import TraceServer

logger = logging.getLogger(__name__)


class IntegratedTraceServer:
    """
    Integrated trace server that runs alongside the main agent.
    """
    
    def __init__(self, traces_dir: str = "visualizations", port: int = 8090):
        self.trace_server = TraceServer(traces_dir, port)
        self.server_task: Optional[asyncio.Task] = None
        self.running = False
    
    async def start(self):
        """Start the integrated trace server."""
        if self.running:
            logger.warning("Trace server is already running")
            return
        
        try:
            logger.info(f"Starting integrated trace server on port {self.trace_server.port}")
            self.server_task = asyncio.create_task(self.trace_server.start_server())
            self.running = True
            logger.info(f"Trace server available at http://localhost:{self.trace_server.port}")
        except Exception as e:
            logger.error(f"Failed to start trace server: {e}")
            self.running = False
    
    async def stop(self):
        """Stop the integrated trace server."""
        if not self.running or not self.server_task:
            return
        
        try:
            logger.info("Stopping integrated trace server")
            self.server_task.cancel()
            try:
                await self.server_task
            except asyncio.CancelledError:
                pass
            self.running = False
            logger.info("Trace server stopped")
        except Exception as e:
            logger.error(f"Error stopping trace server: {e}")
    
    def is_running(self) -> bool:
        """Check if the trace server is running."""
        return self.running and self.server_task and not self.server_task.done()


# Global instance for easy integration
_integrated_trace_server: Optional[IntegratedTraceServer] = None


async def start_integrated_trace_server(traces_dir: str = "visualizations", port: int = 8090):
    """Start the integrated trace server (global instance)."""
    global _integrated_trace_server
    
    if _integrated_trace_server and _integrated_trace_server.is_running():
        logger.info("Integrated trace server is already running")
        return
    
    _integrated_trace_server = IntegratedTraceServer(traces_dir, port)
    await _integrated_trace_server.start()


async def stop_integrated_trace_server():
    """Stop the integrated trace server (global instance)."""
    global _integrated_trace_server
    
    if _integrated_trace_server:
        await _integrated_trace_server.stop()
        _integrated_trace_server = None


def get_trace_server_url() -> Optional[str]:
    """Get the URL of the running trace server."""
    global _integrated_trace_server
    
    if _integrated_trace_server and _integrated_trace_server.is_running():
        return f"http://localhost:{_integrated_trace_server.trace_server.port}"
    return None