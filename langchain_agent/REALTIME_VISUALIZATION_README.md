# Real-time LangChain MCP Agent Visualization

Your LangChain MCP Agent now includes **real-time execution tracing and visualization** capabilities! Every conversation generates beautiful, interactive visualizations showing exactly how your agent processes requests.

## 🌐 Web-Based Trace Server (Recommended)

The easiest way to view your traces is through the **built-in web server** that provides a professional interface for browsing and viewing all your execution traces.

### 🚀 Quick Start with Trace Server

```bash
# Start the trace server
python start_trace_server.py

# Open in browser
open http://localhost:8090
```

### ✨ Trace Server Features

- **📋 Browse All Traces** - See all execution traces in one organized list
- **🔍 Detailed Viewer** - Click any trace to view the complete execution flow
- **📊 Trace Metadata** - Session ID, duration, steps count, file size, creation time
- **🗑️ Bulk Management** - Delete all traces with one click
- **🔄 Auto-Refresh** - Easy refresh to see new traces
- **📱 Responsive Design** - Works on desktop, tablet, and mobile
- **🎨 Professional UI** - Clean, GitHub-style interface

### 🎯 Trace Server Benefits

✅ **No more opening individual HTML files**  
✅ **Centralized trace management**  
✅ **Easy sharing with team members**  
✅ **Professional presentation interface**  
✅ **Real-time trace discovery**  
✅ **Bulk operations (delete all)**  

## 📁 What's Been Added

### ✅ New Files Created

1. **`src/agent/execution_tracer.py`** - Core tracing functionality
2. **`src/api/trace_server.py`** - Web server for browsing traces
3. **`src/api/integrated_trace_server.py`** - Integration with main agent
4. **`start_trace_server.py`** - Simple script to start the server
5. **`test_tracing.py`** - Test script to verify tracing works
6. **`TRACE_SERVER_README.md`** - Detailed server documentation

### ✅ Modified Files

1. **`src/agent/langchain_mcp_agent.py`** - Added tracing capabilities
2. **`src/api/message_processor.py`** - Updated to use traced processing

## 🚀 How It Works

### Automatic Tracing

Every time a user sends a message to your agent, the system now:

1. **Creates an execution tracer** for the session
2. **Logs every step** of the processing pipeline
3. **Captures timing information** for performance analysis
4. **Sanitizes sensitive data** for security
5. **Generates interactive HTML visualization** automatically
6. **Saves JSON trace data** for analysis

### What Gets Traced

- 📝 **User Input** - Message received and processed
- 🤖 **Agent Processing** - LangChain agent initialization and execution
- 🧠 **Memory Operations** - Context checks and conversation storage
- 🛠️ **MCP Tool Execution** - Tool selection, execution, and results
- 🔐 **OAuth Flows** - Authentication challenges and completions
- 💭 **LLM Calls** - Language model processing and responses
- ⚡ **Performance Metrics** - Timing data for each step

## 📁 Generated Files

For each conversation, the system creates:

```
visualizations/
├── execution_trace_[session_id]_[timestamp].json    # Raw trace data
└── execution_trace_[session_id]_[timestamp].html    # Interactive visualization
```

### Example Files
- `execution_trace_user123_20241226_143022.json`
- `execution_trace_user123_20241226_143022.html`

## 🎨 Visualization Features

### Interactive HTML Dashboard

Each visualization includes:

- **📊 Statistics Dashboard** - Total steps, duration, tool usage
- **🔍 Step-by-Step Timeline** - Detailed execution flow with accordion interface
- **🎯 Filtering Options** - View specific types of operations (WebSocket, Tools, LLM, Memory, Errors)
- **⏱️ Performance Metrics** - Timing for each component
- **🔒 Security-Aware** - Sensitive data automatically redacted
- **🔙 Navigation** - Back button to return to trace overview

### Visual Elements

