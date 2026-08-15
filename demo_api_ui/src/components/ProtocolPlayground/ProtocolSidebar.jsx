import React from 'react';

/**
 * ProtocolSidebar — protocol list navigator
 *
 * @param {{id: string, name: string}[]} protocols - flow id + display name
 * @param {string} selectedProtocol - currently selected protocol ID
 * @param {function} onSelectProtocol - callback(id) when protocol clicked
 */
export default function ProtocolSidebar({ protocols, selectedProtocol, onSelectProtocol }) {
  if (!protocols || !Array.isArray(protocols)) {
    return null;
  }

  return (
    <>
      <h3 className="sidebar-title">Protocols</h3>
      <nav className="protocol-list">
        {protocols.map(({ id, name }) => (
          <button
            key={id}
            className={`protocol-item ${selectedProtocol === id ? 'active' : ''}`}
            onClick={() => onSelectProtocol(id)}
            title={id}
          >
            {name || id}
          </button>
        ))}
      </nav>
    </>
  );
}
