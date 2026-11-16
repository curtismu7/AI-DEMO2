import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/privilegeAiPoliciesDemoService', () => ({ connectDoor: vi.fn(), runTool: vi.fn() }));
vi.mock('../../services/privilegePfTokenDemoService', () => ({ getState: vi.fn(), runDemo: vi.fn() }));
import { connectDoor, runTool } from '../../services/privilegeAiPoliciesDemoService';
import { getState, runDemo } from '../../services/privilegePfTokenDemoService';
import { ThemeProvider } from '../../context/ThemeContext';
import { StandaloneCedarLiveShell, StandaloneIndex } from '../StandaloneSamples';

global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => { vi.resetAllMocks(); });

describe('/standalone/cedar-live', () => {
  it('renders the walkthrough in the standalone shell, with no live calls and no live results', () => {
    render(<ThemeProvider><MemoryRouter><StandaloneCedarLiveShell /></MemoryRouter></ThemeProvider>);
    expect(screen.getByRole('heading', { name: 'Cedar in Privilege (live)' })).toBeInTheDocument();
    expect(screen.getByTestId('pcl-banner')).toHaveTextContent('WALKTHROUGH, NO CALLS');
    expect(connectDoor).not.toHaveBeenCalled();
    expect(runTool).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(runDemo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pcl-run-hold')).toBeNull();
    expect(screen.queryByTestId('pcl-hold-verdict')).toBeNull();
    expect(screen.queryByTestId('pcl-scope-result')).toBeNull();
    expect(screen.queryByTestId('ppt-actsub-result')).toBeNull();
  });

  it('is listed on /standalone next to the AI Policies walkthrough', () => {
    render(<ThemeProvider><MemoryRouter><StandaloneIndex /></MemoryRouter></ThemeProvider>);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/standalone/cedar-live');
    expect(hrefs).toContain('/standalone/ai-policies');
  });
});
