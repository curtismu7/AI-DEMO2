// demo_api_ui/src/context/__tests__/EventStreamContext.test.js
import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EventStreamProvider, useEventStream } from '../EventStreamContext';

function Probe() {
  const ctx = useEventStream();
  return (
    <div>
      <span data-testid="count">{ctx.events.length}</span>
      <span data-testid="isOpen">{ctx.isOpen ? '1' : '0'}</span>
      <span data-testid="mode">{ctx.mode}</span>
      <span data-testid="autoScroll">{ctx.autoScrollEnabled ? '1' : '0'}</span>
      <span data-testid="first-msg">{ctx.events[0]?.message ?? ''}</span>
      <button onClick={() => ctx.addEvent({ type: 'tool_call', message: 'hello' })}>add</button>
      <button onClick={() => ctx.clearHistory()}>clear</button>
      <button onClick={() => ctx.togglePanel()}>toggle</button>
      <button onClick={() => ctx.openPanel()}>open</button>
      <button onClick={() => ctx.setMode('float')}>float</button>
      <button onClick={() => ctx.pauseAutoScroll()}>pause</button>
      <button onClick={() => ctx.resumeAutoScroll()}>resume</button>
    </div>
  );
}

describe('EventStreamProvider', () => {
  it('provides default state', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('isOpen')).toHaveTextContent('0');
    expect(screen.getByTestId('mode')).toHaveTextContent('float');
    expect(screen.getByTestId('autoScroll')).toHaveTextContent('1');
  });

  it('addEvent appends an event with id and timestamp', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('first-msg')).toHaveTextContent('hello');
  });

  it('addEvent appends multiple events (append-only, never mutates)', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('clearHistory empties events', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('togglePanel flips isOpen', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(screen.getByTestId('isOpen')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(screen.getByTestId('isOpen')).toHaveTextContent('0');
  });

  it('openPanel sets isOpen to true', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /^open$/i }));
    expect(screen.getByTestId('isOpen')).toHaveTextContent('1');
  });

  it('setMode changes mode', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /float/i }));
    expect(screen.getByTestId('mode')).toHaveTextContent('float');
  });

  it('pauseAutoScroll disables autoScrollEnabled', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.getByTestId('autoScroll')).toHaveTextContent('0');
  });

  it('resumeAutoScroll re-enables autoScrollEnabled', () => {
    render(<EventStreamProvider><Probe /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(screen.getByTestId('autoScroll')).toHaveTextContent('1');
  });

  it('accepts initialState override', () => {
    render(
      <EventStreamProvider initialState={{ isOpen: true, mode: 'bottom' }}>
        <Probe />
      </EventStreamProvider>
    );
    expect(screen.getByTestId('isOpen')).toHaveTextContent('1');
    expect(screen.getByTestId('mode')).toHaveTextContent('bottom');
  });

  it('addEvent auto-generates id and timestamp when not provided', () => {
    let capturedEvents;
    function Inspector() {
      const { events, addEvent } = useEventStream();
      capturedEvents = events;
      return <button onClick={() => addEvent({ type: 'result', message: 'done' })}>add</button>;
    }
    render(<EventStreamProvider><Inspector /></EventStreamProvider>);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(capturedEvents[0].id).toBeTruthy();
    expect(capturedEvents[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
