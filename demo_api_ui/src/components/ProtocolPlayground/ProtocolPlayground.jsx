import React, { useState, useEffect } from 'react';
import protocolFlows from '../../data/protocolFlows.json';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolViewer from './ProtocolViewer';
import './ProtocolPlayground.css';

const ProtocolPlayground = () => {
  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [executionState, setExecutionState] = useState({
    currentStep: 0,
    isPlaying: false,
    completedSteps: [],
    error: null,
  });

  // Set first protocol as default on mount
  useEffect(() => {
    if (protocolFlows && protocolFlows.length > 0) {
      setSelectedProtocol(protocolFlows[0]);
    }
  }, []);

  // Handle protocol selection
  const handleProtocolSelect = (protocol) => {
    setSelectedProtocol(protocol);
    // Reset execution state when switching protocols
    setExecutionState({
      currentStep: 0,
      isPlaying: false,
      completedSteps: [],
      error: null,
    });
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
            protocols={protocolFlows || []}
            selectedProtocol={selectedProtocol}
            onProtocolSelect={handleProtocolSelect}
          />
        </aside>

        <main className="protocol-playground__viewer">
          {selectedProtocol ? (
            <ProtocolViewer
              protocol={selectedProtocol}
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
