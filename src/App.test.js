import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the loading screen', () => {
  render(<App />);
  expect(screen.getByText(/on compte tes visites/i)).toBeInTheDocument();
});
