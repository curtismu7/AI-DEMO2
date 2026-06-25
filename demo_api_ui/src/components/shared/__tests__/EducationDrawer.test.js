// banking_api_ui/src/components/shared/__tests__/EducationDrawer.test.js
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EducationDrawer from '../EducationDrawer';

describe('EducationDrawer', () => {
  it('keeps selected tab after parent re-render (unstable tabs[] reference)', () => {
    function Wrapper() {
      const [, setN] = React.useState(0);
      return (
        <>
          <button type="button" onClick={() => setN((x) => x + 1)}>
            bump
          </button>
          <EducationDrawer
            isOpen
            onClose={() => {}}
            title="Test"
            tabs={[
              { id: 'a', label: 'Tab A', content: <p>Content A</p> },
              { id: 'b', label: 'Tab B', content: <p>Content B</p> },
            ]}
            initialTabId="a"
          />
        </>
      );
    }

    render(<Wrapper />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
    expect(screen.getByText('Content B')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'bump' }));
    expect(screen.getByText('Content B')).not.toBeNull();
  });
});
