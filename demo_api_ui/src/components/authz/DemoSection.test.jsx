import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import DemoSection from './DemoSection';

const base = { id: 'abac', number: 4, title: 'Attributes & ABAC', concept: 'ABAC uses attributes.', docHref: 'https://docs.pingidentity.com/x' };

describe('DemoSection', () => {
  test('collapsed: shows title, hides body', () => {
    render(<DemoSection {...base} open={false} onToggle={() => {}}><div>DEMO_BODY</div></DemoSection>);
    expect(screen.getByText(/Attributes & ABAC/)).toBeInTheDocument();
    expect(screen.queryByText('DEMO_BODY')).toBeNull();
  });

  test('open: shows concept, learn-more link, and children', () => {
    render(<DemoSection {...base} open onToggle={() => {}}><div>DEMO_BODY</div></DemoSection>);
    expect(screen.getByText('ABAC uses attributes.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', base.docHref);
    expect(screen.getByText('DEMO_BODY')).toBeInTheDocument();
  });

  test('clicking header calls onToggle with id', () => {
    const onToggle = vi.fn();
    render(<DemoSection {...base} open={false} onToggle={onToggle}><div /></DemoSection>);
    fireEvent.click(screen.getByRole('button', { name: /Attributes & ABAC/ }));
    expect(onToggle).toHaveBeenCalledWith('abac');
  });
});
