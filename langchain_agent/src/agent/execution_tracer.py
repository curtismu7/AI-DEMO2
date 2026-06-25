"""
Real-time execution tracer for LangChain MCP Agent.

This module provides real-time tracing and visualization capabilities
for the LangChain agent execution flow.
"""
import json
import logging
from datetime import datetime
from html import escape as html_escape
from typing import Dict, List, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class AgentExecutionTracer:
    """
    Real-time execution tracer that captures agent execution steps
    and generates interactive visualizations.
    """
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.execution_steps = []
        self.step_counter = 0
        self.start_time = datetime.now()
        
        # Ensure visualizations directory exists
        self.viz_dir = Path("visualizations")
        self.viz_dir.mkdir(exist_ok=True)
        
    def log_step(self, step_type: str, component: str, data: Dict[str, Any]):
        """Log an execution step with timing information."""
        self.step_counter += 1
        step = {
            "step": self.step_counter,
            "type": step_type,
            "component": component,
            "timestamp": datetime.now().isoformat(),
            "elapsed_ms": int((datetime.now() - self.start_time).total_seconds() * 1000),
            "session_id": self.session_id,
            "data": self._sanitize_data(data)
        }
        self.execution_steps.append(step)
        logger.debug(f"Trace Step {self.step_counter}: {step_type} - {component}")
        
    def _sanitize_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Remove sensitive information from logged data."""
        if not isinstance(data, dict):
            return {"value": self._serialize_value(data)}
            
        sanitized = {}
        for key, value in data.items():
            if any(sensitive in key.lower() for sensitive in ['password', 'token', 'key', 'secret', 'auth']):
                sanitized[key] = "[REDACTED]"
            elif isinstance(value, str) and len(value) > 200:
                sanitized[key] = value[:200] + "..."
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_data(value)
            elif isinstance(value, list) and len(value) > 5:
                sanitized[key] = [self._serialize_value(item) for item in value[:5]] + ["... truncated"]
            elif isinstance(value, list):
                sanitized[key] = [self._serialize_value(item) for item in value]
            else:
                sanitized[key] = self._serialize_value(value)
        return sanitized
    
    def _serialize_value(self, value: Any) -> Any:
        """Convert value to JSON-serializable format."""
        import uuid
        from datetime import datetime, date
        
        if isinstance(value, uuid.UUID):
            return str(value)
        elif isinstance(value, (datetime, date)):
            return value.isoformat()
        elif hasattr(value, '__dict__'):
            # For objects with attributes, convert to dict
            try:
                return str(value)
            except:
                return f"<{type(value).__name__} object>"
        elif isinstance(value, bytes):
            return f"<bytes: {len(value)} bytes>"
        elif callable(value):
            return f"<function: {getattr(value, '__name__', 'unknown')}>"
        else:
            try:
                # Test if it's JSON serializable
                import json
                json.dumps(value)
                return value
            except (TypeError, ValueError):
                return str(value)[:200]
    
    def save_trace_and_create_visualization(self) -> str:
        """Save execution trace and create HTML visualization."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"execution_trace_{self.session_id}_{timestamp}"
        
        # Save JSON trace
        json_file = self.viz_dir / f"{filename}.json"
        trace_data = {
            "session_id": self.session_id,
            "start_time": self.start_time.isoformat(),
            "end_time": datetime.now().isoformat(),
            "total_steps": len(self.execution_steps),
            "total_duration_ms": int((datetime.now() - self.start_time).total_seconds() * 1000),
            "execution_steps": self.execution_steps
        }
        
        try:
            with open(json_file, "w") as f:
                json.dump(trace_data, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Error saving trace JSON: {e}")
            # Try to save with string conversion fallback
            try:
                with open(json_file, "w") as f:
                    json.dump(self._make_fully_serializable(trace_data), f, indent=2)
            except Exception as e2:
                logger.error(f"Error saving trace JSON with fallback: {e2}")
                # Save as text file instead
                with open(json_file.with_suffix('.txt'), "w") as f:
                    f.write(str(trace_data))
        
        # Create HTML visualization
        html_file = self.viz_dir / f"{filename}.html"
        self._create_html_visualization(html_file, trace_data)

        # Retention: keep only the newest 500 traces (JSON + matching HTML)
        # so the visualizations dir cannot grow unbounded.
        try:
            trace_files = sorted(
                self.viz_dir.glob("execution_trace_*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for old_file in trace_files[500:]:
                old_file.unlink(missing_ok=True)
                old_file.with_suffix(".html").unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Trace retention cleanup failed: {e}")

        logger.info(f"Execution trace saved: {json_file}")
        logger.info(f"Visualization created: {html_file}")
        
        # Check if integrated trace server is running and log the URL
        try:
            from api.integrated_trace_server import get_trace_server_url
            server_url = get_trace_server_url()
            if server_url:
                trace_id = html_file.stem
                logger.info(f"View trace in browser: {server_url}/trace/{trace_id}")
        except ImportError:
            pass  # Trace server not available
        
        return str(html_file)
    
    def _create_html_visualization(self, html_file: Path, trace_data: Dict[str, Any]):
        """Create interactive HTML visualization."""

        # XSS guard: a "</script>" inside trace content would otherwise
        # terminate the <script> block early and inject markup.
        trace_json = json.dumps(trace_data).replace("</", "<\\/")
        session_id_html = html_escape(str(trace_data['session_id']))

        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LangChain MCP Agent Execution - {session_id_html}</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{ 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
            margin: 0; 
            padding: 24px; 
            background: #fafbfc;
            color: #24292e;
            line-height: 1.5;
        }}
        .container {{ 
            max-width: 1200px; 
            margin: 0 auto; 
            background: #ffffff; 
            border: 1px solid #e1e4e8;
            border-radius: 6px; 
            box-shadow: 0 1px 3px rgba(27,31,35,0.12);
        }}
        .header {{
            padding: 24px 32px;
            border-bottom: 1px solid #e1e4e8;
            background: #f6f8fa;
        }}
        .header-nav {{
            margin-bottom: 16px;
        }}
        .back-btn {{
            background: #f6f8fa;
            border: 1px solid #d0d7de;
            color: #24292e;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s ease;
            text-decoration: none;
            display: inline-block;
        }}
        .back-btn:hover {{
            background: #f3f4f6;
            border-color: #d0d7de;
        }}
        h1 {{ 
            color: #24292e; 
            margin: 0 0 8px 0;
            font-size: 24px;
            font-weight: 600;
        }}
        .session-info {{ 
            color: #586069; 
            font-size: 14px;
            margin: 0;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1px;
            background: #e1e4e8;
            margin: 0;
        }}
        .stat-card {{
            background: #ffffff;
            padding: 20px;
            text-align: center;
        }}
        .stat-value {{
            font-size: 28px;
            font-weight: 600;
            color: #24292e;
            margin-bottom: 4px;
        }}
        .stat-label {{
            color: #586069;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 500;
        }}
        .controls {{
            padding: 16px 32px;
            border-bottom: 1px solid #e1e4e8;
            background: #ffffff;
        }}
        .filter-buttons {{
            margin: 0;
        }}
        .filter-btn {{
            background: #f6f8fa;
            border: 1px solid #d0d7de;
            color: #24292e;
            padding: 6px 12px;
            margin: 0 4px 0 0;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s ease;
        }}
        .filter-btn:hover {{
            background: #f3f4f6;
            border-color: #d0d7de;
        }}
        .filter-btn.active {{
            background: #0969da;
            color: #ffffff;
            border-color: #0969da;
        }}
        .timeline {{ 
            max-height: 600px; 
            overflow-y: auto; 
            background: #ffffff;
        }}
        .step {{ 
            border-bottom: 1px solid #f0f3f6; 
            background: #ffffff;
        }}
        .step:last-child {{ border-bottom: none; }}
        .step-header {{
            display: flex; 
            align-items: center; 
            padding: 12px 32px; 
            cursor: pointer;
            transition: background-color 0.15s ease;
            user-select: none;
        }}
        .step-header:hover {{ 
            background-color: #f6f8fa;
        }}
        .step-header.expanded {{
            background-color: #f6f8fa;
            border-bottom: 1px solid #d0d7de;
        }}
        .step-number {{ 
            background: #24292e;
            color: #ffffff; 
            border-radius: 50%; 
            width: 28px; 
            height: 28px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-weight: 600; 
            margin-right: 12px; 
            font-size: 11px; 
            flex-shrink: 0;
        }}
        .step-summary {{ flex: 1; }}
        .step-type {{ 
            font-weight: 600; 
            color: #24292e; 
            margin-bottom: 2px;
            font-size: 13px;
        }}
        .step-component {{ 
            color: #656d76; 
            font-size: 11px;
            font-weight: 500;
        }}
        .step-toggle {{
            color: #656d76;
            font-size: 12px;
            margin-left: 8px;
            transition: transform 0.15s ease;
        }}
        .step-toggle.expanded {{
            transform: rotate(90deg);
        }}
        .step-content {{ 
            display: none;
            padding: 16px 32px 20px 72px;
            background: #f6f8fa;
            border-top: 1px solid #d0d7de;
        }}
        .step-content.expanded {{
            display: block;
        }}
        .step-data {{ 
            background: #ffffff;
            padding: 12px; 
            border-radius: 6px; 
            font-size: 12px; 
            color: #24292e; 
            white-space: pre-wrap;
            border: 1px solid #d0d7de;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }}
        .payload-section {{
            margin: 8px 0;
            padding: 12px;
            background: #ffffff;
            border: 1px solid #d0d7de;
            border-radius: 6px;
        }}
        .payload-header {{
            font-weight: 600;
            color: #24292e;
            margin-bottom: 8px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .payload-content {{
            background: #f6f8fa;
            padding: 8px;
            border-radius: 3px;
            border: 1px solid #d0d7de;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 11px;
            max-height: 150px;
            overflow-y: auto;
            color: #24292e;
        }}
        .step-time {{ 
            color: #656d76; 
            font-size: 11px; 
            margin-right: 8px; 
            flex-shrink: 0;
            background: #f6f8fa;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 500;
            border: 1px solid #d0d7de;
        }}
        
        /* Step type specific colors - minimal and professional */
        .user-input .step-number {{ background: #0969da; }}
        .websocket-incoming .step-number {{ background: #0969da; }}
        .websocket-outgoing .step-number {{ background: #1a7f37; }}
        .mcp-tool-start .step-number {{ background: #d1242f; }}
        .tool-start .step-number {{ background: #d1242f; }}
        .mcp-tool-end .step-number {{ background: #1a7f37; }}
        .tool-end .step-number {{ background: #1a7f37; }}
        .llm-start .step-number {{ background: #8250df; }}
        .llm-end .step-number {{ background: #8250df; }}
        .memory-update .step-number {{ background: #656d76; }}
        .oauth-check .step-number {{ background: #bf8700; }}
        .oauth-flow .step-number {{ background: #bf8700; }}
        .response-sent .step-number {{ background: #1a7f37; }}
        .chain-start .step-number {{ background: #0969da; }}
        .chain-end .step-number {{ background: #1a7f37; }}
        .direct-tool-execution .step-number {{ background: #fd7e14; }}
        .direct-tool-result .step-number {{ background: #1a7f37; }}
        .template-response-generation .step-number {{ background: #8250df; }}
        .tool-retry-start .step-number {{ background: #fd7e14; }}
        .tool-retry-response .step-number {{ background: #1a7f37; }}
        .tool-retry-formatted .step-number {{ background: #8250df; }}
        .tool-retry-error .step-number {{ background: #cf222e; }}
        .direct-response-return .step-number {{ background: #6c757d; }}
        .error .step-number {{ background: #cf222e; }}
        .tool-error .step-number {{ background: #cf222e; }}
        .llm-error .step-number {{ background: #cf222e; }}
        .chain-error .step-number {{ background: #cf222e; }}
        
        @media (max-width: 768px) {{
            body {{ padding: 16px; }}
            .header {{ padding: 16px 20px; }}
            .header-nav {{ margin-bottom: 12px; }}
            .controls {{ 
                padding: 12px 20px; 
            }}
            .filter-buttons {{
                text-align: left;
                flex-wrap: wrap;
                gap: 4px;
            }}
            .filter-btn {{
                margin: 2px;
            }}
            .step-header {{ 
                padding: 12px 20px;
                flex-wrap: wrap;
            }}
            .step-content {{
                padding: 16px 20px 20px 48px;
            }}
            .step-time {{ 
                order: 3;
                margin-top: 4px;
                margin-right: 0;
            }}
            .step-toggle {{
                order: 4;
                margin-left: auto;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-nav">
                <button class="back-btn" onclick="goBack()">← Back to Traces</button>
            </div>
            <h1>LangChain MCP Agent Execution Trace</h1>
            <div class="session-info">
                Session {session_id_html} •
                {trace_data['total_duration_ms']}ms • 
                {trace_data['total_steps']} steps
            </div>
        </div>
        
        <div class="stats-grid" id="stats"></div>
        
        <div class="controls">
            <div class="filter-buttons">
                <button class="filter-btn active" onclick="filterSteps('all')">All</button>
                <button class="filter-btn" onclick="filterSteps('websocket')">WebSocket</button>
                <button class="filter-btn" onclick="filterSteps('tool')">Tools</button>
                <button class="filter-btn" onclick="filterSteps('llm')">LLM</button>
                <button class="filter-btn" onclick="filterSteps('memory')">Memory</button>
                <button class="filter-btn" onclick="filterSteps('error')">Errors</button>
                <span style="margin: 0 8px; color: #d0d7de;">|</span>
                <button class="filter-btn" onclick="expandAllSteps()">Expand All</button>
                <button class="filter-btn" onclick="collapseAllSteps()">Collapse All</button>
            </div>
        </div>
        
        <div class="timeline" id="timeline"></div>
    </div>

    <script>
        const traceData = {trace_json};

        function escapeHtml(value) {{
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }}

        function renderStats() {{
            const stats = document.getElementById('stats');
            const steps = traceData.execution_steps;
            
            const mcpTools = steps.filter(s => s.type.includes('mcp_tool_start')).length;
            const llmCalls = steps.filter(s => s.type.includes('llm_start')).length;
            const memoryUpdates = steps.filter(s => s.type.includes('memory')).length;
            const avgStepTime = steps.length > 0 ? Math.round(traceData.total_duration_ms / steps.length) : 0;
            
            stats.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${{steps.length}}</div>
                    <div class="stat-label">Total Steps</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${{traceData.total_duration_ms}}</div>
                    <div class="stat-label">Duration (ms)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${{mcpTools}}</div>
                    <div class="stat-label">MCP Tools</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${{llmCalls}}</div>
                    <div class="stat-label">LLM Calls</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${{avgStepTime}}</div>
                    <div class="stat-label">Avg Step (ms)</div>
                </div>
            `;
        }}
        
        function createStepDescription(step) {{
            const stepType = step.type.replace(/_/g, ' ').toUpperCase();
            const data = step.data;
            let title = stepType;
            let component = step.component;
            
            // Enhance titles with tool names for MCP-related steps
            if (data && data.tool_name) {{
                switch(step.type) {{
                    case 'mcp_tool_request':
                        title = `MCP TOOL REQUEST: ${{data.tool_name}}`;
                        break;
                    case 'mcp_tool_response':
                        title = `MCP TOOL RESPONSE: ${{data.tool_name}}`;
                        break;
                    case 'tool_start':
                        title = `TOOL START: ${{data.tool_name}}`;
                        break;
                    case 'tool_end':
                        title = `TOOL END: ${{data.tool_name}}`;
                        break;
                    case 'tool_retry_start':
                        title = `TOOL RETRY START: ${{data.tool_name}}`;
                        break;
                    case 'tool_retry_response':
                        title = `TOOL RETRY RESPONSE: ${{data.tool_name}}`;
                        break;
                    case 'tool_retry_formatted':
                        title = `TOOL RETRY FORMATTED: ${{data.tool_name}}`;
                        break;
                    case 'tool_retry_error':
                        title = `TOOL RETRY ERROR: ${{data.tool_name}}`;
                        break;
                    case 'mcp_tool_error':
                        title = `MCP TOOL ERROR: ${{data.tool_name}}`;
                        break;
                    case 'direct_tool_execution':
                        title = `DIRECT TOOL EXECUTION: ${{data.tool_name}}`;
                        break;
                    case 'direct_tool_result':
                        title = `DIRECT TOOL RESULT: ${{data.tool_name}}`;
                        break;
                }}
            }}
            
            // Enhance other step types with relevant context
            if (data.response_type && step.type === 'template_response_generation') {{
                title = `TEMPLATE RESPONSE: ${{data.response_type.replace(/_/g, ' ').toUpperCase()}}`;
            }}
            
            if (data.model && step.type === 'llm_start') {{
                title = `LLM START: ${{data.model}}`;
            }}
            
            if (data.model && step.type === 'llm_end') {{
                title = `LLM END: ${{data.model}}`;
            }}
            
            if (data.message_type && step.type.includes('websocket')) {{
                title = `${{stepType}}: ${{data.message_type.replace(/_/g, ' ').toUpperCase()}}`;
            }}
            
            if (data.action && step.type === 'memory_update') {{
                title = `MEMORY UPDATE: ${{data.action.replace(/_/g, ' ').toUpperCase()}}`;
            }}
            
            return {{
                title: title,
                component: component
            }};
        }}
        
        function formatStepData(data) {{
            let formatted = '';
            
            // Handle special payload types
            if (data.payload) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">WebSocket Payload</div>
                    <div class="payload-content">${{escapeHtml(JSON.stringify(data.payload, null, 2))}}</div>
                </div>`;
            }}

            if (data.input_parameters) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">Input Parameters</div>
                    <div class="payload-content">${{escapeHtml(JSON.stringify(data.input_parameters, null, 2))}}</div>
                </div>`;
            }}

            if (data.result && typeof data.result === 'object') {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">Tool Result</div>
                    <div class="payload-content">${{escapeHtml(JSON.stringify(data.result, null, 2))}}</div>
                </div>`;
            }}

            if (data.prompt_preview) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">LLM Prompt</div>
                    <div class="payload-content">${{escapeHtml(data.prompt_preview)}}</div>
                </div>`;
            }}

            if (data.response_preview) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">LLM Response</div>
                    <div class="payload-content">${{escapeHtml(data.response_preview)}}</div>
                </div>`;
            }}

            if (data.body) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">HTTP Body</div>
                    <div class="payload-content">${{escapeHtml(typeof data.body === 'object' ? JSON.stringify(data.body, null, 2) : data.body)}}</div>
                </div>`;
            }}

            if (data.error) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">Error Details</div>
                    <div class="payload-content">${{escapeHtml(data.error)}}</div>
                </div>`;
            }}
            
            // Add remaining data
            const remainingData = {{ ...data }};
            delete remainingData.payload;
            delete remainingData.input_parameters;
            delete remainingData.result;
            delete remainingData.prompt_preview;
            delete remainingData.response_preview;
            delete remainingData.body;
            delete remainingData.error;
            
            if (Object.keys(remainingData).length > 0) {{
                formatted += `<div class="payload-section">
                    <div class="payload-header">Additional Data</div>
                    <div class="payload-content">${{escapeHtml(JSON.stringify(remainingData, null, 2))}}</div>
                </div>`;
            }}

            return formatted || `<div class="payload-content">${{escapeHtml(JSON.stringify(data, null, 2))}}</div>`;
        }}
        
        function renderTimeline() {{
            const timeline = document.getElementById('timeline');
            const steps = traceData.execution_steps;
            
            timeline.innerHTML = '';
            
            steps.forEach((step, index) => {{
                const stepDiv = document.createElement('div');
                stepDiv.className = `step ${{step.type.replace(/_/g, '-')}}`;
                stepDiv.dataset.stepType = step.type;
                
                const formattedData = formatStepData(step.data);
                const stepId = `step-${{index}}`;
                
                // Create enhanced step description with tool name if available
                const stepDescription = createStepDescription(step);
                
                stepDiv.innerHTML = `
                    <div class="step-header" onclick="toggleStep('${{stepId}}')">
                        <div class="step-number">${{escapeHtml(step.step)}}</div>
                        <div class="step-summary">
                            <div class="step-type">${{escapeHtml(stepDescription.title)}}</div>
                            <div class="step-component">${{escapeHtml(stepDescription.component)}}</div>
                        </div>
                        <div class="step-time">${{escapeHtml(step.elapsed_ms)}}ms</div>
                        <div class="step-toggle">▶</div>
                    </div>
                    <div class="step-content" id="${{stepId}}">
                        <div class="step-data">${{formattedData}}</div>
                    </div>
                `;
                
                timeline.appendChild(stepDiv);
            }});
        }}
        
        function toggleStep(stepId) {{
            const content = document.getElementById(stepId);
            const header = content.previousElementSibling;
            const toggle = header.querySelector('.step-toggle');
            
            if (content.classList.contains('expanded')) {{
                content.classList.remove('expanded');
                header.classList.remove('expanded');
                toggle.classList.remove('expanded');
            }} else {{
                content.classList.add('expanded');
                header.classList.add('expanded');
                toggle.classList.add('expanded');
            }}
        }}
        
        function expandAllSteps() {{
            const contents = document.querySelectorAll('.step-content');
            const headers = document.querySelectorAll('.step-header');
            const toggles = document.querySelectorAll('.step-toggle');
            
            contents.forEach(content => content.classList.add('expanded'));
            headers.forEach(header => header.classList.add('expanded'));
            toggles.forEach(toggle => toggle.classList.add('expanded'));
        }}
        
        function collapseAllSteps() {{
            const contents = document.querySelectorAll('.step-content');
            const headers = document.querySelectorAll('.step-header');
            const toggles = document.querySelectorAll('.step-toggle');
            
            contents.forEach(content => content.classList.remove('expanded'));
            headers.forEach(header => header.classList.remove('expanded'));
            toggles.forEach(toggle => toggle.classList.remove('expanded'));
        }}
        
        function filterSteps(filter) {{
            const steps = document.querySelectorAll('.step');
            const buttons = document.querySelectorAll('.filter-btn');
            
            // Update button states
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            // Filter steps
            steps.forEach(step => {{
                const stepType = step.dataset.stepType;
                let show = false;
                
                switch(filter) {{
                    case 'all':
                        show = true;
                        break;
                    case 'websocket':
                        show = stepType.includes('websocket') || stepType.includes('user_input') || stepType.includes('response_sent');
                        break;
                    case 'tool':
                        show = stepType.includes('tool') || stepType.includes('mcp') || stepType.includes('direct_tool') || stepType.includes('retry');
                        break;
                    case 'llm':
                        show = stepType.includes('llm') || stepType.includes('chain');
                        break;
                    case 'memory':
                        show = stepType.includes('memory');
                        break;
                    case 'error':
                        show = stepType.includes('error');
                        break;
                }}
                
                step.style.display = show ? 'flex' : 'none';
            }});
        }}
        
        function goBack() {{
            // Try to go back in browser history first
            if (window.history.length > 1) {{
                window.history.back();
            }} else {{
                // If no history, try to go to trace server root
                // Check if we're being served from the trace server
                if (window.location.pathname.includes('/trace/')) {{
                    window.location.href = '/';
                }} else {{
                    // Fallback: close window or show message
                    if (window.opener) {{
                        window.close();
                    }} else {{
                        alert('Please close this tab to return to the trace overview.');
                    }}
                }}
            }}
        }}
        
        // Initialize
        document.addEventListener('DOMContentLoaded', function() {{
            renderStats();
            renderTimeline();
        }});
    </script>
</body>
</html>"""
        
        with open(html_file, 'w') as f:
            f.write(html_content)
    
    def _make_fully_serializable(self, obj: Any) -> Any:
        """Recursively make an object fully JSON serializable."""
        import uuid
        from datetime import datetime, date
        
        if isinstance(obj, dict):
            return {str(key): self._make_fully_serializable(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [self._make_fully_serializable(item) for item in obj]
        elif isinstance(obj, tuple):
            return [self._make_fully_serializable(item) for item in obj]
        elif isinstance(obj, set):
            return [self._make_fully_serializable(item) for item in obj]
        elif isinstance(obj, uuid.UUID):
            return str(obj)
        elif isinstance(obj, (datetime, date)):
            return obj.isoformat()
        elif hasattr(obj, '__dict__'):
            return str(obj)
        elif callable(obj):
            return f"<function: {getattr(obj, '__name__', 'unknown')}>"
        else:
            try:
                json.dumps(obj)
                return obj
            except (TypeError, ValueError):
                return str(obj)


class TracingMixin:
    """
    Mixin class to add tracing capabilities to the LangChain MCP Agent.
    """
    
    def _create_tracer(self, session_id: str) -> AgentExecutionTracer:
        """Create a new execution tracer for the session."""
        return AgentExecutionTracer(session_id)
    
    def _log_user_input(self, tracer: AgentExecutionTracer, message: str, session_id: str):
        """Log user input step."""
        tracer.log_step("user_input", "WebSocket Handler", {
            "message": message,
            "session_id": session_id,
            "message_length": len(message),
            "timestamp": datetime.now().isoformat()
        })
    
    def _log_agent_start(self, tracer: AgentExecutionTracer):
        """Log agent processing start."""
        tracer.log_step("agent_start", "LangChain Agent", {
            "agent_type": "LangChainMCPAgent",
            "tools_available": len(self._tools) if hasattr(self, '_tools') and self._tools else 0,
            "model": getattr(self.llm, 'model_name', 'unknown') if hasattr(self, 'llm') else 'unknown'
        })
    
    def _log_memory_check(self, tracer: AgentExecutionTracer, user_identified: bool):
        """Log memory/context check."""
        tracer.log_step("memory_check", "Conversation Memory", {
            "action": "check_user_identification",
            "user_identified": user_identified
        })
    
    def _log_tool_selection(self, tracer: AgentExecutionTracer, tool_name: str, reason: str, params: Dict[str, Any]):
        """Log MCP tool selection."""
        tracer.log_step("tool_selection", "MCP Tool Provider", {
            "selected_tool": tool_name,
            "reason": reason,
            "input_params": params
        })
    
    def _log_mcp_tool_start(self, tracer: AgentExecutionTracer, tool_name: str, server: str, input_params: Dict[str, Any] = None):
        """Log MCP tool execution start with detailed input."""
        tracer.log_step("mcp_tool_start", "MCP Client Manager", {
            "tool": tool_name,
            "server": server,
            "input_parameters": input_params or {},
            "auth_required": "banking_" in tool_name or "user_management_" in tool_name,
            "tool_category": self._categorize_tool(tool_name)
        })
    
    def _log_mcp_tool_end(self, tracer: AgentExecutionTracer, tool_name: str, result: Any, duration_ms: int, success: bool = True):
        """Log MCP tool execution end with detailed result."""
        tracer.log_step("mcp_tool_end", "MCP Client Manager", {
            "tool": tool_name,
            "result": result,
            "execution_time_ms": duration_ms,
            "success": success,
            "result_type": type(result).__name__,
            "result_size": len(str(result)) if result else 0,
            "tool_category": self._categorize_tool(tool_name)
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
    
    def _log_llm_start(self, tracer: AgentExecutionTracer, context: str, prompt: str = None, input_tokens: int = None):
        """Log LLM processing start with detailed input."""
        tracer.log_step("llm_start", "LangChain Agent", {
            "model": getattr(self.llm, 'model_name', 'unknown') if hasattr(self, 'llm') else 'unknown',
            "context": context,
            "prompt_preview": prompt[:500] + "..." if prompt and len(prompt) > 500 else prompt,
            "estimated_input_tokens": input_tokens,
            "temperature": getattr(self.llm, 'temperature', 'unknown') if hasattr(self, 'llm') else 'unknown'
        })
    
    def _log_llm_end(self, tracer: AgentExecutionTracer, response: str, processing_time_ms: int, output_tokens: int = None):
        """Log LLM processing end with detailed output."""
        tracer.log_step("llm_end", "LangChain Agent", {
            "response_generated": True,
            "response_preview": response[:300] + "..." if len(response) > 300 else response,
            "response_length": len(response),
            "processing_time_ms": processing_time_ms,
            "estimated_output_tokens": output_tokens,
            "tokens_per_second": round(output_tokens / (processing_time_ms / 1000)) if output_tokens and processing_time_ms > 0 else None
        })
    
    def _log_memory_update(self, tracer: AgentExecutionTracer, action: str, details: Dict[str, Any]):
        """Log memory update."""
        tracer.log_step("memory_update", "Conversation Memory", {
            "action": action,
            **details
        })
    
    def _log_response_sent(self, tracer: AgentExecutionTracer, response: str, session_id: str):
        """Log response sent to user."""
        tracer.log_step("response_sent", "WebSocket Handler", {
            "response_length": len(response),
            "session_id": session_id,
            "total_steps": len(tracer.execution_steps)
        })
    
    def _log_error(self, tracer: AgentExecutionTracer, component: str, error: Exception):
        """Log error occurrence."""
        tracer.log_step("error", component, {
            "error": str(error),
            "error_type": type(error).__name__,
            "error_module": getattr(error, '__module__', 'unknown')
        })
    
    def _log_websocket_message(self, tracer: AgentExecutionTracer, direction: str, message: Dict[str, Any]):
        """Log WebSocket message with full payload."""
        # Ensure the message is serializable
        serializable_message = self._make_serializable(message)
        
        tracer.log_step(f"websocket_{direction}", "WebSocket Handler", {
            "direction": direction,
            "message_type": message.get("type", "unknown"),
            "payload": serializable_message,
            "payload_size": len(str(serializable_message)),
            "timestamp": datetime.now().isoformat()
        })
    
    def _make_serializable(self, obj: Any) -> Any:
        """Make an object JSON serializable."""
        import uuid
        from datetime import datetime, date
        
        if isinstance(obj, dict):
            return {key: self._make_serializable(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [self._make_serializable(item) for item in obj]
        elif isinstance(obj, uuid.UUID):
            return str(obj)
        elif isinstance(obj, (datetime, date)):
            return obj.isoformat()
        elif hasattr(obj, '__dict__'):
            try:
                return str(obj)
            except:
                return f"<{type(obj).__name__} object>"
        else:
            return obj
    
    def _log_http_request(self, tracer: AgentExecutionTracer, method: str, url: str, headers: Dict[str, str], body: Any):
        """Log HTTP request with details."""
        tracer.log_step("http_request", "HTTP Client", {
            "method": method,
            "url": url,
            "headers": headers,
            "body": body,
            "body_size": len(str(body)) if body else 0
        })
    
    def _log_http_response(self, tracer: AgentExecutionTracer, status_code: int, headers: Dict[str, str], body: Any, duration_ms: int):
        """Log HTTP response with details."""
        tracer.log_step("http_response", "HTTP Client", {
            "status_code": status_code,
            "status_text": self._get_status_text(status_code),
            "headers": headers,
            "body": body,
            "body_size": len(str(body)) if body else 0,
            "duration_ms": duration_ms,
            "success": 200 <= status_code < 300
        })
    
    def _log_oauth_flow(self, tracer: AgentExecutionTracer, flow_type: str, details: Dict[str, Any]):
        """Log OAuth flow details."""
        tracer.log_step("oauth_flow", "OAuth Manager", {
            "flow_type": flow_type,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
    
    def _log_database_operation(self, tracer: AgentExecutionTracer, operation: str, table: str, query: str, result_count: int = None):
        """Log database operations."""
        tracer.log_step("database_operation", "Database", {
            "operation": operation,
            "table": table,
            "query": query[:200] + "..." if len(query) > 200 else query,
            "result_count": result_count
        })
    
    def _get_status_text(self, status_code: int) -> str:
        """Get HTTP status text."""
        status_texts = {
            200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized",
            403: "Forbidden", 404: "Not Found", 500: "Internal Server Error"
        }
        return status_texts.get(status_code, "Unknown")