/**
 * Tests for ScopeChangesCallout component
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ScopeChangesCallout from './ScopeChangesCallout';
import '@testing-library/jest-dom';

describe('ScopeChangesCallout', () => {
  it('renders without crashing', () => {
    render(<ScopeChangesCallout />);
    expect(screen.getByText(/Scope Narrowing:/)).toBeInTheDocument();
  });

  it('displays the yellow callout container', () => {
    const { container } = render(<ScopeChangesCallout />);
    const callout = container.querySelector('.scope-changes-callout');
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveClass('scope-changes-callout');
  });

  it('displays the scope narrowing label', () => {
    render(<ScopeChangesCallout />);
    expect(screen.getByText(/Scope Narrowing:/)).toBeInTheDocument();
  });

  it('displays the full scope progression text', () => {
    render(<ScopeChangesCallout />);
    const progression = screen.getByText(/User Token: read write → Agent Token: read write → MCP Token:/);
    expect(progression).toBeInTheDocument();
  });

  it('highlights the "read" scope in orange', () => {
    const { container } = render(<ScopeChangesCallout />);
    const highlight = container.querySelector('.scope-highlight');
    expect(highlight).toBeInTheDocument();
    expect(highlight).toHaveTextContent('read');
  });

  it('displays the icon', () => {
    render(<ScopeChangesCallout />);
    const icon = screen.getByText('⚡');
    expect(icon).toBeInTheDocument();
  });

  it('displays narrowed text after the highlight', () => {
    render(<ScopeChangesCallout />);
    const progression = screen.getByText(/\(narrowed\)/);
    expect(progression).toBeInTheDocument();
  });

  it('renders content section with proper structure', () => {
    const { container } = render(<ScopeChangesCallout />);
    const content = container.querySelector('.scope-changes-content');
    expect(content).toBeInTheDocument();

    const icon = content.querySelector('.scope-changes-icon');
    expect(icon).toBeInTheDocument();

    const text = content.querySelector('.scope-changes-text');
    expect(text).toBeInTheDocument();
  });

  it('has the yellow background color (#fef3c7)', () => {
    const { container } = render(<ScopeChangesCallout />);
    const callout = container.querySelector('.scope-changes-callout');
    const styles = window.getComputedStyle(callout);
    // Allow for minor rounding differences in color conversion
    const bg = styles.backgroundColor;
    expect(bg).toMatch(/rgb\(254, 243, 19[0-9]\)/);
  });

  it('has the yellow border color (#fcd34d)', () => {
    const { container } = render(<ScopeChangesCallout />);
    const callout = container.querySelector('.scope-changes-callout');
    const styles = window.getComputedStyle(callout);
    expect(styles.borderColor).toBe('rgb(252, 211, 77)'); // #fcd34d in rgb
  });

  it('has the orange highlight color (#fb923c)', () => {
    const { container } = render(<ScopeChangesCallout />);
    const highlight = container.querySelector('.scope-highlight');
    const styles = window.getComputedStyle(highlight);
    expect(styles.backgroundColor).toBe('rgb(251, 146, 60)'); // #fb923c in rgb
  });

  it('renders the label with correct styling class', () => {
    const { container } = render(<ScopeChangesCallout />);
    const label = container.querySelector('.scope-changes-label');
    expect(label).toHaveClass('scope-changes-label');
    expect(label).toHaveTextContent('Scope Narrowing:');
  });

  it('renders the progression text with correct styling class', () => {
    const { container } = render(<ScopeChangesCallout />);
    const progression = container.querySelector('.scope-changes-progression');
    expect(progression).toHaveClass('scope-changes-progression');
  });

  it('has proper padding and spacing', () => {
    const { container } = render(<ScopeChangesCallout />);
    const callout = container.querySelector('.scope-changes-callout');
    const styles = window.getComputedStyle(callout);
    expect(styles.padding).toBe('10px 12px');
  });

  it('displays all three token types in progression', () => {
    render(<ScopeChangesCallout />);
    const text = screen.getByText(/User Token: read write → Agent Token: read write → MCP Token:/);
    expect(text).toHaveTextContent('User Token');
    expect(text).toHaveTextContent('Agent Token');
    expect(text).toHaveTextContent('MCP Token');
  });

  it('shows scope narrowing indicator "(narrowed)"', () => {
    render(<ScopeChangesCallout />);
    const narrowedText = screen.getByText(/\(narrowed\)/);
    expect(narrowedText).toBeInTheDocument();
  });

  it('has flex layout for content alignment', () => {
    const { container } = render(<ScopeChangesCallout />);
    const content = container.querySelector('.scope-changes-content');
    const styles = window.getComputedStyle(content);
    expect(styles.display).toBe('flex');
  });

  it('icon is properly sized and positioned', () => {
    const { container } = render(<ScopeChangesCallout />);
    const icon = container.querySelector('.scope-changes-icon');
    const styles = window.getComputedStyle(icon);
    expect(styles.fontSize).toBe('1rem');
    expect(styles.flexShrink).toBe('0');
  });
});
