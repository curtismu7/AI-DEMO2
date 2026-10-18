// The live token topology's walkthrough: Simulate replays the session's
// token-chain hops in order (or the canonical chain when nothing ran yet),
// Reset drops back to the live view, and the boxes stay movable.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokenTopologyPanel from '../TokenTopologyPanel';
import { ThemeProvider } from '../../context/ThemeContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { expectDiagramControls, ResizeObserverStub } from './diagramControlsHelpers';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  tokenChainTraceStore.reset();
});
afterEach(() => vi.unstubAllGlobals());

const renderPanel = () => render(<ThemeProvider><TokenTopologyPanel inline /></ThemeProvider>);

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
describe('TokenTopologyPanel replay walkthrough', () => {
  it('has Simulate, Reset, speed and movable boxes once a run is drawn', async () => {
    act(() => { tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' }); });
    const { container } = renderPanel();
    await expectDiagramControls(container);
  });

  it('with recent traffic, replays the drawn hops one by one; Reset returns to live', () => {
    act(() => { tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' }); });
    const { container } = renderPanel();
    const live = container.querySelectorAll('.ttp-node').length;
    expect(live).toBeGreaterThan(1);
    const bar = screen.getByTestId('diagram-step-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Simulate' }));
    expect(bar).toHaveTextContent(`Step 1 of ${live}`);
    expect(container.querySelectorAll('.ttp-node')).toHaveLength(1);
    expect(container.querySelector('.ttp-node.current')).toBeTruthy();

    fireEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    expect(within(bar).getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    expect(container.querySelectorAll('.ttp-node')).toHaveLength(live);
  });

  it('with no traffic, replays the canonical chain and says so', () => {
    const { steps } = tokenChainTraceStore.getState();
    const { container } = renderPanel();
    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
    const bar = screen.getByTestId('diagram-step-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Simulate' }));
    expect(bar).toHaveTextContent(`Step 1 of ${steps.length}`);
    expect(bar).toHaveTextContent(/representative path/i);
    expect(container.querySelectorAll('.ttp-node')).toHaveLength(1);

    fireEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    expect(container.querySelectorAll('.ttp-node')).toHaveLength(0);
    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
  });
});
