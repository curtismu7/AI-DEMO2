import React, { useState, useEffect, useMemo } from 'react';
import protocolFlows from '../../data/protocolFlows.json';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolViewer from './ProtocolViewer';
import './ProtocolPlayground.css';

/** Shape ExecutionEngine.getState() returns — the viewer and activity panel read it directly. */
const EMPTY_EXECUTION_STATE = {
  currentStep: null,
  results: [],
  error: null,
};

const ProtocolPlayground = () => {
  // Convert protocolFlows object to array of protocol objects
  const protocolArray = useMemo(() => Object.values(protocolFlows || {}), []);

  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [executionState, setExecutionState] = useState(EMPTY_EXECUTION_STATE);

  // Set first protocol as default on mount
  useEffect(() => {
    if (protocolArray && protocolArray.length > 0) {
      setSelectedProtocol(protocolArray[0]);
    }
  }, [protocolArray]);

  // Handle protocol selection - convert ID back to protocol object
  const handleProtocolSelect = (protocolId) => {
    const protocol = protocolArray.find(p => p.id === protocolId);
    if (protocol) {
      setSelectedProtocol(protocol);
    }
    // Reset execution state when switching protocols
    setExecutionState(EMPTY_EXECUTION_STATE);
  };

  // Handle execution state updates
  const handleExecutionStateChange = (newState) => {
    setExecutionState((prevState) => ({
      ...prevState,
      ...newState,
    }));
  };

  return (
    <div className="protocol-playground">
      <div className="protocol-playground__container">
        <aside className="protocol-playground__sidebar">
          <ProtocolSidebar
            protocols={protocolArray.map(p => p.id)}
            selectedProtocol={selectedProtocol?.id}
            onSelectProtocol={handleProtocolSelect}
          />
        </aside>

        <main className="protocol-playground__viewer">
          {selectedProtocol ? (
            <ProtocolViewer
              flowSpec={selectedProtocol}
              executionState={executionState}
              onExecutionStateChange={handleExecutionStateChange}
            />
          ) : (
            <div className="protocol-playground__empty-state">
              <p>No protocols available</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ProtocolPlayground;