- **Color-coded steps** by component type
- **Accordion interface** - Expand/collapse steps for easy navigation
- **Enhanced descriptions** - Tool names and context in step titles
- **Payload inspection** - View detailed request/response data
- **Responsive design** works on desktop and mobile
- **Professional styling** perfect for demos and debugging

## 🌐 Trace Server Usage

### Starting the Server

```bash
# First, activate your virtual environment
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate     # On Windows

# Option 1: Standalone server (recommended)
python start_trace_server.py

# Option 2: Custom port
python start_trace_server.py visualizations 9000

# Server will be available at http://localhost:8090 (or your custom port)
```

### Server Features

#### Main Overview Page
- **📋 Trace List** - All traces sorted by creation time (newest first)
- **📊 Metadata Display** - Session ID, duration, steps count, file size
- **🔄 Quick Actions** - Refresh and Delete All buttons
- **👆 Click to View** - Click any trace to see detailed execution
- **📱 Responsive** - Works on all devices

#### Detailed Trace View
- **🎯 Accordion Interface** - Expand/collapse each execution step
- **🏷️ Enhanced Descriptions** - Tool names and context in step titles
- **📦 Payload Inspection** - View detailed request/response data
- **⏱️ Performance Metrics** - Timing information for each step
- **🔙 Navigation** - Back button to return to overview
- **🔍 Filtering** - Filter by operation type (WebSocket, Tools, LLM, etc.)

#### Trace Management
- **🔍 Auto-Discovery** - Automatically finds all trace files in visualizations/
- **🗑️ Bulk Delete** - "Delete All" button with confirmation dialog
- **🔄 Real-time Updates** - Refresh to see new traces immediately
- **🧹 File Cleanup** - Deletes both JSON and HTML files

### Integration with Your Agent

```python
# Add to your main application
from api.integrated_trace_server import start_integrated_trace_server, stop_integrated_trace_server

async def main():
    try:
        # Start trace server alongside your agent
        await start_integrated_trace_server(traces_dir="visualizations", port=8090)
        
        # Your agent code here...
        # Every conversation will automatically appear in the web interface
        
    finally:
        # Clean shutdown
        await stop_integrated_trace_server()
```

### API Endpoints

The trace server also provides REST API endpoints:

