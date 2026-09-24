import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import FavoritesMenu from '../FavoritesMenu';

beforeEach(() => localStorage.clear());

describe('FavoritesMenu', () => {
  it('opens Agent Identity Academy inside the application route', () => {
    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <FavoritesMenu />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent Identity Academy' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/academy/identity');
  });
});
