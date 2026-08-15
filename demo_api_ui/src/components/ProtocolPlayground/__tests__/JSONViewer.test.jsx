import React from 'react';
import { render } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import JSONViewer from '../JSONViewer';

describe('JSONViewer', () => {
  test('escapes markup in string values instead of injecting live HTML', () => {
    const { container } = render(
      <JSONViewer data={{ error_description: '<img src=x onerror=alert(1)>' }} />
    );

    // No injected <img> element should exist anywhere in the rendered tree.
    expect(container.querySelector('img')).toBeNull();
    // The malicious payload should appear as literal, inert text content.
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    // No dangerouslySetInnerHTML usage remains — verified structurally by
    // asserting the payload rendered as text nodes, not parsed elements.
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('preserves syntax-highlighting spans for normal JSON', () => {
    const { container } = render(
      <JSONViewer data={{ scope: 'gateway:mcp:invoke', count: 3, active: true, note: null }} />
    );

    expect(container.querySelector('.json-key')).not.toBeNull();
    expect(container.querySelector('.json-string')).not.toBeNull();
    expect(container.querySelector('.json-number')?.textContent).toBe('3');
    expect(container.querySelector('.json-boolean')?.textContent).toBe('true');
    expect(container.querySelector('.json-null')?.textContent).toBe('null');
    expect(container.querySelectorAll('.json-brace').length).toBeGreaterThan(0);
  });

  test('returns null for falsy data', () => {
    const { container } = render(<JSONViewer data={null} />);
    expect(container.firstChild).toBeNull();
  });
});
