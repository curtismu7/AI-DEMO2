// The live system flow map's walkthrough: Simulate replays the run the map
// already shows (or a representative path when there is none), Reset drops
// back to the live view, and the boxes stay movable.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SystemFlowMapView, buildFlowModel, CANONICAL_EDGES } from '../SystemFlowMap';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { expectDiagramControls, ResizeObserverStub } from './diagramControlsHelpers';

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

beforeEach(() => {
  tokenChainTraceStore.reset();
});

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
describe('SystemFlowMap replay walkthrough', () => {
  it('has Simulate, Reset, speed and movable boxes', async () => {
    const { container } = render(<SystemFlowMapView />);
    await expectDiagramControls(container);
  });

  it('with no traffic, replays the representative path and says so; Reset returns to live', () => {
    const { container } = render(<SystemFlowMapView />);
    const bar = screen.getByTestId('diagram-step-bar');
    expect(CANONICAL_EDGES.length).toBeGreaterThan(5);
    fireEvent.click(within(bar).getByRole('button', { name: 'Simulate' }));
    expect(bar).toHaveTextContent(`Step 1 of ${CANONICAL_EDGES.length}`);
    expect(bar).toHaveTextContent(/representative path/i);
    expect(container.querySelector('.dstep-hot')).toBeTruthy();

    fireEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    expect(within(bar).getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    expect(container.querySelector('.dstep-hot')).toBeNull();
  });

  it('with recent traffic, replays that run\'s hops in order', () => {
    act(() => { tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' }); });
    const { steps, trace } = tokenChainTraceStore.getState();
    const n = buildFlowModel(steps, trace).edges.length;
    expect(n).toBeGreaterThan(0);
    render(<SystemFlowMapView />);
    const bar = screen.getByTestId('diagram-step-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Simulate' }));
    expect(bar).toHaveTextContent(`Step 1 of ${n}`);
    expect(bar).not.toHaveTextContent(/representative path/i);
  });
});
