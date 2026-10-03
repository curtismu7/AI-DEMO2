import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PingFederateDownModal from './PingFederateDownModal';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('PingFederateDownModal', () => {
  it('opens when the URL carries idp_error=pingfederate_unreachable', () => {
    window.history.replaceState({}, '', '/?error=oauth_provider&idp_error=pingfederate_unreachable');
    render(<PingFederateDownModal />);
    expect(screen.getByText('PingFederate is not running')).toBeTruthy();
  });

  it('stays closed for any other URL', () => {
    window.history.replaceState({}, '', '/?error=oauth_provider&idp_error=server_error');
    render(<PingFederateDownModal />);
    expect(screen.queryByText('PingFederate is not running')).toBeNull();
  });
});
