/**
 * StepDetailsSection Test Suite
 * Tests for expandable step details component
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StepDetailsSection from '../StepDetailsSection';
import { STEP_DETAILS } from '../../data/stepDetails';

describe('StepDetailsSection Component', () => {
  describe('Rendering', () => {
    it('should render nothing when step is null', () => {
      const { container } = render(<StepDetailsSection step={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render with basic step data', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      expect(screen.getByText('BFF receives user token')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should render step number in circle', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const numberCircle = screen.getByText('1').closest('.step-details-step-number');
      expect(numberCircle).toBeInTheDocument();
    });

    it('should render status badge', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    it('should render timestamp', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      expect(screen.getByText('immediate')).toBeInTheDocument();
    });
  });

  describe('Expand/Collapse', () => {
    it('should have collapsed details element initially', () => {
      const { container } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = container.querySelector('.step-details-element');
      expect(details).not.toHaveAttribute('open');
    });

    it('should expand when clicking summary', () => {
      const { container } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = container.querySelector('.step-details-element');
      const summary = container.querySelector('.step-details-summary');

      fireEvent.click(summary);
      expect(details).toHaveAttribute('open');
    });

    it('should collapse when clicking summary again', () => {
      const { container } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = container.querySelector('.step-details-element');
      const summary = container.querySelector('.step-details-summary');

      fireEvent.click(summary);
      fireEvent.click(summary);
      expect(details).not.toHaveAttribute('open');
    });

    it('should rotate toggle icon on expand', () => {
      const { container, rerender } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const summary = container.querySelector('.step-details-summary');

      fireEvent.click(summary);
      const icon = container.querySelector('.step-details-toggle-icon');
      expect(icon).toHaveClass('step-details-toggle-icon');
    });
  });

  describe('Expanded Content - Summary', () => {
    it('should render summary when present', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText('Customer signs in with PingOne OAuth')).toBeInTheDocument();
    });

    it('should render section title', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Summary/i)).toBeInTheDocument();
    });
  });

  describe('Expanded Content - What', () => {
    it('should render "What Happens" section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/What Happens/i)).toBeInTheDocument();
    });

    it('should include description in What section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/PingOne issues a customer access token/i)).toBeInTheDocument();
    });
  });

  describe('Expanded Content - HTTP Exchange', () => {
    it('should render HTTP request/response section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/HTTP Request & Response/i)).toBeInTheDocument();
    });

    it('should render HTTP method and endpoint', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText('POST')).toBeInTheDocument();
      expect(screen.getByText('/oauth/token')).toBeInTheDocument();
    });

    it('should render HTTP response status', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('should render Headers and Body labels', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getAllByText(/Headers:/i).length).toBeGreaterThan(0);
    });

    it('should render Response label', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Response:/i)).toBeInTheDocument();
    });
  });

  describe('Expanded Content - Token Structure', () => {
    it('should render Token Structure section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Token Structure/i)).toBeInTheDocument();
    });

    it('should show token type and role', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/JWT.*RFC 7519/i)).toBeInTheDocument();
      expect(screen.getByText(/Subject Token.*RFC 8693/i)).toBeInTheDocument();
    });

    it('should render JWT Claims section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/JWT Claims/i)).toBeInTheDocument();
    });

    it('should display claim key-value pairs', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText('sub')).toBeInTheDocument();
      expect(screen.getByText('iss')).toBeInTheDocument();
      expect(screen.getByText('aud')).toBeInTheDocument();
    });
  });

  describe('Expanded Content - Validation Checks', () => {
    it('should render Validation Checks section', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Validation Checks/i)).toBeInTheDocument();
    });

    it('should display all validation checks', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText('Signature valid')).toBeInTheDocument();
      expect(screen.getByText('Not expired')).toBeInTheDocument();
    });

    it('should show pass status indicator', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getAllByText('✓').length).toBeGreaterThan(0);
    });

    it('should display check details', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = screen.getByText('BFF receives user token').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Token signed by PingOne/i)).toBeInTheDocument();
    });
  });

  describe('Expanded Content - Warnings', () => {
    it('should render Important Notes section when warnings exist', () => {
      render(<StepDetailsSection step={STEP_DETAILS[2]} />);
      const details = screen.getByText('RFC 8707 Audience binding').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/Important Notes/i)).toBeInTheDocument();
    });

    it('should display warning text', () => {
      render(<StepDetailsSection step={STEP_DETAILS[2]} />);
      const details = screen.getByText('RFC 8707 Audience binding').closest('.step-details-element');
      fireEvent.click(details.querySelector('.step-details-summary'));

      expect(screen.getByText(/RFC 8707 is stronger/i)).toBeInTheDocument();
    });
  });

  describe('Status Badges', () => {
    it('should display correct badge for "active" status', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    it('should display correct badge for "done" status', () => {
      render(<StepDetailsSection step={STEP_DETAILS[2]} />);
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });

  describe('Step Data Integration', () => {
    it('should render all steps from STEP_DETAILS array', () => {
      STEP_DETAILS.forEach((step) => {
        const { unmount } = render(<StepDetailsSection step={step} />);
        expect(screen.getByText(step.title)).toBeInTheDocument();
        unmount();
      });
    });

    it('should handle step 1 (receive user token)', () => {
      render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      expect(screen.getByText('BFF receives user token')).toBeInTheDocument();
      expect(screen.getByText('immediate')).toBeInTheDocument();
    });

    it('should handle step 2 (token exchange)', () => {
      render(<StepDetailsSection step={STEP_DETAILS[1]} />);
      expect(screen.getByText('RFC 8693 Token Exchange')).toBeInTheDocument();
      expect(screen.getByText('on agent action')).toBeInTheDocument();
    });

    it('should handle step 3 (audience binding)', () => {
      render(<StepDetailsSection step={STEP_DETAILS[2]} />);
      expect(screen.getByText('RFC 8707 Audience binding')).toBeInTheDocument();
    });

    it('should handle step 4 (scope narrowing)', () => {
      render(<StepDetailsSection step={STEP_DETAILS[3]} />);
      expect(screen.getByText('RFC 6749 §3.3 Scope narrowing')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard navigable', () => {
      const { container } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const summary = container.querySelector('.step-details-summary');
      expect(summary).toBeInTheDocument();

      // Summary should be focusable (even though it's not a button)
      fireEvent.click(summary);
      expect(container.querySelector('.step-details-element')).toHaveAttribute('open');
    });

    it('should have proper ARIA roles', () => {
      const { container } = render(<StepDetailsSection step={STEP_DETAILS[0]} />);
      const details = container.querySelector('.step-details-element');
      expect(details).toBeInTheDocument();
    });
  });
});
