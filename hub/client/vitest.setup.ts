import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Ensure the jsdom DOM is reset between tests so React Testing Library
// renders do not leak across test cases.
afterEach(() => {
  cleanup();
});
