# LangChain MCP Agent Trace Server

A web-based interface for browsing and viewing execution traces from your LangChain MCP Agent.

## 🚀 Quick Start

### Option 1: Standalone Trace Server

Start the trace server to browse existing trace files:

```bash
python start_trace_server.py
```

Then open http://localhost:8090 in your browser.

### Option 2: Integrated with Your Agent

Add trace server integration to your main application:

```python
# In your main.py or wherever you start your agent
from api.integrated_trace_server import start_integrated_trace_server, stop_integrated_trace_server

async def main():
    # Start your agent components
    # ...
    
    # Start the integrated trace server
    await start_integrated_trace_server(traces_dir="visualizations", port=8090)
    
    try:
        # Run your main application
        # ...
    finally:
        # Clean shutdown
        await stop_integrated_trace_server()
```

## 🎯 Features

### Web Interface
- **Browse all traces** - See all execution traces in one place
- **Trace metadata** - View session ID, duration, steps, file size
- **Sort by date** - Newest traces first
- **Click to view** - Open any trace in the detailed viewer

### Trace Details
- **Full execution flow** - See every step of agent execution
- **Accordion interface** - Expand/collapse steps for easy navigation
- **Enhanced descriptions** - Tool names and context in step titles
- **Payload inspection** - View detailed request/response data
- **Performance metrics** - Timing information for each step

### API Endpoints
- `GET /` - Main trace browser interface
- `GET /trace/{trace_id}` - View specific trace
- `GET /api/traces` - Get traces list as JSON
- `GET /api/trace/{trace_id}/data` - Get trace data as JSON

## 📊 What You'll See

The trace server shows:

### Trace List
- Session IDs and creation times
- Execution duration and step counts
- File sizes and availability
- Quick access to detailed views

### Detailed Trace View
- **WebSocket Messages** - Incoming/outgoing communication
- **MCP Tool Calls** - Request/response payloads with tool names
- **LLM Interactions** - Prompts, responses, and token usage
- **Memory Operations** - Context updates and user identification
- **OAuth Flows** - Authentication challenges and completions
- **Error Handling** - Detailed error information and recovery

## 🔧 Configuration

### Default Settings
- **Port**: 8090
- **Traces Directory**: `visualizations/`
- **Host**: `0.0.0.0` (accessible from network)

### Custom Configuration
```python
# Custom port and directory
await start_integrated_trace_server(
    traces_dir="custom_traces", 
    port=9000
)
```

## 💡 Usage Tips

### For Development
- Keep the trace server running while developing
- Refresh the browser to see new traces
- Use filters to focus on specific types of operations
- Expand/collapse steps to manage information density

### For Debugging
- Look for error steps (red indicators)
- Check MCP tool payloads for data issues
- Verify OAuth flows are completing correctly
- Monitor performance with timing data

### For Demonstrations
- Use the web interface for clean presentations
- Share trace URLs with team members
- Export trace data via API endpoints
- Show real-time agent execution flows

## 🌐 Network Access

The server binds to `0.0.0.0`, making it accessible from:
- **Local**: http://localhost:8090
- **Network**: http://your-ip:8090
- **Docker**: Expose port 8090 in your container

## 🔒 Security Note

The trace server is intended for development and internal use. It serves trace files without authentication. In production environments:

- Run on internal networks only
- Use firewall rules to restrict access
- Consider adding authentication if needed
- Review trace data for sensitive information

## 🎉 Benefits

### Over Individual HTML Files
- **Centralized browsing** - All traces in one place
- **No file management** - Automatic discovery and listing
- **Better navigation** - Easy switching between traces
- **Real-time updates** - See new traces immediately

### For Team Collaboration
- **Shared access** - Team members can view traces
- **Consistent interface** - Same experience for everyone
- **Easy sharing** - Send trace URLs instead of files
- **API access** - Programmatic trace analysis

Your LangChain MCP Agent traces are now easily accessible through a professional web interface! 🎊