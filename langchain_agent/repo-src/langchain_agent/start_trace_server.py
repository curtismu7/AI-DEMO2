#!/usr/bin/env python3
"""
Start the LangChain MCP Agent Trace Server

This script starts a web server to browse and view execution trace files.
"""
import asyncio
import sys
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from api.trace_server import run_trace_server


async def main():
    """Main function to start the trace server."""
    traces_dir = "visualizations"
    port = 8090
    
    # Check if traces directory exists
    if not Path(traces_dir).exists():
        print(f"📁 Creating traces directory: {traces_dir}")
        Path(traces_dir).mkdir(exist_ok=True)
    
    print("🚀 LangChain MCP Agent Trace Server")
    print("=" * 50)
    print(f"📁 Traces directory: {traces_dir}")
    print(f"🌐 Server URL: http://localhost:{port}")
    print(f"📊 Browse your execution traces in the web interface")
    print()
    print("💡 Tips:")
    print("   • Execute conversations with your agent to generate traces")
    print("   • Traces are automatically saved to the visualizations/ directory")
    print("   • Refresh the page to see new traces")
    print("   • Click on any trace to view the detailed execution flow")
    print()
    print("Press Ctrl+C to stop the server")
    print()
    
    try:
        await run_trace_server(traces_dir, port)
    except KeyboardInterrupt:
        print("\n👋 Trace server stopped")


if __name__ == "__main__":
    asyncio.run(main())