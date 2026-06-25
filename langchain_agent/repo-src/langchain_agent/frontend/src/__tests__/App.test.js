/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

describe('App', () => {
  test('renders app header', () => {
    render(<App />);
    
    expect(screen.getByText('Banking Digital Assistant')).toBeInTheDocument();
  });

  test('renders chat interface', () => {
    render(<App />);
    
    // Check if ChatInterface is rendered by looking for its key elements
    // The placeholder might be "Connecting..." initially due to WebSocket state
    expect(screen.getByText('Welcome to Banking Digital Assistant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  test('has correct structure with header and main sections', () => {
    render(<App />);
    
    const header = document.querySelector('.App-header');
    const main = document.querySelector('.App-main');
    
    expect(header).toBeInTheDocument();
    expect(main).toBeInTheDocument();
  });
});