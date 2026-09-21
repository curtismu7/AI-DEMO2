import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import FavoritesMenu from '../FavoritesMenu';

beforeEach(() => localStorage.clear());

describe('FavoritesMenu', () => {
  it('offers Agent Identity Academy as a full-page favorite link', () => {
    render(
      <MemoryRouter>
        <FavoritesMenu />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(screen.getByRole('link', { name: 'Agent Identity Academy' })).toHaveAttribute(
      'href',
      '/academy-identity-preview.html',
    );
  });
});
