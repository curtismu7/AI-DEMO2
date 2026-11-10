import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DiagramsIndexPage from '../DiagramsIndexPage';
import { DIAGRAMS_INDEX, DIAGRAMS_MORE } from '../../../config/diagramsIndex';

const renderPage = () =>
  render(
    <MemoryRouter>
      <DiagramsIndexPage />
    </MemoryRouter>,
  );

const all = [...DIAGRAMS_INDEX.flatMap((s) => s.items), ...DIAGRAMS_MORE];

describe('DiagramsIndexPage', () => {
  it('has one h1 and no <main> of its own (the shell owns it)', () => {
    const { container } = renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelector('main')).toBeNull();
    expect(screen.getByTestId('diagrams-index-page')).toBeTruthy();
  });

  it('puts the honest banner first, as a note', () => {
    renderPage();
    const root = screen.getByTestId('diagrams-index-page');
    const banner = screen.getByTestId('diagrams-index-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(root.firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/index of links/i);
    expect(banner.textContent).toMatch(/Nothing on it runs/i);
  });

  it('does not claim to know a diagram\'s mode: no promise about 57 other pages, and no unqualified "live" blurb', () => {
    renderPage();
    const banner = screen.getByTestId('diagrams-index-banner').textContent;
    expect(banner).toMatch(/does not check whether a diagram uses live or sample data/i);
    expect(banner).not.toMatch(/is stated on that page/i);
    const flow = all.find((d) => d.path === '/monitoring/system-flow');
    expect(flow.blurb).not.toMatch(/^Live system flow/i);
    expect(flow.blurb).toMatch(/last run/i);
    expect(flow.blurb).toMatch(/no run/i);
  });

  it('renders every entry once, as one link named by its title that goes to its path', () => {
    renderPage();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(all.length);
    for (const d of all) {
      const link = screen.getByRole('link', { name: d.title });
      expect(link.getAttribute('href')).toBe(d.path);
    }
  });

  it('is a list of cards: each link is the title (h3) inside a list item, with its blurb in the same card', () => {
    renderPage();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(all.length);
    const first = all[0];
    const li = screen.getByRole('link', { name: first.title }).closest('li');
    expect(within(li).getByRole('heading', { level: 3 })).toBeTruthy();
    expect(within(li).getByText(first.blurb)).toBeTruthy();
    expect(li.querySelector('.pu-card')).not.toBeNull();
  });

  it('names a section landmark for each group plus "More diagrams", each with a count', () => {
    renderPage();
    for (const s of DIAGRAMS_INDEX) {
      const region = screen.getByRole('region', { name: s.section });
      expect(within(region).getAllByRole('link')).toHaveLength(s.items.length);
    }
    const more = screen.getByRole('region', { name: 'More diagrams' });
    expect(within(more).getAllByRole('link')).toHaveLength(DIAGRAMS_MORE.length);
  });

  it('has no action buttons: every control is a link, so there is no primary button', () => {
    const { container } = renderPage();
    expect(container.querySelector('.pu-btn--primary')).toBeNull();
    expect(screen.queryAllByRole('button').filter((b) => b.className.includes('primary'))).toHaveLength(0);
  });

  it('keeps unique section ids', () => {
    const { container } = renderPage();
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