- **GET /** - Main trace browser interface
- **GET /trace/{trace_id}** - View specific trace
- **GET /api/traces** - Get traces list as JSON
- **GET /api/trace/{trace_id}/data** - Get trace data as JSON
- **DELETE /api/traces** - Delete all trace files

### Benefits Over Individual HTML Files

✅ **Centralized browsing** - All traces in one organized interface  
✅ **No file management** - Automatic discovery and listing  
✅ **Better navigation** - Easy switching between traces  
✅ **Real-time updates** - See new traces immediately  
✅ **Team collaboration** - Share server URL instead of files  
✅ **Professional presentation** - Clean, consistent interface  
✅ **Bulk operations** - Delete all traces with one click  

## 🧪 Testing the Integration

### Method 1: Test with Trace Server (Recommended)

```bash
# 1. Start the trace server
python start_trace_server.py

# 2. In another terminal, generate test traces
python test_tracing.py

# 3. Refresh the browser to see the new trace
# 4. Click on the trace to view detailed execution
```

### Method 2: Test Individual Files

```bash
# Generate a test trace
python test_tracing.py

# Open the generated HTML file
open visualizations/execution_trace_*.html
```

### Method 3: Live Agent Testing

```bash
# 1. Start the trace server
python start_trace_server.py

# 2. Start your agent
python -m src.main

# 3. Have conversations through your WebSocket interface
# 4. View traces in real-time at http://localhost:8090
```

## 📈 Using the Visualizations

### For Development & Debugging

1. **Debug Issues** - See exactly where problems occur
2. **Optimize Performance** - Identify slow components
3. **Understand Flow** - Visualize complex agent logic
4. **Track OAuth** - Monitor authentication flows

### For Presentations & Documentation

1. **Demo Your System** - Show sophisticated AI architecture
2. **Explain Complexity** - Visual aid for technical discussions
3. **Document Behavior** - Capture real execution examples
4. **Training Materials** - Help others understand the system

## 🔧 Configuration

### Enable/Disable Tracing

The tracing is now enabled by default. To disable it temporarily:

```python
# In your message processor, change:
response = await self.agent.process_message_with_tracing(message, session_id)

# Back to:
response = await self.agent.process_message(message, session_id)
```

### Customize Visualization

You can modify the HTML template in `src/agent/execution_tracer.py` to:
- Change colors and styling
- Add custom metrics
- Modify the layout
- Include additional data

## 📊 Example Execution Flow

A typical conversation trace shows:

```
Step 1: user_input - WebSocket Handler
Step 2: agent_start - LangChain Agent  
Step 3: memory_check - Conversation Memory
Step 4: email_detection - LangChain Agent
Step 5: tool_selection - MCP Tool Provider
Step 6: mcp_tool_start - MCP Client Manager
Step 7: oauth_check - OAuth Manager
Step 8: mcp_tool_end - MCP Client Manager
Step 9: memory_update - Conversation Memory
Step 10: llm_start - LangChain Agent
Step 11: llm_end - LangChain Agent
Step 12: response_sent - WebSocket Handler
```

## 🎯 Benefits

### For You as Developer

- **🐛 Easier Debugging** - See exactly what's happening
- **⚡ Performance Optimization** - Identify bottlenecks
- **🔍 System Understanding** - Visualize complex interactions
- **📈 Monitoring** - Track system behavior over time

### For Stakeholders

- **🎨 Professional Demos** - Beautiful visualizations
- **📚 Documentation** - Self-documenting system behavior
- **🔒 Security Transparency** - Show secure data handling
- **🚀 Technical Credibility** - Demonstrate sophisticated architecture

## 🎉 What This Means

Your LangChain MCP Agent is now **self-documenting** and **self-visualizing**! Every conversation creates a beautiful, interactive trace showing:

- How your AI agent thinks and reasons
- How MCP tools are selected and executed
- How OAuth authentication flows work
- How conversation memory is managed
- Performance characteristics of each component

## 🚀 Recommended Workflow

### For Development
1. **Start the trace server**: `python start_trace_server.py`
2. **Start your agent**: `python -m src.main`
3. **Have conversations** through your WebSocket interface
4. **View traces in real-time** at http://localhost:8090
5. **Debug and optimize** using the detailed execution flows

### For Demonstrations
1. **Start the trace server** before your demo
2. **Execute sample conversations** to generate traces
3. **Show the trace server interface** - professional and impressive
4. **Click through traces** to show detailed execution flows
5. **Highlight key features** like MCP tool calls, OAuth flows, performance

### For Team Collaboration
1. **Share the server URL** - http://your-ip:8090
2. **Team members can browse traces** without file sharing
3. **Consistent interface** for everyone
4. **API access** for automated analysis

## 💡 Pro Tips

### Trace Server Usage
- **Keep it running** during development for continuous monitoring
- **Use "Delete All"** to clean up before important demos
- **Share server URL** with team members for collaboration
- **Use filters** in detailed view to focus on specific operations
- **Expand/collapse steps** to manage information density

### Performance Analysis
- **Look for slow steps** (high ms values) to identify bottlenecks
- **Check MCP tool execution times** for optimization opportunities
- **Monitor OAuth flow duration** for authentication performance
- **Compare traces** across different conversation types

### Debugging
- **Filter by "Errors"** to quickly find issues
- **Expand error steps** to see detailed error information
- **Check MCP tool payloads** for data validation issues
- **Verify OAuth flows** are completing correctly

Your LangChain MCP Agent now provides enterprise-grade observability and visualization capabilities with a professional web interface! 🎊