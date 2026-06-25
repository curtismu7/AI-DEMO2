import { useState } from 'react';
import DraggableModal from './DraggableModal';
import './MCPToolsListModal.css';

export default function MCPToolsListModal({ show, onClose, tools = [] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTools = tools.filter(tool => {
    const s = searchTerm.toLowerCase();
    return tool.name?.toLowerCase().includes(s) || tool.description?.toLowerCase().includes(s);
  });

  return (
    <DraggableModal
      isOpen={!!show}
      onClose={onClose}
      title={`Available MCP Tools (${tools.length})`}
      defaultWidth={560}
      defaultHeight={560}
      storageKey="mcp-tools-list-modal"
    >
      {/* Fixed search bar */}
      <div className="mcp-tools-search-bar" style={{ flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search tools..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="mcp-tools-search-input"
        />
      </div>

      {/* Scrollable tool list */}
      <div className="mcp-tools-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filteredTools.length === 0 ? (
          <div className="mcp-tools-empty">
            <p>{searchTerm ? 'No tools match your search' : 'No tools found'}</p>
          </div>
        ) : (
          filteredTools.map((tool, idx) => (
            <div key={`${tool.name}-${idx}`} className="mcp-tool-item">
              <div className="mcp-tool-name">
                <span className="mcp-tool-icon">🛠️</span>
                {tool.name}
              </div>
              <p className="mcp-tool-description">{tool.description || '(no description)'}</p>
              {tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                <div className="mcp-tool-inputs">
                  <strong>Inputs:</strong>
                  <div className="mcp-tool-input-list">
                    {Object.keys(tool.inputSchema.properties).map(name => (
                      <span key={name} className="mcp-tool-input-badge">{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </DraggableModal>
  );
}
