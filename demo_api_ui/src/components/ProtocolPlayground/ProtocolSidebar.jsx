import React from 'react';

export default function ProtocolSidebar({ protocols, selectedProtocol, onSelectProtocol }) {
  return (
    <div className="sidebar-protocols">
      <h3 className="sidebar-title">Protocols</h3>
      <nav className="protocol-list">
        {protocols.map(id => (
          <button
            key={id}
            className={`protocol-item ${selectedProtocol === id ? 'active' : ''}`}
            onClick={() => onSelectProtocol(id)}
            title={id}
          >
            {id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
          </button>
        ))}
      </nav>
    </div>
  );
}
