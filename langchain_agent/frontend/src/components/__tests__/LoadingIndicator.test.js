/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoadingIndicator from '../LoadingIndicator';

describe('LoadingIndicator', () => {
  test('renders loading indicator with text', () => {
    render(<LoadingIndicator />);
    
    expect(screen.getByText('Agent is thinking...')).toBeInTheDocument();
  });

  test('renders typing dots animation', () => {
    render(<LoadingIndicator />);
    
    const typingDots = document.querySelector('.typing-dots');
    expect(typingDots).toBeInTheDocument();
    
    const dots = typingDots.querySelectorAll('span');
    expect(dots).toHaveLength(3);
  });

  test('has correct CSS classes for styling', () => {
    render(<LoadingIndicator />);
    
    const loadingIndicator = document.querySelector('.loading-indicator');
    const loadingContent = document.querySelector('.loading-content');
    const typingDots = document.querySelector('.typing-dots');
    const loadingText = document.querySelector('.loading-text');
    
    expect(loadingIndicator).toBeInTheDocument();
    expect(loadingContent).toBeInTheDocument();
    expect(typingDots).toBeInTheDocument();
    expect(loadingText).toBeInTheDocument();
  });
});